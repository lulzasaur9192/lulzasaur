"""
technical_indicators.py
Calculate RSI, MACD, EMA, Bollinger Bands, ADX, and ATR using pandas_ta.
"""

import logging
from typing import Optional

import pandas as pd
import pandas_ta as ta

logger = logging.getLogger(__name__)

# --- Indicator parameters -----------------------------------------------
RSI_PERIOD = 14
MACD_FAST = 12
MACD_SLOW = 26
MACD_SIGNAL = 9
EMA_PERIODS = (8, 21, 50)
BB_PERIOD = 20
BB_STD = 2.0
ADX_PERIOD = 14
ATR_PERIOD = 14

# Minimum bars needed before indicators are meaningful
MIN_BARS = max(MACD_SLOW + MACD_SIGNAL, BB_PERIOD, ADX_PERIOD, max(EMA_PERIODS)) + 10


def add_indicators(df: pd.DataFrame, symbol: str = "") -> pd.DataFrame:
    """
    Append all technical indicators to an OHLCV DataFrame.

    Expected input columns: open, high, low, close, volume
    Added output columns:
        rsi, macd, macd_signal, macd_hist,
        ema8, ema21, ema50,
        bb_upper, bb_middle, bb_lower,
        adx, atr

    Args:
        df: OHLCV DataFrame indexed by date
        symbol: Used only for log messages

    Returns:
        DataFrame with indicator columns appended. Rows where indicators
        cannot yet be computed (early history) are left as NaN.
    """
    if df.empty or len(df) < MIN_BARS:
        logger.warning(
            "%s: only %d bars — indicators may be unreliable (need %d+)",
            symbol or "unknown",
            len(df),
            MIN_BARS,
        )

    df = df.copy()

    try:
        _add_rsi(df)
        _add_macd(df)
        _add_emas(df)
        _add_bollinger(df)
        _add_adx(df)
        _add_atr(df)
    except Exception as exc:
        logger.error("Indicator calculation failed for %s: %s", symbol, exc, exc_info=True)
        raise

    logger.debug("Indicators computed for %s (%d rows)", symbol, len(df))
    return df


# --- Private helpers -------------------------------------------------------


def _add_rsi(df: pd.DataFrame) -> None:
    """Add RSI(14) in-place."""
    rsi = ta.rsi(df["close"], length=RSI_PERIOD)
    df["rsi"] = rsi


def _add_macd(df: pd.DataFrame) -> None:
    """Add MACD(12,26,9) lines in-place."""
    macd_df = ta.macd(
        df["close"],
        fast=MACD_FAST,
        slow=MACD_SLOW,
        signal=MACD_SIGNAL,
    )
    if macd_df is None or macd_df.empty:
        df["macd"] = float("nan")
        df["macd_signal"] = float("nan")
        df["macd_hist"] = float("nan")
        return

    # pandas_ta column names: MACD_12_26_9, MACDh_12_26_9, MACDs_12_26_9
    col_macd = [c for c in macd_df.columns if c.startswith("MACD_")]
    col_hist = [c for c in macd_df.columns if c.startswith("MACDh_")]
    col_signal = [c for c in macd_df.columns if c.startswith("MACDs_")]

    df["macd"] = macd_df[col_macd[0]] if col_macd else float("nan")
    df["macd_signal"] = macd_df[col_signal[0]] if col_signal else float("nan")
    df["macd_hist"] = macd_df[col_hist[0]] if col_hist else float("nan")


def _add_emas(df: pd.DataFrame) -> None:
    """Add EMA(8), EMA(21), EMA(50) in-place."""
    for period in EMA_PERIODS:
        df[f"ema{period}"] = ta.ema(df["close"], length=period)


def _add_bollinger(df: pd.DataFrame) -> None:
    """Add Bollinger Bands(20, 2) in-place."""
    bb = ta.bbands(df["close"], length=BB_PERIOD, std=BB_STD)
    if bb is None or bb.empty:
        df["bb_upper"] = float("nan")
        df["bb_middle"] = float("nan")
        df["bb_lower"] = float("nan")
        return

    col_upper = [c for c in bb.columns if c.startswith("BBU_")]
    col_mid = [c for c in bb.columns if c.startswith("BBM_")]
    col_lower = [c for c in bb.columns if c.startswith("BBL_")]

    df["bb_upper"] = bb[col_upper[0]] if col_upper else float("nan")
    df["bb_middle"] = bb[col_mid[0]] if col_mid else float("nan")
    df["bb_lower"] = bb[col_lower[0]] if col_lower else float("nan")


def _add_adx(df: pd.DataFrame) -> None:
    """Add ADX(14) in-place."""
    adx_df = ta.adx(df["high"], df["low"], df["close"], length=ADX_PERIOD)
    if adx_df is None or adx_df.empty:
        df["adx"] = float("nan")
        return

    col_adx = [c for c in adx_df.columns if c.startswith("ADX_")]
    df["adx"] = adx_df[col_adx[0]] if col_adx else float("nan")


def _add_atr(df: pd.DataFrame) -> None:
    """Add ATR(14) in-place."""
    df["atr"] = ta.atr(df["high"], df["low"], df["close"], length=ATR_PERIOD)
