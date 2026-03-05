"""
Bollinger Band Squeeze Breakout Strategy
=========================================

Hypothesis
----------
After periods of low volatility (BB squeeze, width < 10th percentile of last
60 days), breakouts above the upper band with strong volume tend to continue
for 3-5 days.

Entry rules
-----------
  • BB width on previous bar < 10th percentile of last 60-day distribution
  • Previous bar's close > upper Bollinger Band (breakout)
  • Previous bar's volume > 1.5x 20-day average (confirmation)

Exit rules (first condition hit)
---------------------------------
  1. Close drops below lower Bollinger Band
  2. Stop loss: -3% from entry price
  3. Max holding period reached (engine-enforced, default 5 days)

Expected edge
-------------
  Trending, volatile tickers (PLTR, SOFI) should show higher win rates than
  mean-reversion strategies. Squeeze ensures we enter after consolidation, not
  into random noise.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from research.strategies.base_strategy import BaseStrategy, Position


class BBSqueezeStrategy(BaseStrategy):
    """
    Breakout strategy triggered by Bollinger Band squeeze + upper-band breach.

    Parameters
    ----------
    bb_period : int
        Rolling window for BB calculation (default 20).
    bb_std : float
        Number of standard deviations for bands (default 2.0).
    squeeze_lookback : int
        Days to look back when computing width percentile (default 60).
    squeeze_pct : float
        Width percentile threshold for squeeze (default 0.10 = 10th pct).
    volume_mult : float
        Volume must exceed this multiple of AvgVolume_20 (default 1.5).
    stop_loss_pct : float
        Exit if price falls this fraction below entry (default 0.03 = 3%).
    """

    name = "Bollinger Band Squeeze Breakout"
    description = (
        "Enter long after a BB squeeze when price closes above upper band "
        "with volume confirmation. Exit on lower-band breach or -3% stop loss."
    )

    def __init__(
        self,
        bb_period: int = 20,
        bb_std: float = 2.0,
        squeeze_lookback: int = 60,
        squeeze_pct: float = 0.10,
        volume_mult: float = 1.5,
        stop_loss_pct: float = 0.03,
    ):
        self.bb_period = bb_period
        self.bb_std = bb_std
        self.squeeze_lookback = squeeze_lookback
        self.squeeze_pct = squeeze_pct
        self.volume_mult = volume_mult
        self.stop_loss_pct = stop_loss_pct

    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add BB columns and 'entry_signal' to df.

        All conditions checked on the PREVIOUS bar to avoid look-ahead bias.
        Signal fires on bar N close → entry executes on bar N+1 open.
        """
        # Bollinger Bands
        mid = df["Close"].rolling(self.bb_period).mean()
        std = df["Close"].rolling(self.bb_period).std()
        upper = mid + self.bb_std * std
        lower = mid - self.bb_std * std
        width = (upper - lower) / mid.replace(0, float("nan"))

        df["BB_Upper"] = upper
        df["BB_Lower"] = lower
        df["BB_Width"] = width

        # Percentile rank: fraction of past values in window that are <= current
        # A low percentile means narrow bands → squeeze condition
        df["BB_Width_Pct"] = width.rolling(self.squeeze_lookback).apply(
            lambda x: float((x[:-1] <= x[-1]).mean()) if len(x) > 1 else float("nan"),
            raw=True,
        )

        # All conditions evaluated on previous bar (shift 1)
        prev_squeeze = df["BB_Width_Pct"].shift(1) < self.squeeze_pct
        prev_breakout = df["Close"].shift(1) > df["BB_Upper"].shift(1)
        prev_volume_ok = df["Volume"].shift(1) > self.volume_mult * df["AvgVolume_20"].shift(1)

        df["entry_signal"] = 0
        df.loc[prev_squeeze & prev_breakout & prev_volume_ok, "entry_signal"] = 1

        return df

    def should_exit(self, position: Position, current_bar: pd.Series) -> tuple[bool, str]:
        """
        Exit on stop loss or lower-band breach.
        """
        # Stop loss
        pct_change = (current_bar["Close"] - position.entry_price) / position.entry_price
        if pct_change <= -self.stop_loss_pct:
            return True, "stop_loss"

        # Price closes below lower BB → momentum exhausted
        if "BB_Lower" in current_bar.index and not pd.isna(current_bar["BB_Lower"]):
            if current_bar["Close"] < current_bar["BB_Lower"]:
                return True, "below_lower_bb"

        return False, ""


# ---------------------------------------------------------------------------
# Convenience runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    from research.backtesting.data_loader import load_symbol
    from research.backtesting.engine import BacktestEngine

    parser = argparse.ArgumentParser(description="BB Squeeze Breakout backtest")
    parser.add_argument("--symbol", default="PLTR")
    parser.add_argument("--days", type=int, default=1095)
    parser.add_argument("--size", type=float, default=10_000)
    args = parser.parse_args()

    print(f"\nLoading {args.symbol} ({args.days} days)...")
    df = load_symbol(args.symbol, lookback_days=args.days)
    print(f"  {len(df)} trading days  ({df.index[0].date()} → {df.index[-1].date()})")

    strategy = BBSqueezeStrategy()
    engine = BacktestEngine(position_size_usd=args.size)
    engine.run(df, strategy, symbol=args.symbol)
    engine.print_results(label=f"BB Squeeze Breakout — {args.symbol}")
