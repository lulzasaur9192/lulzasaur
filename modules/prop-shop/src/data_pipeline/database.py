"""
database.py
SQLite interface for market_data, market_regimes, and data_quality_log tables.
All writes are append-only; historical data is never updated.
"""

import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Generator, Optional

import pandas as pd

logger = logging.getLogger(__name__)

# ---- DDL --------------------------------------------------------------------

DDL_MARKET_DATA = """
CREATE TABLE IF NOT EXISTS market_data (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    symbol      TEXT    NOT NULL,
    open        REAL,
    high        REAL,
    low         REAL,
    close       REAL,
    volume      REAL,
    rsi         REAL,
    macd        REAL,
    macd_signal REAL,
    macd_hist   REAL,
    ema8        REAL,
    ema21       REAL,
    ema50       REAL,
    bb_upper    REAL,
    bb_middle   REAL,
    bb_lower    REAL,
    adx         REAL,
    atr         REAL,
    inserted_at TEXT    NOT NULL,
    UNIQUE (symbol, date)
);
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_date
    ON market_data (symbol, date);
"""

DDL_MARKET_REGIMES = """
CREATE TABLE IF NOT EXISTS market_regimes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT    NOT NULL UNIQUE,
    regime     TEXT    NOT NULL,
    spy_trend  TEXT    NOT NULL,
    vix_level  TEXT    NOT NULL,
    spy_ema8   REAL,
    spy_ema21  REAL,
    vix_close  REAL,
    inserted_at TEXT   NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_market_regimes_date
    ON market_regimes (date);
"""

DDL_DATA_QUALITY_LOG = """
CREATE TABLE IF NOT EXISTS data_quality_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run_date            TEXT    NOT NULL,
    symbol              TEXT    NOT NULL,
    total_rows          INTEGER,
    missing_days_count  INTEGER,
    outlier_rows_count  INTEGER,
    missing_indicator_count INTEGER,
    completeness_pct    REAL,
    is_stale            INTEGER,
    latest_date         TEXT,
    passed              INTEGER,
    errors              TEXT,
    inserted_at         TEXT    NOT NULL
);
"""


# ---- Database class ---------------------------------------------------------

