#!/usr/bin/env python3
"""
Market data fetch, indicator calculation, regime classification, and DB persistence.
Append-only: historical records are never modified.
"""

import os
import sys
import sqlite3
import logging
from datetime import datetime, timedelta
from pathlib import Path

from typing import Optional

import numpy as np
import pandas as pd
import yfinance as yf

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH   = BASE_DIR / "data" / "db"   / "market_data.db"
CSV_DIR   = BASE_DIR / "data" / "daily"
LOG_DIR   = BASE_DIR / "logs"

TODAY     = datetime.today().strftime("%Y-%m-%d")
LOG_PATH  = LOG_DIR / f"data_quality_{TODAY}.log"

# ---------------------------------------------------------------------------
# Symbols
# ---------------------------------------------------------------------------
TRADE_SYMS   = ["SOFI", "PLTR", "XLF", "RIOT", "GDX"]
MARKET_SYMS  = ["SPY", "^VIX"]
ALL_SYMS     = TRADE_SYMS + MARKET_SYMS

LOOKBACK_DAYS = 90   # enough history to prime all indicators

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)


# ===========================================================================
# Database helpers
# ===========================================================================

DDL = """
CREATE TABLE IF NOT EXISTS market_data (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol      TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    open        REAL,
    high        REAL,
    low         REAL,
    close       REAL,
    volume      REAL,
    adj_close   REAL,
    rsi_14      REAL,
    macd        REAL,
    macd_signal REAL,
    macd_hist   REAL,
    ema_8       REAL,
    ema_21      REAL,
    ema_50      REAL,
    bb_upper    REAL,
    bb_middle   REAL,
    bb_lower    REAL,
    adx_14      REAL,
    atr_14      REAL,
    UNIQUE (symbol, date)
);

CREATE TABLE IF NOT EXISTS market_regimes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL UNIQUE,
    spy_trend   TEXT,   -- bull / bear / sideways
    vix_level   TEXT,   -- low / normal / high / extreme
    regime_label TEXT,
    spy_close   REAL,
    vix_close   REAL
);
"""


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(DDL)
    conn.commit()
    return conn


def existing_dates(conn: sqlite3.Connection, symbol: str) -> set:
    cur = conn.execute(
        "SELECT date FROM market_data WHERE symbol = ?", (symbol,)
    )
    return {row[0] for row in cur.fetchall()}


def existing_regime_dates(conn: sqlite3.Connection) -> set:
    cur = conn.execute("SELECT date FROM market_regimes")
    return {row[0] for row in cur.fetchall()}


# ===========================================================================
# Indicator calculations (pure pandas / numpy — no ta-lib dependency)
# ===========================================================================

