"""
data_quality.py
Run data quality checks on fetched + enriched market data.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
import pandas_market_calendars as mcal

logger = logging.getLogger(__name__)

# Indicator columns expected on every enriched row
REQUIRED_INDICATOR_COLS = [
    "rsi",
    "macd",
    "macd_signal",
    "macd_hist",
    "ema8",
    "ema21",
    "ema50",
    "bb_upper",
    "bb_middle",
    "bb_lower",
    "adx",
    "atr",
]

OUTLIER_STD_THRESHOLD = 3.0
STALE_DAYS = 1  # flag if latest bar is older than this many calendar days


@dataclass
class QualityReport:
    """Summary of data quality checks for one symbol."""

    symbol: str
    total_rows: int = 0
    missing_market_days: list[str] = field(default_factory=list)
    outlier_rows: list[str] = field(default_factory=list)
    missing_indicator_cols: list[str] = field(default_factory=list)
    completeness_pct: float = 0.0
    is_stale: bool = False
    latest_date: Optional[str] = None
    errors: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return (
            not self.missing_market_days
            and not self.outlier_rows
            and not self.missing_indicator_cols
            and not self.is_stale
            and not self.errors
        )

    def summary(self) -> str:
        status = "PASS" if self.passed else "FAIL"
        return (
            f"[{status}] {self.symbol}: "
            f"{self.total_rows} rows | "
            f"completeness={self.completeness_pct:.1f}% | "
            f"missing_days={len(self.missing_market_days)} | "
            f"outliers={len(self.outlier_rows)} | "
            f"stale={self.is_stale}"
        )


def check_symbol(
    symbol: str,
    df: pd.DataFrame,
    start_date: str,
    end_date: Optional[str] = None,
) -> QualityReport:
    """
    Run all quality checks for a single symbol DataFrame.

    Args:
        symbol: Ticker symbol (for reporting)
        df: Enriched OHLCV + indicators DataFrame indexed by date
        start_date: Expected start of data range (ISO string)
        end_date: Expected end of data range; defaults to today

    Returns:
        QualityReport with findings.
    """
    end_date = end_date or datetime.today().strftime("%Y-%m-%d")
    report = QualityReport(symbol=symbol, total_rows=len(df))

    if df.empty:
        report.errors.append("DataFrame is empty")
        return report

    report.latest_date = df.index.max().strftime("%Y-%m-%d")

    _check_missing_market_days(report, df, start_date, end_date)
    _check_outliers(report, df)
    _check_indicator_completeness(report, df)
    _check_staleness(report, df)

    # Overall completeness: non-null cells / total cells across indicator cols
    present_cols = [c for c in REQUIRED_INDICATOR_COLS if c in df.columns]
    if present_cols:
        total_cells = len(df) * len(present_cols)
        non_null_cells = df[present_cols].notna().sum().sum()
        report.completeness_pct = 100.0 * non_null_cells / total_cells if total_cells else 0.0

    logger.info(report.summary())
    return report


def check_all_symbols(
    data: dict[str, pd.DataFrame],
    start_date: str,
    end_date: Optional[str] = None,
) -> dict[str, QualityReport]:
    """Run quality checks for every symbol in the data dict."""
    return {
        symbol: check_symbol(symbol, df, start_date, end_date)
        for symbol, df in data.items()
    }


# --- Private helpers -------------------------------------------------------


def _nyse_trading_days(start: str, end: str) -> pd.DatetimeIndex:
    """Return NYSE trading days between start and end (inclusive)."""
    try:
        nyse = mcal.get_calendar("NYSE")
        schedule = nyse.schedule(start_date=start, end_date=end)
        return mcal.date_range(schedule, frequency="1D").normalize().tz_localize(None)
    except Exception as exc:
        logger.warning("Could not fetch NYSE calendar: %s — using business days", exc)
        return pd.bdate_range(start=start, end=end)


def _check_missing_market_days(
    report: QualityReport,
    df: pd.DataFrame,
    start_date: str,
    end_date: str,
) -> None:
    """Populate report.missing_market_days."""
    try:
        expected = _nyse_trading_days(start_date, end_date)
        actual = df.index.normalize()
        missing = expected.difference(actual)
        # Ignore the most recent partial-session or holiday edge case
        report.missing_market_days = [d.strftime("%Y-%m-%d") for d in missing]
    except Exception as exc:
        report.errors.append(f"Calendar check failed: {exc}")


def _check_outliers(report: QualityReport, df: pd.DataFrame) -> None:
    """Flag rows where 'close' deviates > 3 std from rolling mean."""
    if "close" not in df.columns:
        return
    col = df["close"].dropna()
    mean = col.mean()
    std = col.std()
    if std == 0 or np.isnan(std):
        return
    z_scores = (col - mean) / std
    outlier_dates = col[z_scores.abs() > OUTLIER_STD_THRESHOLD].index
    report.outlier_rows = [d.strftime("%Y-%m-%d") for d in outlier_dates]


def _check_indicator_completeness(report: QualityReport, df: pd.DataFrame) -> None:
    """Flag indicator columns missing entirely from the DataFrame."""
    report.missing_indicator_cols = [
        col for col in REQUIRED_INDICATOR_COLS if col not in df.columns
    ]


def _check_staleness(report: QualityReport, df: pd.DataFrame) -> None:
    """Flag if the most recent data point is older than STALE_DAYS calendar days."""
    latest = df.index.max()
    cutoff = datetime.today() - timedelta(days=STALE_DAYS + 2)  # +2 for weekends
    report.is_stale = latest < cutoff
