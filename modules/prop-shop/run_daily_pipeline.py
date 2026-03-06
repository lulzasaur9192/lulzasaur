"""
run_daily_pipeline.py
Main orchestrator: fetch → indicators → regime → quality checks → DB write → CSV export.

Usage:
    python run_daily_pipeline.py                    # uses config.yaml defaults
    python run_daily_pipeline.py --config my.yaml   # custom config path
    python run_daily_pipeline.py --start 2023-01-01 # override start date
"""

import argparse
import csv
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
import yaml

# -- Path gymnastics so the script can be run from the project root ----------
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from src.data_pipeline.fetch_market_data import fetch_all_symbols, default_start_date
from src.data_pipeline.technical_indicators import add_indicators
from src.data_pipeline.market_regime import classify_regimes
from src.data_pipeline.data_quality import check_all_symbols
from src.data_pipeline.database import Database
from src.signal_generator import generate_signals
from src.trade_executor import execute_signals

# ---- Logging setup ----------------------------------------------------------

LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(
            LOG_DIR / f"pipeline_{datetime.today().strftime('%Y%m%d')}.log"
        ),
    ],
)
logger = logging.getLogger("pipeline")


# ---- Config loader ----------------------------------------------------------

DEFAULT_CONFIG = ROOT / "config.yaml"


def load_config(path: Path) -> dict:
    with open(path, "r") as fh:
        return yaml.safe_load(fh)


# ---- Pipeline steps ---------------------------------------------------------


def step_fetch(symbols: list[str], start_date: str, end_date: str) -> dict[str, pd.DataFrame]:
    logger.info("=== STEP 1: Fetching OHLCV data ===")
    data = fetch_all_symbols(symbols, start_date, end_date)
    logger.info("Fetched data for %d/%d symbols", len(data), len(symbols))
    return data


