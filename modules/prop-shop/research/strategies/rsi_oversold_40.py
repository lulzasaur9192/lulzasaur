"""
RSI Oversold Bounce Strategy (Relaxed Threshold — RSI < 40)
============================================================

Hypothesis
----------
When a liquid ETF/stock's RSI(14) drops below 40 (moderately oversold),
mean-reversion pressure tends to push price back up within 2-5 days.
Uses a more relaxed entry threshold than rsi_oversold.py (35) to generate
more trade signals for better statistical validation.

Entry rules
-----------
  • RSI(14) < 40  (oversold on the prior bar's close)
  • No existing open position in the symbol

Exit rules (first condition hit)
---------------------------------
  1. RSI(14) > 65 (overbought – take profit, mean reversion complete)
  2. Max holding period reached (engine-enforced, default 5 days)
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from research.strategies.base_strategy import BaseStrategy, Position

RSI_PERIOD = 14
RSI_OVERSOLD_THRESHOLD = 40
RSI_OVERBOUGHT_THRESHOLD = 65


class RSIOversold40Strategy(BaseStrategy):
    """
    Mean-reversion long strategy based on RSI oversold conditions (threshold 40).

    Parameters
    ----------
    rsi_period : int
        RSI lookback window (default 14).
    oversold : float
        RSI level below which to enter long (default 40).
    overbought : float
        RSI level above which to exit long (default 65).
    """

    name = "RSI Oversold Bounce (RSI<40)"
    description = (
        "Enter long when RSI(14) < 40 (oversold). "
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
