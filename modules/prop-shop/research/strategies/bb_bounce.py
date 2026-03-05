"""
Bollinger Band Bounce Strategy (Mean Reversion)
================================================

Hypothesis
----------
When price touches or breaks below the lower Bollinger Band (20-period, 2 std dev)
with above-average volume confirmation, mean-reversion pressure tends to push price
back to the middle band (20-period SMA) within 2-5 days.

Entry rules
-----------
  • Close <= Lower Bollinger Band on the prior bar's close  (price touched/pierced lower band)
  • Volume > 20-day average volume on the prior bar         (participation confirms the move)
  • No existing open position in the symbol

Exit rules (first condition hit)
---------------------------------
  1. Close > SMA_20 (middle band) — mean reversion complete
  2. Stop loss: close < entry_price * (1 - stop_loss_pct)  (default -4%)
  3. Max holding period reached (engine-enforced, default 5 days)

Expected targets (volatile tickers: SOFI, PLTR, RIOT)
------------------------------------------------------
  Win rate:       ~55-65%
  Profit factor:  ~1.5-2.5
  Trades:         20+ per 3-year window

Transaction costs are handled by the BacktestEngine ($0.02 slippage + $0.01 commission).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from research.strategies.base_strategy import BaseStrategy, Position


class BBBounceStrategy(BaseStrategy):
    """
    Mean-reversion long strategy using Bollinger Band lower-band touches.

    Parameters
    ----------
    bb_period : int
        Rolling window for Bollinger Band calculation (default 20).
    bb_std : float
        Number of standard deviations for band width (default 2.0).
    stop_loss_pct : float
        Fraction below entry price that triggers stop loss (default 0.04 = 4%).

    Notes
    -----
    Depends on columns added by data_loader.add_indicators():
      - SMA_20      (middle band)
      - AvgVolume_20

    The lower Bollinger Band (SMA_20 - bb_std * rolling_std) is computed
    internally within generate_signals().
    """

    name = "BB Bounce"
    description = (
        "Enter long when close touches/breaks lower Bollinger Band (20-period, 2σ) "
        "with above-average volume. Exit when price reclaims SMA_20 or after max hold."
    )

    _SMA_COL = "SMA_20"
    _AVGVOL_COL = "AvgVolume_20"
    _LOWER_BB_COL = "BB_Lower_20"

    def __init__(
        self,
        bb_period: int = 20,
        bb_std: float = 2.0,
        stop_loss_pct: float = 0.04,
    ):
        self.bb_period = bb_period
        self.bb_std = bb_std
        self.stop_loss_pct = stop_loss_pct

    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add 'entry_signal' column to *df*.

        Signal = 1 when:
          - Previous bar's close was at or below the lower Bollinger Band
          - Previous bar's volume exceeded the 20-day average

        Uses .shift(1) throughout so signals are generated on the prior bar's
        close; the engine enters on the *next* bar's open (no look-ahead bias).
        """
        for col in (self._SMA_COL, self._AVGVOL_COL):
            if col not in df.columns:
                raise ValueError(
                    f"Column '{col}' not found. "
                    "Run data_loader.add_indicators() before calling generate_signals()."
                )

        # Compute lower Bollinger Band from rolling std of Close
        rolling_std = df["Close"].rolling(window=self.bb_period).std()
        df[self._LOWER_BB_COL] = df[self._SMA_COL] - self.bb_std * rolling_std

        # Signals based on previous bar (shift(1) prevents look-ahead)
        prev_close = df["Close"].shift(1)
        prev_lower_band = df[self._LOWER_BB_COL].shift(1)
        prev_volume = df["Volume"].shift(1)
        prev_avg_volume = df[self._AVGVOL_COL].shift(1)

        at_lower_band = prev_close <= prev_lower_band
        volume_confirmed = prev_volume > prev_avg_volume

        df["entry_signal"] = 0
        df.loc[at_lower_band & volume_confirmed, "entry_signal"] = 1

        return df

    def should_exit(self, position: Position, current_bar: pd.Series) -> tuple[bool, str]:
        """
        Exit when price reclaims the middle Bollinger Band (SMA_20) or stop loss hit.

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

        # Mean reversion complete: price reclaimed middle band
        if sma20 is not None and not pd.isna(sma20) and close > sma20:
            return True, "above_middle_band"

        # Stop loss: price dropped too far from entry
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

    parser = argparse.ArgumentParser(description="BB Bounce backtest")
    parser.add_argument("--symbol", default="SOFI", help="Ticker symbol")
    parser.add_argument("--start", default="2023-03-04", help="Start date YYYY-MM-DD")
    parser.add_argument("--size", type=float, default=10_000, help="Position size in USD")
    args = parser.parse_args()

    print(f"\nLoading {args.symbol} from {args.start}...")
    df = load_symbol(args.symbol, start=args.start)
    print(f"  {len(df)} trading days  ({df.index[0].date()} → {df.index[-1].date()})")

    strategy = BBBounceStrategy()
    engine = BacktestEngine(position_size_usd=args.size, max_holding_days=5)
    trades = engine.run(df, strategy, symbol=args.symbol)

    engine.print_results(label=f"BB Bounce — {args.symbol}")

    if trades:
        tdf = engine.trades_df()
        print("\nRecent trades:")
        print(
            tdf[["entry_date", "exit_date", "entry_price", "exit_price",
                 "shares", "fees", "pnl_net", "exit_reason"]].tail(10).to_string(index=False)
        )