def calc_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain  = delta.clip(lower=0)
    loss  = (-delta).clip(lower=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs   = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def calc_macd(series: pd.Series, fast=12, slow=26, signal=9):
    ema_fast   = series.ewm(span=fast,   adjust=False).mean()
    ema_slow   = series.ewm(span=slow,   adjust=False).mean()
    macd_line  = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist       = macd_line - signal_line
    return macd_line, signal_line, hist


def calc_ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def calc_bollinger(series: pd.Series, period=20, std_dev=2):
    middle = series.rolling(period).mean()
    std    = series.rolling(period).std(ddof=0)
    upper  = middle + std_dev * std
    lower  = middle - std_dev * std
    return upper, middle, lower


def calc_atr(high: pd.Series, low: pd.Series, close: pd.Series, period=14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(com=period - 1, min_periods=period).mean()


def calc_adx(high: pd.Series, low: pd.Series, close: pd.Series, period=14) -> pd.Series:
    prev_high  = high.shift(1)
    prev_low   = low.shift(1)
    prev_close = close.shift(1)

    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)

    up_move   = high - prev_high
    down_move = prev_low - low

    plus_dm  = np.where((up_move > down_move) & (up_move > 0), up_move,  0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    atr_s     = pd.Series(tr).ewm(com=period - 1, min_periods=period).mean()
    plus_di   = 100 * pd.Series(plus_dm,  index=close.index).ewm(com=period - 1, min_periods=period).mean() / atr_s
    minus_di  = 100 * pd.Series(minus_dm, index=close.index).ewm(com=period - 1, min_periods=period).mean() / atr_s

    dx        = (100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan))
    adx       = dx.ewm(com=period - 1, min_periods=period).mean()
    return adx


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    c = df["close"]
    h = df["high"]
    l = df["low"]

    df["rsi_14"]      = calc_rsi(c, 14)
    macd, sig, hist   = calc_macd(c)
    df["macd"]        = macd
    df["macd_signal"] = sig
    df["macd_hist"]   = hist
    df["ema_8"]       = calc_ema(c, 8)
    df["ema_21"]      = calc_ema(c, 21)
    df["ema_50"]      = calc_ema(c, 50)
    bbu, bbm, bbl     = calc_bollinger(c)
    df["bb_upper"]    = bbu
    df["bb_middle"]   = bbm
    df["bb_lower"]    = bbl
    df["atr_14"]      = calc_atr(h, l, c, 14)
    df["adx_14"]      = calc_adx(h, l, c, 14)

    return df


# ===========================================================================
# Market regime classification
# ===========================================================================

def classify_regime(spy_df: pd.DataFrame, vix_df: pd.DataFrame) -> pd.DataFrame:
    """
    SPY trend  : bull if EMA8 > EMA21 > EMA50; bear if reverse; else sideways
    VIX level  : low <15, normal 15-25, high 25-35, extreme >35
    """
    spy = spy_df[["date", "close", "ema_8", "ema_21", "ema_50"]].copy()
    vix = vix_df[["date", "close"]].rename(columns={"close": "vix_close"})

    merged = spy.merge(vix, on="date", how="inner")

    def spy_trend(row):
        if row["ema_8"] > row["ema_21"] and row["ema_21"] > row["ema_50"]:
            return "bull"
        elif row["ema_8"] < row["ema_21"] and row["ema_21"] < row["ema_50"]:
            return "bear"
        return "sideways"

    def vix_level(v):
        if v < 15:
            return "low"
        elif v < 25:
            return "normal"
        elif v < 35:
            return "high"
        return "extreme"

    merged["spy_trend"]   = merged.apply(spy_trend, axis=1)
    merged["vix_level"]   = merged["vix_close"].apply(vix_level)
    merged["regime_label"] = merged["spy_trend"] + "_" + merged["vix_level"]
    merged["spy_close"]   = merged["close"]

    return merged[["date", "spy_trend", "vix_level", "regime_label", "spy_close", "vix_close"]]


# ===========================================================================
# Data quality checks
# ===========================================================================

def quality_checks(df: pd.DataFrame, symbol: str) -> bool:
    """Return True if data passes all checks; log failures."""
    passed = True

    # 1. Missing OHLCV
    ohlcv = ["open", "high", "low", "close", "volume"]
    missing = df[ohlcv].isnull().sum()
    if missing.any():
        log.warning("[QC] %s – missing values: %s", symbol, missing[missing > 0].to_dict())
        passed = False

    # 2. Stale data: last date must be within 5 calendar days
    last_date = pd.to_datetime(df["date"].max())
    gap = (datetime.today() - last_date).days
    if gap > 5:
        log.warning("[QC] %s – stale data: last record is %s (%d days old)", symbol, last_date.date(), gap)
        passed = False

    # 3. Price gaps / outliers (>5 std-dev daily returns)
    returns = df["close"].pct_change().dropna()
    if len(returns) > 1:
        mean_r = returns.mean()
        std_r  = returns.std()
        if std_r > 0:
            outliers = returns[(returns - mean_r).abs() > 5 * std_r]
            if not outliers.empty:
                log.warning("[QC] %s – outlier returns on: %s", symbol, list(outliers.index))
                passed = False

    # 4. Negative prices
    neg = (df[["open", "high", "low", "close"]] < 0).any(axis=None)
    if neg:
        log.warning("[QC] %s – negative price detected", symbol)
        passed = False

    # 5. OHLC sanity: high >= low, high >= open/close, low <= open/close
    bad_hl  = (df["high"] < df["low"]).sum()
    if bad_hl:
        log.warning("[QC] %s – high < low on %d rows", symbol, bad_hl)
        passed = False

    return passed


# ===========================================================================
# Fetch & process
# ===========================================================================

def fetch_symbol(symbol: str, start: str, end: str) -> Optional[pd.DataFrame]:
    log.info("Fetching %s  [%s → %s]", symbol, start, end)
    try:
        raw = yf.download(symbol, start=start, end=end, auto_adjust=False, progress=False)
    except Exception as exc:
        log.error("Download failed for %s: %s", symbol, exc)
        return None

    if raw.empty:
        log.error("No data returned for %s", symbol)
        return None

    # yfinance may return MultiIndex columns when downloading a single symbol
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)

    raw.columns = [c.lower().replace(" ", "_") for c in raw.columns]

    # Normalise column names
    rename_map = {
        "adj_close": "adj_close",
        "open": "open", "high": "high", "low": "low",
        "close": "close", "volume": "volume",
    }
    raw = raw.rename(columns=rename_map)

    df = raw.reset_index().rename(columns={"Date": "date", "index": "date"})
    df["date"]   = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    df["symbol"] = symbol

    # Ensure expected columns exist
    for col in ["adj_close", "volume"]:
        if col not in df.columns:
            df[col] = np.nan

    return df


