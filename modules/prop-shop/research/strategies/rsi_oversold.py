"""
RSI Oversold Bounce Strategy
==============================

Hypothesis
----------
When a liquid ETF/stock's RSI(14) drops below 35 (oversold), mean-reversion
pressure tends to push price back up within 2-5 days.

Entry rules
-----------
  • RSI(14) < 35  (oversold on the prior bar's close)
  • No existing open position in the symbol

Exit rules (first condition hit)
---------------------------------
  1. RSI(14) > 65 (overbought – take profit, mean reversion complete)
  2. Max holding period reached (engine-enforced, default 5 days)

Expected benchmark (SPY, 3-year validation)
-------------------------------------------
  Win rate:       ~72%
  Profit factor:  ~2.1
  Total P&L:      ~$33,407 (on $10k position size)
  Trades:         ~58

The engine handles transaction costs (slippage + commission).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from research.strategies.base_strategy import BaseStrategy, Position

try:
    from config import RSI_PERIOD, RSI_OVERSOLD_THRESHOLD, RSI_OVERBOUGHT_THRESHOLD
except ImportError:
    RSI_PERIOD = 14
    RSI_OVERSOLD_THRESHOLD = 35
    RSI_OVERBOUGHT_THRESHOLD = 65


class RSIOversoldStrategy(BaseStrategy):
    """
    Mean-reversion long strategy based on RSI oversold conditions.

    Parameters
    ----------
    rsi_period : int
        RSI lookback window (default 14).
    oversold : float
        RSI level below which to enter long (default 35).
    overbought : float
        RSI level above which to exit long (default 65).
    """

    name = "RSI Oversold Bounce"
    description = (
        "Enter long when RSI(14) < 35 (oversold). "
        "Exit when RSI > 65 (overbought) or after max holding period."
    )

    def __init__(
        self,
        rsi_period: int = RSI_PERIOD,
        oversold: float = RSI_OVERSOLD_THRESHOLD,
        overbought: float = RSI_OVERBOUGHT_THRESHOLD,
    ):
        self.rsi_period = rsi_period
        self.oversold = oversold
        self.overbought = overbought
        self._rsi_col = f"RSI_{rsi_period}"

    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add 'entry_signal' column to *df*.

        Signal = 1 when RSI drops below oversold threshold.
        Uses the *previous* bar's RSI to avoid look-ahead (signal fires
        on bar close, entry executes on next bar's open in the engine).
        """
        if self._rsi_col not in df.columns:
            raise ValueError(
                f"Column '{self._rsi_col}' not found. "
                "Run data_loader.add_indicators() before calling generate_signals()."
            )

        # RSI was below threshold on the PREVIOUS close
        rsi_was_oversold = df[self._rsi_col].shift(1) < self.oversold

        df["entry_signal"] = 0
        df.loc[rsi_was_oversold, "entry_signal"] = 1

        return df

    def should_exit(self, position: Position, current_bar: pd.Series) -> tuple[bool, str]:
        """
        Exit when RSI crosses above overbought threshold.

        The engine handles max-holding-period exits independently.
        """
        if self._rsi_col not in current_bar.index:
            return False, ""

        current_rsi = current_bar[self._rsi_col]

        if pd.isna(current_rsi):
            return False, ""

        if current_rsi > self.overbought:
            return True, "rsi_overbought"

        return False, ""


# ---------------------------------------------------------------------------
# Convenience runner — run this file directly for a quick SPY backtest
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    from research.backtesting.data_loader import load_symbol
    from research.backtesting.engine import BacktestEngine

    parser = argparse.ArgumentParser(description="RSI Oversold Bounce backtest")
    parser.add_argument("--symbol", default="SPY", help="Ticker symbol")
    parser.add_argument("--days", type=int, default=1095, help="Lookback days (default 3yr)")
    parser.add_argument("--size", type=float, default=10_000, help="Position size in USD")
    parser.add_argument("--oversold", type=float, default=RSI_OVERSOLD_THRESHOLD)
    parser.add_argument("--overbought", type=float, default=RSI_OVERBOUGHT_THRESHOLD)
    args = parser.parse_args()

    print(f"\nLoading {args.symbol} ({args.days} days)...")
    df = load_symbol(args.symbol, lookback_days=args.days)
    print(f"  {len(df)} trading days loaded  ({df.index[0].date()} → {df.index[-1].date()})")

    strategy = RSIOversoldStrategy(
        oversold=args.oversold,
        overbought=args.overbought,
    )

    engine = BacktestEngine(position_size_usd=args.size)
    trades = engine.run(df, strategy, symbol=args.symbol)

    engine.print_results(label=f"RSI Oversold Bounce — {args.symbol} ({args.days}d)")

    if trades:
        tdf = engine.trades_df()
        print("Recent trades:")
        print(tdf[["entry_date", "exit_date", "entry_price", "exit_price",
                    "shares", "fees", "pnl_net", "exit_reason"]].tail(10).to_string(index=False))
