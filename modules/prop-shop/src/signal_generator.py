"""
signal_generator.py — RSI Oversold Bounce Signal Generator

Queries market_data.db for the latest RSI values and produces trading signals
for the RSI Oversold Bounce strategy (RSI < 40 = buy signal).

Usage:
    from src.signal_generator import generate_signals
    signals = generate_signals()
    # returns list of dicts: {ticker, signal_type, entry_price, stop_loss,
    #                          target_quantity, rsi, atr, timestamp}
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# RSI threshold for oversold signal
RSI_OVERSOLD_THRESHOLD = 40.0

# Only trade tickers with validated backtests (PLTR: 78.3% WR, GDX: 65.2% WR)
# SOFI/XLF/RIOT/SPY explicitly excluded — failed validation criteria
ALLOWED_TICKERS: set[str] = {"PLTR", "GDX"}

# Stop loss = entry - ATR_MULTIPLIER * ATR  (2 ATR below entry)
ATR_MULTIPLIER = 2.0

# Risk per trade in dollars (fed into risk_rules for position sizing)
RISK_PER_TRADE_DOLLARS = 50.0  # 5% of $1,000 starting balance

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "db" / "market_data.db"


def _latest_rows(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Return the most recent row per symbol from market_data."""
    cursor = conn.execute(
        """
        SELECT m.symbol, m.date, m.close, m.rsi, m.atr
        FROM market_data m
        INNER JOIN (
            SELECT symbol, MAX(date) AS max_date
            FROM market_data
            GROUP BY symbol
        ) latest ON m.symbol = latest.symbol AND m.date = latest.max_date
        WHERE m.rsi IS NOT NULL
          AND m.atr IS NOT NULL
          AND m.close IS NOT NULL
        ORDER BY m.symbol
        """
    )
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def generate_signals(db_path: Path = DB_PATH) -> list[dict[str, Any]]:
    """
    Query latest market data and return RSI oversold buy signals.

    Returns:
        List of signal dicts, each containing:
            ticker        - stock symbol
            signal_type   - always "BUY" for RSI oversold
            entry_price   - latest close price
            stop_loss     - entry - (ATR_MULTIPLIER * ATR)
            risk_dollars  - dollar risk for this trade
            rsi           - RSI value that triggered the signal
            atr           - ATR value used for stop calculation
            data_date     - date of the data row
            generated_at  - ISO timestamp when signal was created
    """
    if not db_path.exists():
        logger.error("market_data.db not found at %s — run the daily pipeline first", db_path)
        return []

    signals: list[dict[str, Any]] = []
    now = datetime.now().isoformat()

    try:
        with sqlite3.connect(db_path) as conn:
            rows = _latest_rows(conn)
    except sqlite3.Error as exc:
        logger.error("DB query failed: %s", exc)
        return []

    logger.info("Scanning %d symbols for RSI oversold signals (threshold: RSI < %.0f)",
                len(rows), RSI_OVERSOLD_THRESHOLD)

    for row in rows:
        symbol = row["symbol"]

        # Skip non-validated tickers
        if symbol not in ALLOWED_TICKERS:
            logger.debug("%s: not in ALLOWED_TICKERS — skipping", symbol)
            continue

        rsi = float(row["rsi"])
        close = float(row["close"])
        atr = float(row["atr"])
        data_date = row["date"]

        if rsi >= RSI_OVERSOLD_THRESHOLD:
            logger.debug("%s: RSI=%.1f — no signal", symbol, rsi)
            continue

        stop_loss = round(close - ATR_MULTIPLIER * atr, 4)
        if stop_loss <= 0:
            logger.warning("%s: stop_loss would be <= 0 (%.4f) — skipping", symbol, stop_loss)
            continue

        signal = {
            "ticker": symbol,
            "signal_type": "BUY",
            "entry_price": round(close, 4),
            "stop_loss": stop_loss,
            "risk_dollars": RISK_PER_TRADE_DOLLARS,
            "rsi": round(rsi, 2),
            "atr": round(atr, 4),
            "data_date": data_date,
            "generated_at": now,
        }
        signals.append(signal)
        logger.info("SIGNAL: %s RSI=%.1f close=%.2f stop=%.2f", symbol, rsi, close, stop_loss)

    logger.info("Signal scan complete: %d signal(s) generated", len(signals))
    return signals


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s  %(levelname)-8s  %(name)s: %(message)s")
    results = generate_signals()
    if results:
        for s in results:
            print(f"  {s['ticker']}: RSI={s['rsi']}  entry=${s['entry_price']}  "
                  f"stop=${s['stop_loss']}  risk=${s['risk_dollars']}")
    else:
        print("No signals generated.")
