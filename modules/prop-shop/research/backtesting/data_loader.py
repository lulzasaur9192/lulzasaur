"""
Market data loader with local caching and technical indicator calculation.

Uses yfinance for OHLCV data. Caches to disk so repeated runs don't
hammer the API. All indicators are computed with pandas_ta.
"""

import os
import pickle
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd
import numpy as np

try:
    import yfinance as yf
except ImportError:
    raise ImportError("Run: pip install yfinance")

try:
    from ta.momentum import RSIIndicator
except ImportError:
    raise ImportError("Run: pip install ta")

# Pull cache dir from config if available, else use a sensible default
try:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from config import DATA_CACHE_DIR, RSI_PERIOD, SMA_SHORT_PERIOD, SMA_LONG_PERIOD
except ImportError:
    DATA_CACHE_DIR = "research/.data_cache"
    RSI_PERIOD = 14
    SMA_SHORT_PERIOD = 20
    SMA_LONG_PERIOD = 50

CACHE_DIR = Path(DATA_CACHE_DIR)


def _cache_path(symbol: str, start: str, end: str) -> Path:
    """Return a deterministic cache file path for a (symbol, date range) combo."""
    key = f"{symbol}_{start}_{end}"
    digest = hashlib.md5(key.encode()).hexdigest()[:8]
    return CACHE_DIR / f"{symbol}_{digest}.pkl"


def _load_from_cache(path: Path) -> Optional[pd.DataFrame]:
    if path.exists():
        try:
            with open(path, "rb") as f:
                return pickle.load(f)
        except Exception:
            path.unlink(missing_ok=True)  # corrupt cache – delete and re-fetch
    return None


def _save_to_cache(df: pd.DataFrame, path: Path) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(df, f)


def fetch_ohlcv(
    symbol: str,
    start: str,
    end: Optional[str] = None,
    use_cache: bool = True,
) -> pd.DataFrame:
    """
    Fetch OHLCV data for *symbol* between *start* and *end*.

    Parameters
    ----------
    symbol : str
        Ticker symbol, e.g. 'SPY'.
    start : str
        Start date in 'YYYY-MM-DD' format.
    end : str, optional
        End date in 'YYYY-MM-DD'. Defaults to today.
    use_cache : bool
        If True, read from / write to the local pickle cache.

    Returns
    -------
    pd.DataFrame
        DatetimeIndex, columns: Open, High, Low, Close, Volume.
        Index is timezone-naive.
    """
    if end is None:
        end = datetime.today().strftime("%Y-%m-%d")

    cache_path = _cache_path(symbol, start, end)

    if use_cache:
        cached = _load_from_cache(cache_path)
        if cached is not None:
            return cached

    ticker = yf.Ticker(symbol)
    df = ticker.history(start=start, end=end, auto_adjust=True)

    if df.empty:
        raise ValueError(f"No data returned for {symbol} ({start} → {end}). "
                         "Check symbol spelling and date range.")

    # Normalize columns and drop yfinance extras (Dividends, Stock Splits)
    df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    df.index = pd.to_datetime(df.index).tz_localize(None)
    df.sort_index(inplace=True)

    if use_cache:
        _save_to_cache(df, cache_path)

    return df


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add RSI, SMA-20, SMA-50, and average volume to a raw OHLCV DataFrame.

    Returns a new DataFrame (does not modify in place).
    """
    df = df.copy()

    # RSI(14)
    df[f"RSI_{RSI_PERIOD}"] = RSIIndicator(close=df["Close"], window=RSI_PERIOD).rsi()

    # Simple moving averages
    df[f"SMA_{SMA_SHORT_PERIOD}"] = df["Close"].rolling(window=SMA_SHORT_PERIOD).mean()
    df[f"SMA_{SMA_LONG_PERIOD}"] = df["Close"].rolling(window=SMA_LONG_PERIOD).mean()

    # 20-day rolling average volume (useful for liquidity checks)
    df["AvgVolume_20"] = df["Volume"].rolling(window=20).mean()

    return df


def load_symbol(
    symbol: str,
    lookback_days: int = 90,
    start: Optional[str] = None,
    end: Optional[str] = None,
    use_cache: bool = True,
) -> pd.DataFrame:
    """
    Convenience wrapper: fetch data + add indicators in one call.

    Parameters
    ----------
    symbol : str
        Ticker symbol.
    lookback_days : int
        If *start* is None, look back this many calendar days from *end*.
    start : str, optional
        Explicit start date (overrides *lookback_days*).
    end : str, optional
        Explicit end date. Defaults to today.
    use_cache : bool
        Pass through to fetch_ohlcv.

    Returns
    -------
    pd.DataFrame
        OHLCV + indicators, NaN rows at top from indicator warm-up trimmed.
    """
    if end is None:
        end = datetime.today().strftime("%Y-%m-%d")
    if start is None:
        start_dt = datetime.strptime(end, "%Y-%m-%d") - timedelta(days=lookback_days)
        start = start_dt.strftime("%Y-%m-%d")

    df = fetch_ohlcv(symbol, start=start, end=end, use_cache=use_cache)
    df = add_indicators(df)

    # Drop rows where indicators haven't warmed up yet
    df.dropna(subset=[f"RSI_{RSI_PERIOD}"], inplace=True)

    return df


def load_symbols(
    symbols: list[str],
    lookback_days: int = 90,
    start: Optional[str] = None,
    end: Optional[str] = None,
    use_cache: bool = True,
) -> dict[str, pd.DataFrame]:
    """Load multiple symbols and return a dict keyed by symbol."""
    return {
        sym: load_symbol(sym, lookback_days=lookback_days, start=start, end=end, use_cache=use_cache)
        for sym in symbols
    }


if __name__ == "__main__":
    # Quick smoke test
    print("Loading SPY (last 90 days)...")
    df = load_symbol("SPY", lookback_days=90)
    print(df.tail())
    print(f"\nColumns: {list(df.columns)}")
    print(f"Rows: {len(df)}")
