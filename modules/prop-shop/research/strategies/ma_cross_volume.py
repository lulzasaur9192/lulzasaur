"""
Moving Average Crossover with Volume Confirmation Strategy
===========================================================

Hypothesis
----------
SMA(10) crossing above SMA(20) with strong volume and neutral RSI (40-60)
signals genuine upward momentum, not an overbought exhaustion move. This
combination should produce sustained 3-5 day uptrends.

Entry rules
-----------
  • SMA(10) crossed above SMA(20) on the previous bar
    (prev_prev bar: SMA10 < SMA20  →  prev bar: SMA10 >= SMA20)
  • RSI(14) was between 40 and 60 on previous bar (neutral zone, not extended)
  • Volume on previous bar > 1.2x AvgVolume_20 (momentum confirmation)

Exit rules (first condition hit)
---------------------------------
  1. SMA(10) crosses back below SMA(20) (momentum reversal)
  2. Stop loss: -3.5% from entry price
  3. Max holding period reached (engine-enforced, default 5 days)

Notes
-----
SMA_20 is pre-computed by data_loader.add_indicators(). SMA_10 is computed
here inside generate_signals(). Both are then available as current_bar columns
in should_exit().
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from research.strategies.base_strategy import BaseStrategy, Position


class MACrossVolumeStrategy(BaseStrategy):
    """
    Momentum strategy triggered by SMA(10)/SMA(20) golden cross + volume.

    Parameters
    ----------
    fast_period : int
        Fast SMA window (default 10).
    slow_period : int
        Slow SMA window (default 20, should match data_loader SMA_SHORT_PERIOD).
    volume_mult : float
        Volume must exceed this multiple of AvgVolume_20 (default 1.2).
    rsi_min : float
        RSI lower bound for neutral zone (default 40).
    rsi_max : float
        RSI upper bound for neutral zone (default 60).
    stop_loss_pct : float
        Exit if price falls this fraction below entry (default 0.035 = 3.5%).
    rsi_period : int
        RSI lookback (default 14, must match data_loader config).
    """

    name = "MA Crossover with Volume"
    description = (
        "Enter long when SMA(10) crosses above SMA(20) with volume > 1.2x avg "
        "and RSI 40-60. Exit on reverse cross, -3.5% stop loss, or max hold."
    )

    def __init__(
        self,
        fast_period: int = 10,
        slow_period: int = 20,
        volume_mult: float = 1.2,
        rsi_min: float = 40.0,
        rsi_max: float = 60.0,
        stop_loss_pct: float = 0.035,
        rsi_period: int = 14,
    ):
        self.fast_period = fast_period
        self.slow_period = slow_period
        self.volume_mult = volume_mult
        self.rsi_min = rsi_min
        self.rsi_max = rsi_max
        self.stop_loss_pct = stop_loss_pct
        self._rsi_col = f"RSI_{rsi_period}"
        self._fast_col = f"SMA_{fast_period}"
        self._slow_col = f"SMA_{slow_period}"

    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Compute SMA_10, detect crossovers, and add 'entry_signal'.

        Crossover is confirmed on the PREVIOUS bar (shift 1) so that:
          signal fires on bar N → entry executes on bar N+1 open.
        """
        if self._rsi_col not in df.columns:
            raise ValueError(
                f"Column '{self._rsi_col}' missing. "
                "Run data_loader.add_indicators() before generate_signals()."
            )

        # SMA_10 (fast) — not computed by data_loader
        df[self._fast_col] = df["Close"].rolling(self.fast_period).mean()

        # SMA_20 (slow) — already in df from data_loader; recompute if missing
        if self._slow_col not in df.columns:
            df[self._slow_col] = df["Close"].rolling(self.slow_period).mean()

        fast = df[self._fast_col]
        slow = df[self._slow_col]
        rsi = df[self._rsi_col]

        # Crossover detection: at bar N-1 fast crossed above slow
        #   bar N-2: fast < slow  (shift(2) relative to current bar)
        #   bar N-1: fast >= slow (shift(1) relative to current bar)
        cross_just_happened = (fast.shift(2) < slow.shift(2)) & (fast.shift(1) >= slow.shift(1))

        # RSI in neutral zone at bar N-1
        rsi_neutral = (rsi.shift(1) >= self.rsi_min) & (rsi.shift(1) <= self.rsi_max)

        # Volume confirmation at bar N-1
        vol_ok = df["Volume"].shift(1) > self.volume_mult * df["AvgVolume_20"].shift(1)

        df["entry_signal"] = 0
        df.loc[cross_just_happened & rsi_neutral & vol_ok, "entry_signal"] = 1

        return df

    def should_exit(self, position: Position, current_bar: pd.Series) -> tuple[bool, str]:
        """
        Exit on stop loss or fast MA crossing back below slow MA.
        """
        # Stop loss
        pct_change = (current_bar["Close"] - position.entry_price) / position.entry_price
        if pct_change <= -self.stop_loss_pct:
            return True, "stop_loss"

        # Fast MA crosses below slow MA → momentum reversed
        fast = current_bar.get(self._fast_col)
        slow = current_bar.get(self._slow_col)
        if fast is not None and slow is not None:
            if not pd.isna(fast) and not pd.isna(slow):
                if fast < slow:
                    return True, "ma_cross_below"

        return False, ""


# ---------------------------------------------------------------------------
# Convenience runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    from research.backtesting.data_loader import load_symbol
    from research.backtesting.engine import BacktestEngine

    parser = argparse.ArgumentParser(description="MA Crossover + Volume backtest")
    parser.add_argument("--symbol", default="RIOT")
    parser.add_argument("--days", type=int, default=1095)
    parser.add_argument("--size", type=float, default=10_000)
    args = parser.parse_args()

    print(f"\nLoading {args.symbol} ({args.days} days)...")
    df = load_symbol(args.symbol, lookback_days=args.days)
    print(f"  {len(df)} trading days  ({df.index[0].date()} → {df.index[-1].date()})")

    strategy = MACrossVolumeStrategy()
    engine = BacktestEngine(position_size_usd=args.size)
    engine.run(df, strategy, symbol=args.symbol)
    engine.print_results(label=f"MA Crossover + Volume — {args.symbol}")
