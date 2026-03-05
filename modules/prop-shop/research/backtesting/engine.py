"""
Core backtesting engine.

Design principles:
- No look-ahead bias: decisions at bar N use only data available at bar N.
- Transaction costs baked in on every entry and exit.
- One position per symbol at a time (no pyramiding).
- Detailed trade log exported as a DataFrame for analysis.

Usage
-----
    from research.backtesting.engine import BacktestEngine
    from research.backtesting.data_loader import load_symbol
    from research.strategies.rsi_oversold import RSIOversoldStrategy

    df   = load_symbol("SPY", lookback_days=1095)
    eng  = BacktestEngine(position_size_usd=10_000)
    eng.run(df, RSIOversoldStrategy(), symbol="SPY")
    eng.print_results()
    trades_df = eng.trades_df()
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

import pandas as pd
import numpy as np

# Allow running as a script from any directory
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from research.strategies.base_strategy import BaseStrategy, Position, Trade
from research.backtesting import metrics

try:
    from config import (
        SLIPPAGE_PER_SHARE,
        COMMISSION_PER_SHARE,
        POSITION_SIZE_USD,
        MIN_HOLDING_DAYS,
        MAX_HOLDING_DAYS,
    )
except ImportError:
    SLIPPAGE_PER_SHARE = 0.02
    COMMISSION_PER_SHARE = 0.01
    POSITION_SIZE_USD = 10_000
    MIN_HOLDING_DAYS = 2
    MAX_HOLDING_DAYS = 5


class BacktestEngine:
    """
    Event-driven backtesting engine for swing trading strategies.

    Parameters
    ----------
    position_size_usd : float
        Dollar amount allocated to each trade.
    slippage_per_share : float
        One-way slippage cost per share.
    commission_per_share : float
        One-way commission per share.
    min_holding_days : int
        Minimum number of bars to hold before exiting.
    max_holding_days : int
        Force-exit after this many bars (prevents indefinite holds).
    allow_short : bool
        If False (default), skip short entry signals.
    """

    def __init__(
        self,
        position_size_usd: float = POSITION_SIZE_USD,
        slippage_per_share: float = SLIPPAGE_PER_SHARE,
        commission_per_share: float = COMMISSION_PER_SHARE,
        min_holding_days: int = MIN_HOLDING_DAYS,
        max_holding_days: int = MAX_HOLDING_DAYS,
        allow_short: bool = False,
    ):
        self.position_size_usd = position_size_usd
        self.slippage_per_share = slippage_per_share
        self.commission_per_share = commission_per_share
        self.min_holding_days = min_holding_days
        self.max_holding_days = max_holding_days
        self.allow_short = allow_short

        self._trades: list[Trade] = []
        self._open_position: Optional[Position] = None
        self._symbol: str = ""
        self._strategy: Optional[BaseStrategy] = None

    # ------------------------------------------------------------------
    # Cost helpers
    # ------------------------------------------------------------------

    def _one_way_cost(self, shares: int) -> float:
        """Transaction cost for one leg (entry or exit)."""
        return shares * (self.slippage_per_share + self.commission_per_share)

    def _round_trip_cost(self, shares: int) -> float:
        return 2 * self._one_way_cost(shares)

    def _shares_for_position(self, price: float) -> int:
        """How many whole shares fit in position_size_usd at *price*?"""
        if price <= 0:
            return 0
        return max(1, int(self.position_size_usd / price))

    # ------------------------------------------------------------------
    # Trade lifecycle
    # ------------------------------------------------------------------

    def _open_trade(self, bar: pd.Series, direction: str) -> None:
        """Open a new position at the next open (bar.Open)."""
        entry_price = float(bar["Open"])
        shares = self._shares_for_position(entry_price)
        self._open_position = Position(
            symbol=self._symbol,
            entry_date=bar.name,
            entry_price=entry_price,
            shares=shares,
            direction=direction,
        )

    def _close_trade(self, bar: pd.Series, reason: str) -> Trade:
        """Close the open position at bar.Open and record the trade."""
        pos = self._open_position
        exit_price = float(bar["Open"])
        fees = self._round_trip_cost(pos.shares)

        trade = Trade.from_position(
            position=pos,
            exit_date=bar.name,
            exit_price=exit_price,
            fees=fees,
            exit_reason=reason,
        )
        self._trades.append(trade)
        self._open_position = None
        return trade

    # ------------------------------------------------------------------
    # Main run loop
    # ------------------------------------------------------------------

    def run(
        self,
        df: pd.DataFrame,
        strategy: BaseStrategy,
        symbol: str = "UNKNOWN",
    ) -> list[Trade]:
        """
        Run a backtest of *strategy* on price/indicator DataFrame *df*.

        The loop processes bars in chronological order:
          1. On bar N: check for exit on the open.
          2. On bar N: check entry signal (from bar N indicators) → enter next open.

        This is a realistic "signal on close, execute on next open" model
        that avoids look-ahead bias.

        Parameters
        ----------
        df : pd.DataFrame
            OHLCV + indicators (output of data_loader.load_symbol).
        strategy : BaseStrategy
            Strategy instance to test.
        symbol : str
            Ticker label (used in trade records).

        Returns
        -------
        list[Trade]
            All completed trades.
        """
        self._trades = []
        self._open_position = None
        self._symbol = symbol
        self._strategy = strategy

        # Generate entry/exit signals for the entire series (no look-ahead
        # because signals are computed from indicators, not future prices)
        df = strategy.generate_signals(df.copy())

        bars = list(df.iterrows())

        for i, (date, bar) in enumerate(bars):
            # ---- 1. Check exit on current bar ----
            if self._open_position is not None:
                pos = self._open_position
                days_held = (date - pos.entry_date).days

                if days_held >= self.min_holding_days:
                    # Check strategy exit condition
                    should_exit, reason = strategy.should_exit(pos, bar)

                    if should_exit:
                        self._close_trade(bar, reason)
                        continue  # Don't enter on same bar we exit

                    # Force exit after max holding period
                    if days_held >= self.max_holding_days:
                        self._close_trade(bar, "max_hold")
                        continue

            # ---- 2. Check entry signal (only if flat) ----
            if self._open_position is None:
                signal = int(bar.get("entry_signal", 0))

                if signal == 1:
                    # Buy on NEXT bar's open – use the bar *after* i
                    if i + 1 < len(bars):
                        next_date, next_bar = bars[i + 1]
                        self._open_trade(next_bar, direction="long")

                elif signal == -1 and self.allow_short:
                    if i + 1 < len(bars):
                        next_date, next_bar = bars[i + 1]
                        self._open_trade(next_bar, direction="short")

        # Close any position still open at end of data
        if self._open_position is not None and len(bars) > 0:
            last_date, last_bar = bars[-1]
            self._close_trade(last_bar, "end_of_data")

        return self._trades

    # ------------------------------------------------------------------
    # Results
    # ------------------------------------------------------------------

    def trades_df(self) -> pd.DataFrame:
        """Return completed trades as a tidy DataFrame."""
        if not self._trades:
            return pd.DataFrame()
        return pd.DataFrame([t.to_dict() for t in self._trades])

    def summary(self) -> dict:
        """Return metrics summary dict."""
        return metrics.summary([t.to_dict() for t in self._trades])

    def print_results(self, label: Optional[str] = None) -> None:
        """Pretty-print backtest results."""
        tag = label or f"{self._symbol} — {self._strategy.name if self._strategy else 'Strategy'}"
        metrics.print_summary([t.to_dict() for t in self._trades], label=tag)

    def equity_curve(self) -> pd.Series:
        """Cumulative net P&L equity curve indexed by exit date."""
        if not self._trades:
            return pd.Series(dtype=float)
        df = self.trades_df()
        df = df.sort_values("exit_date")
        curve = df.set_index("exit_date")["pnl_net"].cumsum()
        return curve
