"""
Volume Spike Breakout Strategy (Momentum)
==========================================

Hypothesis
----------
When a stock closes above its 20-day high on volume that is 2x the 20-day
average, momentum typically continues for 2-3 days before fading.

Entry rules
-----------
  • Close > 20-day rolling max of Close    (fresh breakout above resistance)
  • Volume > 2× AvgVolume_20              (unusual volume confirms conviction)
  • RSI(14) < 70                          (not yet in overbought territory)
  • No existing open position in the symbol

Exit rules (first condition hit)
---------------------------------
  1. Close < SMA_20 — trend reversal / loss of momentum
  2. Stop loss: close < entry_price * (1 - stop_loss_pct)  (default -3%)
  3. Max holding period reached (engine-enforced, default 3 days)

Expected targets (volatile tickers: PLTR, RIOT, SOFI)
------------------------------------------------------
  Win rate:       ~55-65%
  Profit factor:  ~1.5-2.0
  Trades:         20+ per 3-year window

Transaction costs are handled by the BacktestEngine ($0.02 slippage + $0.01 commission).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from research.strategies.base_strategy import BaseStrategy, Position


class VolumeBreakoutStrategy(BaseStrategy):
    """
    Momentum long strategy triggered by high-volume price breakouts.

    Parameters
    ----------
    breakout_period : int
        Rolling window (in bars) for computing the resistance high (default 20).
    volume_multiplier : float
        Volume must exceed this multiple of the 20-day average (default 2.0).
    rsi_overbought : float
        Do not enter if RSI is at or above this level (default 70).
    stop_loss_pct : float
        Fraction below entry price that triggers stop loss (default 0.03 = 3%).

    Notes
    -----
    Depends on columns added by data_loader.add_indicators():
      - RSI_14
      - SMA_20
      - AvgVolume_20

    The 20-day rolling Close high (resistance) is computed internally within
    generate_signals().
    """

    name = "Volume Breakout"
    description = (
        "Enter long when price breaks above 20-day high on 2× average volume "
        "and RSI < 70. Exit on SMA_20 breakdown, stop loss, or after 3 days."
    )

    _RSI_COL = "RSI_14"
    _SMA_COL = "SMA_20"
    _AVGVOL_COL = "AvgVolume_20"
    _HIGH_20_COL = "High_20"

    def __init__(
        self,
        breakout_period: int = 20,
        volume_multiplier: float = 2.0,
        rsi_overbought: float = 70.0,
        stop_loss_pct: float = 0.03,
    ):
        self.breakout_period = breakout_period
        self.volume_multiplier = volume_multiplier
        self.rsi_overbought = rsi_overbought
        self.stop_loss_pct = stop_loss_pct

    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add 'entry_signal' column to *df*.

        Signal = 1 when (all on the prior bar's close):
          - Close exceeded the highest close of the previous 20 bars
          - Volume was > volume_multiplier × 20-day average volume
          - RSI was below the overbought threshold

        Uses .shift(1) so signals fire on prior-bar data; the engine enters
        on the *next* bar's open to avoid look-ahead bias.
        """
        for col in (self._RSI_COL, self._SMA_COL, self._AVGVOL_COL):
            if col not in df.columns:
                raise ValueError(
                    f"Column '{col}' not found. "
                    "Run data_loader.add_indicators() before calling generate_signals()."
                )

        # resistance[i] = max of the previous 20 closes, excluding today.
        # shift(1) on rolling max so today's close is not in its own comparison window.
        df[self._HIGH_20_COL] = (
            df["Close"].rolling(window=self.breakout_period).max().shift(1)
        )

        # All conditions on the current bar's close (signal fires at bar close,
        # engine executes at the next bar's open — no look-ahead).
        broke_resistance = df["Close"] > df[self._HIGH_20_COL]
        volume_spike = df["Volume"] > self.volume_multiplier * df[self._AVGVOL_COL]
        not_overbought = df[self._RSI_COL] < self.rsi_overbought

        df["entry_signal"] = 0
        df.loc[broke_resistance & volume_spike & not_overbought, "entry_signal"] = 1

        return df

    def should_exit(self, position: Position, current_bar: pd.Series) -> tuple[bool, str]:
        """
        Exit when price breaks below SMA_20 (trend reversal) or stop loss hit.

        Parameters
        ----------
        position : Position
            The open long position.
        current_bar : pd.Series
            Current bar with Close and SMA_20.

        Returns
        -------
        (exit: bool, reason: str)
        """
        close = current_bar.get("Close")
        sma20 = current_bar.get(self._SMA_COL)

        if pd.isna(close) or close is None:
            return False, ""

        # Trend reversal: price fell below SMA_20
        if sma20 is not None and not pd.isna(sma20) and close < sma20:
            return True, "below_sma20"

        # Stop loss: price dropped more than stop_loss_pct from entry
        stop_price = position.entry_price * (1.0 - self.stop_loss_pct)
        if close < stop_price:
            return True, "stop_loss"

        return False, ""


# ---------------------------------------------------------------------------
# Convenience runner — run this file directly for a quick backtest
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    from research.backtesting.data_loader import load_symbol
    from research.backtesting.engine import BacktestEngine

    parser = argparse.ArgumentParser(description="Volume Breakout backtest")
    parser.add_argument("--symbol", default="PLTR", help="Ticker symbol")
    parser.add_argument("--start", default="2023-03-04", help="Start date YYYY-MM-DD")
    parser.add_argument("--size", type=float, default=10_000, help="Position size in USD")
    args = parser.parse_args()

    print(f"\nLoading {args.symbol} from {args.start}...")
    df = load_symbol(args.symbol, start=args.start)
    print(f"  {len(df)} trading days  ({df.index[0].date()} → {df.index[-1].date()})")

    strategy = VolumeBreakoutStrategy()
    engine = BacktestEngine(position_size_usd=args.size, max_holding_days=3)
    trades = engine.run(df, strategy, symbol=args.symbol)

    engine.print_results(label=f"Volume Breakout — {args.symbol}")

    if trades:
        tdf = engine.trades_df()
        print("\nRecent trades:")
        print(
            tdf[["entry_date", "exit_date", "entry_price", "exit_price",
                 "shares", "fees", "pnl_net", "exit_reason"]].tail(10).to_string(index=False)
        )
