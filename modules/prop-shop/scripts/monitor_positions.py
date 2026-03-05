"""
monitor_positions.py — Position Monitor & Exit Manager

Checks all open positions across Tastytrade paper accounts, evaluates exit
conditions, and closes positions that trigger any exit rule.

Exit rules (evaluated in priority order):
    1. Emergency:    SPY down >5% intraday → close ALL positions
    2. Stop loss:    Position down -5% from entry → close
    3. Profit target: Position up +2% from entry → close
    4. RSI recovery: RSI(14) > 50 (from market_data.db) → close
    5. Time stop:    Position held 5+ trading days (business days) → close

Usage:
    python scripts/monitor_positions.py
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Path setup — resolve project root regardless of where this is run from
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "risk_manager"))

import risk_rules  # noqa: E402 — must come after sys.path update

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PAPER_ACCOUNTS = ["5WI44426", "5WY37789"]
ENV_PATH = ROOT / ".env"
RISK_STATE_PATH = ROOT / "risk_manager" / "risk_state.json"
MARKET_DB_PATH = ROOT / "data" / "db" / "market_data.db"
LOGS_DIR = ROOT / "logs"

STOP_LOSS_PCT: float = 0.05       # -5% from entry
PROFIT_TARGET_PCT: float = 0.02   # +2% from entry
RSI_RECOVERY_THRESHOLD: float = 50.0
TIME_STOP_TRADING_DAYS: int = 5
SPY_EMERGENCY_DROP_PCT: float = 0.05  # matches risk_rules.EMERGENCY_MARKET_DROP_PCT

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------


def _setup_logging() -> logging.Logger:
    LOGS_DIR.mkdir(exist_ok=True)
    log_file = LOGS_DIR / f"position_monitor_{date.today().isoformat()}.log"

    fmt = "%(asctime)s  %(levelname)-8s  %(name)s: %(message)s"
    logging.basicConfig(
        level=logging.INFO,
        format=fmt,
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler(sys.stdout),
        ],
    )
    return logging.getLogger("monitor_positions")


logger = _setup_logging()

# ---------------------------------------------------------------------------
# Risk state helpers
# ---------------------------------------------------------------------------


def _load_state() -> dict[str, Any]:
    with open(RISK_STATE_PATH) as f:
        return json.load(f)


def _save_state(state: dict[str, Any]) -> None:
    with open(RISK_STATE_PATH, "w") as f:
        json.dump(state, f, indent=2)


# ---------------------------------------------------------------------------
# Tastytrade session
# ---------------------------------------------------------------------------


async def _get_session():
    from tastytrade import Session

    load_dotenv(ENV_PATH)
    client_secret = os.getenv("TASTYTRADE_CLIENT_SECRET")
    refresh_token = os.getenv("TASTYTRADE_REFRESH_TOKEN")

    if not client_secret or not refresh_token:
        raise ValueError("TASTYTRADE_CLIENT_SECRET and TASTYTRADE_REFRESH_TOKEN must be set in .env")

    session = Session(client_secret, refresh_token)
    logger.info("Tastytrade session established")
    return session


# ---------------------------------------------------------------------------
# Position fetching
# ---------------------------------------------------------------------------


async def _get_open_positions(session) -> list[dict[str, Any]]:
    """
    Fetch all open equity positions across both paper accounts.

    Returns a flat list of position dicts with keys:
        account_number, symbol, quantity, average_open_price, close_price,
        unrealized_day_gain, cost_effect
    """
    from tastytrade import Account

    all_accounts = await Account.get(session)
    positions: list[dict[str, Any]] = []

    for acct in all_accounts:
        if acct.account_number not in PAPER_ACCOUNTS:
            continue
        try:
            acct_positions = await acct.get_positions(session)
            for pos in acct_positions:
                entry = {
                    "account_number": acct.account_number,
                    "symbol": pos.symbol,
                    "quantity": int(pos.quantity),
                    "average_open_price": float(pos.average_open_price or 0),
                    "close_price": float(pos.close_price or 0),
                    "multiplier": int(pos.multiplier or 1),
                    "instrument_type": getattr(pos, "instrument_type", "Equity"),
                }
                positions.append(entry)
                logger.info(
                    "Found position: %s x%d on %s (avg_entry=%.2f, last=%.2f)",
                    entry["symbol"], entry["quantity"], entry["account_number"],
                    entry["average_open_price"], entry["close_price"],
                )
        except Exception as exc:
            logger.warning("Could not fetch positions for %s: %s", acct.account_number, exc)

    return positions


# ---------------------------------------------------------------------------
# Market data helpers
# ---------------------------------------------------------------------------


def _get_spy_intraday_change() -> float:
    """
    Return SPY's intraday % change (today's open vs current price).
    Negative means down.  Returns 0.0 on failure.
    """
    try:
        spy = yf.Ticker("SPY")
        hist = spy.history(period="1d", interval="1m")
        if hist.empty:
            logger.warning("SPY intraday data unavailable — skipping emergency check")
            return 0.0
        open_price = float(hist["Open"].iloc[0])
        current_price = float(hist["Close"].iloc[-1])
        if open_price <= 0:
            return 0.0
        change = (current_price - open_price) / open_price
        logger.info("SPY intraday change: %.2f%%  (open=%.2f, current=%.2f)",
                    change * 100, open_price, current_price)
        return change
    except Exception as exc:
        logger.warning("Could not fetch SPY intraday data: %s", exc)
        return 0.0


def _get_current_price(symbol: str) -> float | None:
    """Fetch latest price for a symbol via yfinance.  Returns None on failure."""
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1d", interval="1m")
        if hist.empty:
            return None
        return float(hist["Close"].iloc[-1])
    except Exception as exc:
        logger.warning("Could not fetch current price for %s: %s", symbol, exc)
        return None


def _get_rsi_from_db(symbol: str) -> float | None:
    """
    Read the most recent RSI(14) value for *symbol* from market_data.db.
    Returns None if the DB is unavailable or the symbol has no data.
    """
    if not MARKET_DB_PATH.exists():
        logger.warning("market_data.db not found at %s", MARKET_DB_PATH)
        return None
    try:
        conn = sqlite3.connect(MARKET_DB_PATH)
        row = conn.execute(
            "SELECT rsi FROM market_data WHERE symbol = ? ORDER BY date DESC LIMIT 1",
            (symbol,),
        ).fetchone()
        conn.close()
        if row and row[0] is not None:
            rsi = float(row[0])
            logger.info("RSI(%s) from DB: %.2f", symbol, rsi)
            return rsi
        logger.info("No RSI data in DB for %s", symbol)
        return None
    except Exception as exc:
        logger.warning("DB error reading RSI for %s: %s", symbol, exc)
        return None


def _trading_days_since(entry_date: date) -> int:
    """
    Count business days (Mon–Fri) between entry_date and today inclusive of today,
    exclusive of entry_date (so a same-day entry = 0 days held).
    """
    today = date.today()
    if entry_date >= today:
        return 0
    bdays = np.busday_count(entry_date.isoformat(), today.isoformat())
    return int(bdays)


# ---------------------------------------------------------------------------
# Exit evaluation
# ---------------------------------------------------------------------------


def _evaluate_exit(
    pos: dict[str, Any],
    current_price: float | None,
    rsi: float | None,
    spy_change: float,
    entry_date: date | None,
) -> tuple[bool, str]:
    """
    Evaluate all exit conditions for a position.

    Returns (should_exit: bool, reason: str).
    """
    symbol = pos["symbol"]
    avg_entry = pos["average_open_price"]

    # 1. Emergency: SPY down >5%
    if spy_change <= -SPY_EMERGENCY_DROP_PCT:
        reason = (
            f"EMERGENCY: SPY intraday drop of {spy_change * 100:.2f}% "
            f"exceeds {SPY_EMERGENCY_DROP_PCT * 100:.0f}% threshold — closing ALL"
        )
        logger.warning("EXIT [%s] %s", symbol, reason)
        return True, reason

    if current_price is None:
        logger.info("No current price for %s — skipping price-based exit checks", symbol)
    elif avg_entry > 0:
        pnl_pct = (current_price - avg_entry) / avg_entry

        # 2. Stop loss: -5% from entry
        if pnl_pct <= -STOP_LOSS_PCT:
            reason = (
                f"STOP LOSS: {pnl_pct * 100:.2f}% loss from entry "
                f"(entry={avg_entry:.2f}, current={current_price:.2f})"
            )
            logger.warning("EXIT [%s] %s", symbol, reason)
            return True, reason

        # 3. Profit target: +2% from entry
        if pnl_pct >= PROFIT_TARGET_PCT:
            reason = (
                f"PROFIT TARGET: +{pnl_pct * 100:.2f}% gain from entry "
                f"(entry={avg_entry:.2f}, current={current_price:.2f})"
            )
            logger.info("EXIT [%s] %s", symbol, reason)
            return True, reason

    # 4. RSI recovery
    if rsi is not None and rsi > RSI_RECOVERY_THRESHOLD:
        reason = (
            f"RSI RECOVERY: RSI({symbol})={rsi:.1f} > {RSI_RECOVERY_THRESHOLD:.0f} threshold"
        )
        logger.info("EXIT [%s] %s", symbol, reason)
        return True, reason

    # 5. Time stop: 5 trading days
    if entry_date is not None:
        held_days = _trading_days_since(entry_date)
        if held_days >= TIME_STOP_TRADING_DAYS:
            reason = (
                f"TIME STOP: position held {held_days} trading days "
                f"(limit={TIME_STOP_TRADING_DAYS}, entry={entry_date.isoformat()})"
            )
            logger.info("EXIT [%s] %s", symbol, reason)
            return True, reason

    logger.info(
        "HOLD [%s]: no exit condition triggered "
        "(price=%s, rsi=%s, spy_chg=%.2f%%)",
        symbol,
        f"{current_price:.2f}" if current_price else "n/a",
        f"{rsi:.1f}" if rsi else "n/a",
        spy_change * 100,
    )
    return False, ""


# ---------------------------------------------------------------------------
# Close order execution
# ---------------------------------------------------------------------------


async def _close_position(
    session,
    account_number: str,
    symbol: str,
    quantity: int,
) -> dict[str, Any]:
    """Place a market SELL_TO_CLOSE order for the full position quantity."""
    from tastytrade import Account
    from tastytrade.instruments import Equity
    from tastytrade.order import NewOrder, OrderAction, OrderTimeInForce, OrderType

    account = await Account.get(session, account_number=account_number)
    equity = await Equity.get(session, symbol)
    leg = equity.build_leg(Decimal(str(quantity)), OrderAction.SELL_TO_CLOSE)

    order = NewOrder(
        time_in_force=OrderTimeInForce.DAY,
        order_type=OrderType.MARKET,
        legs=[leg],
    )

    response = await account.place_order(session, order, dry_run=False)
    result = {
        "order_id": getattr(response.order, "id", None),
        "status": getattr(response.order, "status", "unknown"),
        "symbol": symbol,
        "quantity": quantity,
        "account": account_number,
        "action": "SELL_TO_CLOSE",
    }
    logger.info(
        "CLOSE ORDER placed: %s x%d on %s — order_id=%s status=%s",
        symbol, quantity, account_number,
        result["order_id"], result["status"],
    )
    return result


# ---------------------------------------------------------------------------
# Entry date lookup
# ---------------------------------------------------------------------------


def _get_entry_dates(positions: list[dict[str, Any]]) -> dict[tuple[str, str], date | None]:
    """
    Attempt to derive entry dates for positions.

    Tastytrade's position object does not expose an entry date directly in the
    basic positions endpoint.  We estimate by querying the DB for the earliest
    date the RSI for that symbol was below 30 (the entry signal condition),
    falling back to None when unavailable.  The time-stop rule degrades
    gracefully when entry_date is None (skips the check).
    """
    result: dict[tuple[str, str], date | None] = {}
    if not MARKET_DB_PATH.exists():
        return {(p["account_number"], p["symbol"]): None for p in positions}

    conn = sqlite3.connect(MARKET_DB_PATH)
    for pos in positions:
        key = (pos["account_number"], pos["symbol"])
        try:
            row = conn.execute(
                """
                SELECT date FROM market_data
                WHERE symbol = ? AND rsi < 30
                ORDER BY date DESC
                LIMIT 1
                """,
                (pos["symbol"],),
            ).fetchone()
            if row:
                result[key] = date.fromisoformat(row[0])
            else:
                result[key] = None
        except Exception as exc:
            logger.debug("Could not derive entry date for %s: %s", pos["symbol"], exc)
            result[key] = None
    conn.close()
    return result


# ---------------------------------------------------------------------------
# Main monitoring loop
# ---------------------------------------------------------------------------


async def _monitor_async() -> None:
    logger.info("=" * 60)
    logger.info("Position Monitor starting — %s", datetime.now().isoformat(timespec="seconds"))
    logger.info("Accounts: %s", ", ".join(PAPER_ACCOUNTS))
    logger.info("=" * 60)

    # --- Load risk state ---
    state = _load_state()
    state = risk_rules.reset_daily_pnl(state)
    state = risk_rules.reset_weekly_pnl(state)

    # --- Connect ---
    try:
        session = await _get_session()
    except Exception as exc:
        logger.error("Cannot connect to Tastytrade: %s", exc)
        return

    # --- Fetch positions ---
    positions = await _get_open_positions(session)
    if not positions:
        logger.info("No open positions found — nothing to monitor.")
        state["open_positions_count"] = 0
        _save_state(state)
        return

    logger.info("Found %d open position(s) across accounts", len(positions))

    # --- Market data ---
    spy_change = _get_spy_intraday_change()
    entry_dates = _get_entry_dates(positions)

    # --- Evaluate each position ---
    exits: list[dict[str, Any]] = []

    for pos in positions:
        symbol = pos["symbol"]
        account = pos["account_number"]
        key = (account, symbol)

        current_price = _get_current_price(symbol)
        rsi = _get_rsi_from_db(symbol)
        entry_date = entry_dates.get(key)

        should_exit, reason = _evaluate_exit(
            pos=pos,
            current_price=current_price,
            rsi=rsi,
            spy_change=spy_change,
            entry_date=entry_date,
        )

        if should_exit:
            exits.append({
                "pos": pos,
                "reason": reason,
                "current_price": current_price,
                "entry_price": pos["average_open_price"],
            })

    if not exits:
        logger.info("No exit conditions triggered — all positions held.")
        _save_state(state)
        return

    logger.info("%d position(s) flagged for exit", len(exits))

    # --- Execute closes ---
    closed_count = 0
    for item in exits:
        pos = item["pos"]
        symbol = pos["symbol"]
        account = pos["account_number"]
        qty = pos["quantity"]
        reason = item["reason"]

        if qty <= 0:
            logger.warning("Position %s has quantity %d — skipping", symbol, qty)
            continue

        logger.info(
            "Closing %s x%d on %s: %s",
            symbol, qty, account, reason,
        )

        try:
            order_result = await _close_position(session, account, symbol, qty)
            logger.info(
                "Closed %s — order_id=%s  status=%s",
                symbol, order_result["order_id"], order_result["status"],
            )

            # Estimate realized P&L for state update
            current_price = item.get("current_price")
            entry_price = item["entry_price"]
            if current_price and entry_price:
                realized_pnl = (current_price - entry_price) * qty
                state = risk_rules.update_pnl(state, realized_pnl)
                logger.info(
                    "Realized P&L for %s: $%.2f  (daily=%.2f, weekly=%.2f)",
                    symbol, realized_pnl,
                    state["daily_pnl"], state["weekly_pnl"],
                )

            closed_count += 1

        except Exception as exc:
            logger.error("Failed to close %s on %s: %s", symbol, account, exc)

    # --- Update risk state ---
    remaining_open = max(0, int(state.get("open_positions_count", 0)) - closed_count)
    state["open_positions_count"] = remaining_open
    if remaining_open == 0:
        state["total_portfolio_risk_dollars"] = 0.0

    _save_state(state)

    logger.info(
        "Monitor complete — closed=%d  remaining_open=%d  daily_pnl=$%.2f",
        closed_count, remaining_open, state["daily_pnl"],
    )
    logger.info("=" * 60)


def monitor_positions() -> None:
    """Synchronous entry point for running the position monitor."""
    asyncio.run(_monitor_async())


if __name__ == "__main__":
    monitor_positions()