def process_symbol(symbol: str, start: str, end: str) -> Optional[pd.DataFrame]:
    df = fetch_symbol(symbol, start, end)
    if df is None:
        return None

    if not quality_checks(df, symbol):
        log.warning("[QC] %s – data quality issues found; still proceeding with available data", symbol)

    df = add_indicators(df)
    return df


# ===========================================================================
# Database write (append-only)
# ===========================================================================

MARKET_DATA_COLS = [
    "symbol", "date", "open", "high", "low", "close", "volume", "adj_close",
    "rsi_14", "macd", "macd_signal", "macd_hist",
    "ema_8", "ema_21", "ema_50",
    "bb_upper", "bb_middle", "bb_lower",
    "adx_14", "atr_14",
]


def write_market_data(conn: sqlite3.Connection, df: pd.DataFrame, symbol: str) -> int:
    known = existing_dates(conn, symbol)
    new_rows = df[~df["date"].isin(known)].copy()

    if new_rows.empty:
        log.info("%s – no new rows to insert", symbol)
        return 0

    for col in MARKET_DATA_COLS:
        if col not in new_rows.columns:
            new_rows[col] = np.nan

    rows = new_rows[MARKET_DATA_COLS].replace({np.nan: None}).to_dict("records")
    placeholders = ", ".join(["?"] * len(MARKET_DATA_COLS))
    cols_str     = ", ".join(MARKET_DATA_COLS)

    conn.executemany(
        f"INSERT OR IGNORE INTO market_data ({cols_str}) VALUES ({placeholders})",
        [tuple(r[c] for c in MARKET_DATA_COLS) for r in rows],
    )
    conn.commit()
    log.info("%s – inserted %d new rows", symbol, len(rows))
    return len(rows)


def write_regimes(conn: sqlite3.Connection, regime_df: pd.DataFrame) -> int:
    known    = existing_regime_dates(conn)
    new_rows = regime_df[~regime_df["date"].isin(known)].copy()

    if new_rows.empty:
        log.info("Regimes – no new rows to insert")
        return 0

    cols = ["date", "spy_trend", "vix_level", "regime_label", "spy_close", "vix_close"]
    rows = new_rows[cols].replace({np.nan: None}).to_dict("records")
    placeholders = ", ".join(["?"] * len(cols))
    cols_str     = ", ".join(cols)

    conn.executemany(
        f"INSERT OR IGNORE INTO market_regimes ({cols_str}) VALUES ({placeholders})",
        [tuple(r[c] for c in cols) for r in rows],
    )
    conn.commit()
    log.info("Regimes – inserted %d new rows", len(rows))
    return len(rows)


# ===========================================================================
# Daily CSV export
# ===========================================================================

def export_daily_csv(conn: sqlite3.Connection, date_str: str) -> None:
    md = pd.read_sql(
        "SELECT * FROM market_data WHERE date = ?", conn, params=(date_str,)
    )
    reg = pd.read_sql(
        "SELECT * FROM market_regimes WHERE date = ?", conn, params=(date_str,)
    )

    CSV_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = CSV_DIR / f"{date_str}.csv"

    combined = pd.merge(md, reg.add_prefix("regime_"), left_on="date",
                        right_on="regime_date", how="left") \
                 .drop(columns=["regime_date", "regime_id"], errors="ignore")

    combined.to_csv(csv_path, index=False)
    log.info("CSV exported → %s  (%d rows)", csv_path, len(combined))


# ===========================================================================
# Main
# ===========================================================================

def main() -> None:
    end_date   = datetime.today().strftime("%Y-%m-%d")
    start_date = (datetime.today() - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    log.info("=" * 60)
    log.info("Market data pipeline  %s", TODAY)
    log.info("Fetching %s → %s", start_date, end_date)
    log.info("Symbols: %s", ALL_SYMS)
    log.info("=" * 60)

    conn = get_conn()
    processed: dict[str, pd.DataFrame] = {}

    for sym in ALL_SYMS:
        df = process_symbol(sym, start_date, end_date)
        if df is not None:
            write_market_data(conn, df, sym)
            processed[sym] = df

    # Market regime classification requires both SPY and ^VIX
    if "SPY" in processed and "^VIX" in processed:
        regime_df = classify_regime(processed["SPY"], processed["^VIX"])
        write_regimes(conn, regime_df)
    else:
        log.error("Cannot classify regimes: SPY or ^VIX data missing")

    # Export latest available trading day snapshot
    cur = conn.execute("SELECT MAX(date) FROM market_data")
    latest_date = cur.fetchone()[0] or TODAY
    export_daily_csv(conn, latest_date)

    conn.close()
    log.info("Pipeline complete. DB: %s", DB_PATH)


if __name__ == "__main__":
    main()
