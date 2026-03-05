"""
market_regime.py
Classify daily market regime using SPY EMA crossovers and VIX level.

Regimes
-------
BULL_LOW_VIX      SPY uptrend  + VIX < 15
BULL_HIGH_VIX     SPY uptrend  + VIX >= 25
BULL_MED_VIX      SPY uptrend  + 15 <= VIX < 25  (medium — treated separately)
BEAR_LOW_VIX      SPY downtrend + VIX < 15
BEAR_HIGH_VIX     SPY downtrend + VIX >= 25
BEAR_MED_VIX      SPY downtrend + 15 <= VIX < 25
SIDEWAYS_LOW_VIX  Neutral/choppy + VIX < 15
SIDEWAYS_HIGH_VIX Neutral/choppy + VIX >= 25
SIDEWAYS_MED_VIX  Neutral/choppy + 15 <= VIX < 25
"""

import logging
from typing import Optional

import pandas as pd
import pandas_ta as ta

logger = logging.getLogger(__name__)

# VIX thresholds
VIX_LOW = 15.0
VIX_HIGH = 25.0

# EMA periods for SPY trend detection
EMA_FAST = 8
EMA_SLOW = 21

# How many bars EMA fast must be above/below EMA slow to confirm trend
TREND_CONFIRM_BARS = 3


def classify_regimes(
    spy_df: pd.DataFrame,
    vix_df: pd.DataFrame,
) -> pd.DataFrame:
    """
    Classify market regime for each date where both SPY and VIX data exist.

    Args:
        spy_df: OHLCV DataFrame for SPY indexed by date
        vix_df: OHLCV DataFrame for VIX indexed by date

    Returns:
        DataFrame with columns:
            date, regime, spy_trend, vix_level, spy_ema8, spy_ema21, vix_close
        Indexed by date (DatetimeIndex).
    """
    spy = spy_df.copy()
    vix = vix_df.copy()

    # Compute EMAs on SPY close
    spy["ema8"] = ta.ema(spy["close"], length=EMA_FAST)
    spy["ema21"] = ta.ema(spy["close"], length=EMA_SLOW)

    # Align VIX close to SPY dates
    vix_close = vix["close"].reindex(spy.index).ffill()

    # Build working frame
    frame = pd.DataFrame(
        {
            "spy_ema8": spy["ema8"],
            "spy_ema21": spy["ema21"],
            "vix_close": vix_close,
        },
        index=spy.index,
    )
    frame.dropna(inplace=True)

    if frame.empty:
        logger.warning("No overlapping SPY/VIX data — regime table will be empty")
        return _empty_regime_df()

    frame["spy_trend"] = _classify_spy_trend(frame["spy_ema8"], frame["spy_ema21"])
    frame["vix_level"] = frame["vix_close"].apply(_classify_vix)
    frame["regime"] = frame["spy_trend"] + "_" + frame["vix_level"]
    frame.index.name = "date"

    logger.info("Classified %d days of market regime", len(frame))
    return frame[["regime", "spy_trend", "vix_level", "spy_ema8", "spy_ema21", "vix_close"]]


# --- Private helpers -------------------------------------------------------


def _classify_vix(vix_close: float) -> str:
    """Map VIX closing price to a named volatility bucket."""
    if vix_close < VIX_LOW:
        return "LOW_VIX"
    if vix_close >= VIX_HIGH:
        return "HIGH_VIX"
    return "MED_VIX"


def _classify_spy_trend(
    ema_fast: pd.Series,
    ema_slow: pd.Series,
) -> pd.Series:
    """
    Determine SPY trend from EMA8 vs EMA21.

    BULL     — EMA8 > EMA21
    BEAR     — EMA8 < EMA21
    SIDEWAYS — EMAs within 0.1% of each other (near crossover zone)
    """
    pct_diff = (ema_fast - ema_slow) / ema_slow * 100  # percentage difference
    trend = pd.Series(index=ema_fast.index, dtype=str)

    trend[pct_diff > 0.1] = "BULL"
    trend[pct_diff < -0.1] = "BEAR"
    trend[(pct_diff >= -0.1) & (pct_diff <= 0.1)] = "SIDEWAYS"
    return trend


def _empty_regime_df() -> pd.DataFrame:
    return pd.DataFrame(
        columns=["regime", "spy_trend", "vix_level", "spy_ema8", "spy_ema21", "vix_close"]
    )