def step_indicators(data: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    logger.info("=== STEP 2: Calculating technical indicators ===")
    enriched: dict[str, pd.DataFrame] = {}
    for symbol, df in data.items():
        try:
            enriched[symbol] = add_indicators(df, symbol=symbol)
        except Exception as exc:
            logger.error("Indicator calc failed for %s: %s", symbol, exc)
    logger.info("Indicators added for %d symbols", len(enriched))
    return enriched


def step_regime(
    enriched: dict[str, pd.DataFrame],
) -> pd.DataFrame:
    logger.info("=== STEP 3: Classifying market regime ===")
    spy = enriched.get("SPY")
    vix = enriched.get("VIX")
    if spy is None or vix is None:
        logger.warning("SPY or VIX missing — regime classification skipped")
        return pd.DataFrame()
    regime_df = classify_regimes(spy, vix)
    logger.info("Regime classified for %d dates", len(regime_df))
    return regime_df


def step_quality(
    enriched: dict[str, pd.DataFrame],
    start_date: str,
    end_date: str,
) -> dict:
    logger.info("=== STEP 4: Running data quality checks ===")
    reports = check_all_symbols(enriched, start_date, end_date)
    passed = sum(1 for r in reports.values() if r.passed)
    logger.info(
        "Quality: %d/%d symbols passed", passed, len(reports)
    )
    for r in reports.values():
        level = logging.INFO if r.passed else logging.WARNING
        logger.log(level, r.summary())
    return reports


def step_database(
    db: Database,
    enriched: dict[str, pd.DataFrame],
    regime_df: pd.DataFrame,
    quality_reports: dict,
    run_date: str,
) -> dict[str, int]:
    logger.info("=== STEP 5: Writing to database ===")
    totals: dict[str, int] = {}
    for symbol, df in enriched.items():
        n = db.insert_market_data(symbol, df)
        totals[symbol] = n

    if not regime_df.empty:
        db.insert_market_regimes(regime_df)

    for report in quality_reports.values():
        db.log_quality_report(run_date, report)

    total_rows = sum(totals.values())
    logger.info("DB write complete: %d total rows across %d symbols", total_rows, len(totals))
    return totals


def step_csv_export(
    enriched: dict[str, pd.DataFrame],
    export_dir: Path,
    run_date: str,
) -> Path:
    logger.info("=== STEP 6: Exporting daily CSV snapshot ===")
    export_dir.mkdir(parents=True, exist_ok=True)
    csv_path = export_dir / f"{run_date}.csv"

    frames = []
    for symbol, df in enriched.items():
        row = df.copy()
        row.insert(0, "symbol", symbol)
        frames.append(row)

    if frames:
        combined = pd.concat(frames)
        combined.index.name = "date"
        combined.reset_index(inplace=True)
        combined.to_csv(csv_path, index=False)
        logger.info("CSV snapshot written: %s (%d rows)", csv_path, len(combined))
    else:
        logger.warning("No data to export to CSV")

    return csv_path


# ---- Main -------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the prop-shop data pipeline")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--start", type=str, default=None, help="Override start date YYYY-MM-DD")
    parser.add_argument("--end", type=str, default=None, help="Override end date YYYY-MM-DD")
    args = parser.parse_args()

    t0 = time.time()
    run_date = datetime.today().strftime("%Y-%m-%d")
    logger.info("Pipeline run started: %s", run_date)

    # -- Load config ----------------------------------------------------------
    cfg = load_config(args.config)
    symbols: list[str] = cfg["symbols"]
    start_date: str = args.start or cfg.get("start_date") or default_start_date(years=2)
    end_date: str = args.end or cfg.get("end_date") or run_date

    db_path = ROOT / cfg["database"]["path"]
    daily_dir = ROOT / cfg["export"]["daily_dir"]

    logger.info(
        "Config: symbols=%s  start=%s  end=%s  db=%s",
        symbols,
        start_date,
        end_date,
        db_path,
    )

    # -- Database -------------------------------------------------------------
    db = Database(db_path)

    # -- Pipeline steps -------------------------------------------------------
    errors = 0

    try:
        raw_data = step_fetch(symbols, start_date, end_date)
    except Exception as exc:
        logger.critical("Fetch step failed: %s", exc, exc_info=True)
        sys.exit(1)

    try:
        enriched = step_indicators(raw_data)
    except Exception as exc:
        logger.error("Indicator step failed: %s", exc, exc_info=True)
        enriched = raw_data  # continue with unenriched data
        errors += 1

    try:
        regime_df = step_regime(enriched)
    except Exception as exc:
        logger.error("Regime step failed: %s", exc, exc_info=True)
        regime_df = pd.DataFrame()
        errors += 1

    try:
        quality_reports = step_quality(enriched, start_date, end_date)
    except Exception as exc:
        logger.error("Quality step failed: %s", exc, exc_info=True)
        quality_reports = {}
        errors += 1

    try:
        db_totals = step_database(db, enriched, regime_df, quality_reports, run_date)
    except Exception as exc:
        logger.error("DB write step failed: %s", exc, exc_info=True)
        db_totals = {}
        errors += 1

    try:
        csv_path = step_csv_export(enriched, daily_dir, run_date)
    except Exception as exc:
        logger.error("CSV export step failed: %s", exc, exc_info=True)
        errors += 1

    # -- Step 7: Generate signals ---------------------------------------------
    signals: list = []
    try:
        logger.info("=== STEP 7: Generating trading signals ===")
        signals = generate_signals()
        logger.info("Signals generated: %d signal(s)", len(signals))
        for s in signals:
            logger.info("  SIGNAL: %s RSI=%.1f entry=$%.2f stop=$%.2f",
                        s["ticker"], s["rsi"], s["entry_price"], s["stop_loss"])
    except Exception as exc:
        logger.error("Signal generation failed: %s", exc, exc_info=True)
        errors += 1

    # -- Step 8: Execute approved trades --------------------------------------
    try:
        logger.info("=== STEP 8: Executing approved trades ===")
        trade_results = execute_signals(signals)
        approved = [r for r in trade_results if r.get("approved")]
        rejected = [r for r in trade_results if not r.get("approved")]
        logger.info("Trade execution: %d approved, %d rejected",
                    len(approved), len(rejected))
        for r in approved:
            logger.info("  EXECUTED: %s x%d", r["ticker"], r["quantity"])
        for r in rejected:
            logger.info("  REJECTED: %s — %s", r["ticker"], r["reason"])
    except Exception as exc:
        logger.error("Trade execution failed: %s", exc, exc_info=True)
        errors += 1

    # -- Summary --------------------------------------------------------------
    elapsed = time.time() - t0
    total_records = sum(db_totals.values()) if db_totals else 0
    logger.info(
        "Pipeline complete in %.1fs — records_written=%d  symbols=%d  errors=%d",
        elapsed,
        total_records,
        len(enriched),
        errors,
    )

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
