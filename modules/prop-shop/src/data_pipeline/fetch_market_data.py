"""
fetch_market_data.py
Fetch OHLCV data for configured symbols using yfinance.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

# Map friendly config names to actual yfinance tickers
SYMBOL_MAP: dict[str, str] = {
    "VIX": "^VIX",
}


def _yf_ticker(symbol: str) -> str:
    """Translate a config-level symbol name to a yfinance ticker."""
    return SYMBOL_MAP.get(symbol, symbol)


def fetch_ohlcv(
    symbol: str,
    start_date: str,
    end_date: Optional[str] = None,
) -> Optional[pd.DataFrame]:
    """
    Fetch OHLCV data for a single symbol from Yahoo Finance.

    Args:
        symbol: Ticker symbol (e.g. 'SPY')
        start_date: ISO date string 'YYYY-MM-DD'
        end_date: ISO date string; defaults to today if None

    Returns:
        DataFrame with columns [open, high, low, close, volume] indexed by date,
        or None if the fetch fails.
    """
    end_date = end_date or datetime.today().strftime("%Y-%m-%d")
    logger.info("Fetching %s from %s to %s", symbol, start_date, end_date)

    # yfinance excludes end_date, so add 1 day to include it
    yf_end = (datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")

    try:
        yf_sym = _yf_ticker(symbol)
        ticker = yf.Ticker(yf_sym)
        df = ticker.history(start=start_date, end=yf_end, auto_adjust=True)

        if df.empty:
            logger.warning("No data returned for %s", symbol)
            return None

        df.index = pd.to_datetime(df.index).tz_localize(None)
        df.index.name = "date"

        # Keep only standard OHLCV columns
        df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
        df.columns = ["open", "high", "low", "close", "volume"]

        # Drop rows where all price columns are NaN
        df.dropna(subset=["open", "high", "low", "close"], how="all", inplace=True)

        # Forward-fill isolated missing values (e.g. single-day gaps)
        df.ffill(inplace=True)

        logger.info("Fetched %d rows for %s", len(df), symbol)
        return df

    except Exception as exc:
        logger.error("Failed to fetch %s: %s", symbol, exc, exc_info=True)
        return None


def fetch_all_symbols(
    symbols: list[str],
    start_date: str,
    end_date: Optional[str] = None,
) -> dict[str, pd.DataFrame]:
    """
    Fetch OHLCV data for multiple symbols.

    Args:
        symbols: List of ticker strings
        start_date: ISO date string
        end_date: ISO date string; defaults to today

    Returns:
        Dict mapping symbol -> DataFrame. Missing symbols are omitted.
    """
    results: dict[str, pd.DataFrame] = {}
    for symbol in symbols:
        df = fetch_ohlcv(symbol, start_date, end_date)
        if df is not None and not df.empty:
            results[symbol] = df
        else:
            logger.warning("Skipping %s — no usable data", symbol)
    return results


def default_start_date(years: int = 2) -> str:
    """Return ISO date string N years before today."""
    return (datetime.today() - timedelta(days=years * 365)).strftime("%Y-%m-%d")