class Database:
    """Thin wrapper around sqlite3 for append-only market data storage."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    # ---- Setup ---------------------------------------------------------------

    def _init_schema(self) -> None:
        """Create tables and indexes if they don't exist."""
        with self._conn() as conn:
            for ddl in (DDL_MARKET_DATA, DDL_MARKET_REGIMES, DDL_DATA_QUALITY_LOG):
                conn.executescript(ddl)
        logger.info("Schema initialized at %s", self.db_path)

    # ---- Writes --------------------------------------------------------------

    def insert_market_data(self, symbol: str, df: pd.DataFrame) -> int:
        """
        Append enriched OHLCV rows for one symbol.
        Rows whose (symbol, date) already exist are silently skipped (INSERT OR IGNORE).

        Returns:
            Number of rows actually inserted.
        """
        if df.empty:
            return 0

        now = datetime.utcnow().isoformat()
        rows = []
        for date, row in df.iterrows():
            rows.append(
                (
                    _fmt_date(date),
                    symbol,
                    _f(row, "open"),
                    _f(row, "high"),
                    _f(row, "low"),
                    _f(row, "close"),
                    _f(row, "volume"),
                    _f(row, "rsi"),
                    _f(row, "macd"),
                    _f(row, "macd_signal"),
                    _f(row, "macd_hist"),
                    _f(row, "ema8"),
                    _f(row, "ema21"),
                    _f(row, "ema50"),
                    _f(row, "bb_upper"),
                    _f(row, "bb_middle"),
                    _f(row, "bb_lower"),
                    _f(row, "adx"),
                    _f(row, "atr"),
                    now,
                )
            )

        sql = """
            INSERT OR IGNORE INTO market_data
                (date, symbol, open, high, low, close, volume,
                 rsi, macd, macd_signal, macd_hist,
                 ema8, ema21, ema50,
                 bb_upper, bb_middle, bb_lower,
                 adx, atr, inserted_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """
        with self._conn() as conn:
            cur = conn.executemany(sql, rows)
            inserted = cur.rowcount
        logger.info("Inserted %d/%d rows for %s", inserted, len(rows), symbol)
        return inserted

    def insert_market_regimes(self, regime_df: pd.DataFrame) -> int:
        """
        Append regime rows. Rows whose date already exists are skipped.

        Returns:
            Number of rows inserted.
        """
        if regime_df.empty:
            return 0

        now = datetime.utcnow().isoformat()
        rows = []
        for date, row in regime_df.iterrows():
            rows.append(
                (
                    _fmt_date(date),
                    str(row.get("regime", "")),
                    str(row.get("spy_trend", "")),
                    str(row.get("vix_level", "")),
                    _f(row, "spy_ema8"),
                    _f(row, "spy_ema21"),
                    _f(row, "vix_close"),
                    now,
                )
            )

        sql = """
            INSERT OR IGNORE INTO market_regimes
                (date, regime, spy_trend, vix_level,
                 spy_ema8, spy_ema21, vix_close, inserted_at)
            VALUES (?,?,?,?,?,?,?,?)
        """
        with self._conn() as conn:
            cur = conn.executemany(sql, rows)
            inserted = cur.rowcount
        logger.info("Inserted %d regime rows", inserted)
        return inserted

    def log_quality_report(self, run_date: str, report) -> None:
        """Persist a QualityReport to the data_quality_log table."""
        now = datetime.utcnow().isoformat()
        sql = """
            INSERT INTO data_quality_log
                (run_date, symbol, total_rows, missing_days_count,
                 outlier_rows_count, missing_indicator_count,
                 completeness_pct, is_stale, latest_date, passed, errors, inserted_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """
        with self._conn() as conn:
            conn.execute(
                sql,
                (
                    run_date,
                    report.symbol,
                    report.total_rows,
                    len(report.missing_market_days),
                    len(report.outlier_rows),
                    len(report.missing_indicator_cols),
                    report.completeness_pct,
                    int(report.is_stale),
                    report.latest_date,
                    int(report.passed),
                    "; ".join(report.errors) if report.errors else None,
                    now,
                ),
            )

    # ---- Reads ---------------------------------------------------------------

    def read_market_data(
        self,
        symbol: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> pd.DataFrame:
        """Read market_data rows, optionally filtered."""
        where_clauses = []
        params: list = []

        if symbol:
            where_clauses.append("symbol = ?")
            params.append(symbol)
        if start_date:
            where_clauses.append("date >= ?")
            params.append(start_date)
        if end_date:
            where_clauses.append("date <= ?")
            params.append(end_date)

        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        sql = f"SELECT * FROM market_data {where} ORDER BY symbol, date"

        with self._conn() as conn:
            return pd.read_sql_query(sql, conn, params=params, parse_dates=["date"])

    def read_market_regimes(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> pd.DataFrame:
        """Read market_regimes, optionally filtered by date range."""
        where_clauses = []
        params: list = []
        if start_date:
            where_clauses.append("date >= ?")
            params.append(start_date)
        if end_date:
            where_clauses.append("date <= ?")
            params.append(end_date)
        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        sql = f"SELECT * FROM market_regimes {where} ORDER BY date"
        with self._conn() as conn:
            return pd.read_sql_query(sql, conn, params=params, parse_dates=["date"])

    # ---- Internal ------------------------------------------------------------

    @contextmanager
    def _conn(self) -> Generator[sqlite3.Connection, None, None]:
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


# ---- Helpers -----------------------------------------------------------------

def _f(row: pd.Series, col: str) -> Optional[float]:
    """Safely extract a float; return None on missing/NaN."""
    val = row.get(col)
    if val is None:
        return None
    try:
        f = float(val)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        return None


def _fmt_date(date) -> str:
    """Convert a date-like index value to ISO string 'YYYY-MM-DD'."""
    if isinstance(date, str):
        return date[:10]
    return pd.Timestamp(date).strftime("%Y-%m-%d")
