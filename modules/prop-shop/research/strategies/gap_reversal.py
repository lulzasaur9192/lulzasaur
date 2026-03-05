"""
Mean Reversion After Gap Down Strategy
========================================

Hypothesis
----------
Stocks that gap down >2% from the prior close on no significant news (proxied
by volume not being anomalously high) tend to recover within 2-3 days as
market makers fill the gap.

Entry rules
-----------
  • Gap down > 2%: (Open - prev_Close) / prev_Close < -0.02
  • RSI(14) < 45 on the gap day (confirming oversold pressure)
  • Volume < 3x AvgVolume_20 (proxy for no major news event)

Exit rules (first condition hit)
---------------------------------
  1. 80% of gap filled: close >= gap_open + 0.80 * (prev_close - gap_open)
  2. Stop loss: -4% from entry price
  3. Max holding period reached (engine-enforced, default 5 days)

Notes
-----
Entry executes on the open of the bar following the signal (engine convention).
The gap fill target is precomputed in generate_signals() and looked up in
should_exit() via a dict keyed by position entry date.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from research.strategies.base_strategy import BaseStrategy, Position


class GapReversalStrategy(BaseStrategy):
    """
    Mean-reversion strategy that fades gap-down openings.

    Parameters
    ----------
    gap_pct : float
        Minimum gap down as a fraction of prev close (default 0.02 = 2%).
    rsi_max : float
        RSI must be below this threshold on gap day (default 45).
    vol_news_mult : float
        Exclude signals where volume > this × AvgVolume_20 (default 3.0).
    gap_fill_pct : float
        Fraction of gap to recover before exiting (default 0.80 = 80%).
    stop_loss_pct : float
        Exit if price falls this fraction below entry (default 0.04 = 4%).
    rsi_period : int
        RSI lookback (default 14, must match data_loader config).
    """

    name = "Mean Reversion After Gap Down"
    description = (
        "Enter long after a >2% gap down with RSI < 45 and no news-volume spike. "
        "Exit when 80% of gap fills, -4% stop loss, or max hold reached."
    )

    def __init__(
        self,
        gap_pct: float = 0.02,
        rsi_max: float = 45.0,
        vol_news_mult: float = 3.0,
        gap_fill_pct: float = 0.80,
        stop_loss_pct: float = 0.04,
        rsi_period: int = 14,
    ):
        self.gap_pct = gap_pct
        self.rsi_max = rsi_max
        self.vol_news_mult = vol_news_mult
        self.gap_fill_pct = gap_fill_pct
        self.stop_loss_pct = stop_loss_pct
        self._rsi_col = f"RSI_{rsi_period}"
        # {entry_date → gap_fill_target_price} — populated in generate_signals
        self._gap_targets: dict = {}

    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Detect gap-down days and precompute fill targets.

        Signal uses same-bar data (gap and RSI are observable on the signal bar's
        close). Entry executes on the NEXT bar's open (engine convention).
        """
        self._gap_targets = {}

        if self._rsi_col not in df.columns:
            raise ValueError(
                f"Column '{self._rsi_col}' missing. "
                "Run data_loader.add_indicators() before generate_signals()."
            )

        prev_close = df["Close"].shift(1)
        gap_return = (df["Open"] - prev_close) / prev_close.replace(0, float("nan"))

        gap_down = gap_return < -self.gap_pct
        rsi_ok = df[self._rsi_col] < self.rsi_max
        vol_ok = df["Volume"] < self.vol_news_mult * df["AvgVolume_20"]

        signal_mask = gap_down & rsi_ok & vol_ok

        df["entry_signal"] = 0
        df.loc[signal_mask, "entry_signal"] = 1

        # Precompute gap fill targets keyed by the ENTRY bar date (bar N+1)
        index_list = df.index.tolist()
        for i, (date, row) in enumerate(df.iterrows()):
            if row["entry_signal"] != 1 or i + 1 >= len(index_list):
                continue
            entry_date = index_list[i + 1]
            gap_open = row["Open"]
            prior_close = prev_close.iloc[i]
            if pd.isna(prior_close) or prior_close <= 0:
                continue
            gap_size = prior_close - gap_open  # positive: prior_close > gap_open
            self._gap_targets[entry_date] = gap_open + self.gap_fill_pct * gap_size

        return df

    def should_exit(self, position: Position, current_bar: pd.Series) -> tuple[bool, str]:
        """
        Exit on stop loss or gap fill.
        """
        # Stop loss
        pct_change = (current_bar["Close"] - position.entry_price) / position.entry_price
        if pct_change <= -self.stop_loss_pct:
            return True, "stop_loss"

        # Gap fill target reached
        target = self._gap_targets.get(position.entry_date)
        if target is not None and current_bar["Close"] >= target:
            return True, "gap_filled"

        return False, ""


# ---------------------------------------------------------------------------
# Convenience runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    from research.backtesting.data_loader import load_symbol
    from research.backtesting.engine import BacktestEngine

    parser = argparse.ArgumentParser(description="Gap Reversal backtest")
    parser.add_argument("--symbol", default="SOFI")
    parser.add_argument("--days", type=int, default=1095)
    parser.add_argument("--size", type=float, default=10_000)
    args = parser.parse_args()

    print(f"\nLoading {args.symbol} ({args.days} days)...")
    df = load_symbol(args.symbol, lookback_days=args.days)
    print(f"  {len(df)} trading days  ({df.index[0].date()} → {df.index[-1].date()})")

    strategy = GapReversalStrategy()
    engine = BacktestEngine(position_size_usd=args.size)
    engine.run(df, strategy, symbol=args.symbol)
    engine.print_results(label=f"Gap Reversal — {args.symbol}")
