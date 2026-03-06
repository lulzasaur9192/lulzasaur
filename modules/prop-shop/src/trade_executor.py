"""
trade_executor.py — Paper Trade Executor

Takes signals from signal_generator, runs each through risk_rules for approval,
and executes approved trades via the Tastytrade API (paper trading accounts).

Usage:
    from src.trade_executor import execute_signals
    results = execute_signals(signals)

    # Or standalone:
    python src/trade_executor.py
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "risk_manager"))

import risk_rules

logger = logging.getLogger(__name__)

RISK_STATE_PATH = ROOT / "risk_manager" / "risk_state.json"
ENV_PATH = ROOT / ".env"

# Paper trading account numbers
PAPER_ACCOUNTS = ["5WI44426", "5WY37789"]
PRIMARY_ACCOUNT = PAPER_ACCOUNTS[0]


def _load_state() -> dict[str, Any]:
    with open(RISK_STATE_PATH) as f:
        return json.load(f)


def _save_state(state: dict[str, Any]) -> None:
    with open(RISK_STATE_PATH, "w") as f:
        json.dump(state, f, indent=2)


async def _get_session():
    """Create and return a Tastytrade session using env credentials."""
    from tastytrade import Session

    load_dotenv(ENV_PATH)
    client_secret = os.getenv("TASTYTRADE_CLIENT_SECRET")
    refresh_token = os.getenv("TASTYTRADE_REFRESH_TOKEN")

    if not client_secret or not refresh_token:
        raise ValueError("TASTYTRADE_CLIENT_SECRET and TASTYTRADE_REFRESH_TOKEN must be set in .env")

    session = Session(client_secret, refresh_token)
    logger.info("Tastytrade session created (production API, paper trading accounts)")
    return session


async def _get_account_info(session) -> list[dict[str, Any]]:
    """Fetch balances and status for all paper trading accounts."""
    from tastytrade import Account

    accounts = await Account.get(session)
    results = []
    for acct in accounts:
        if acct.account_number not in PAPER_ACCOUNTS:
            continue
        try:
            balance = await acct.get_balances(session)
            results.append({
                "account_number": acct.account_number,
                "account_type": acct.account_type_name,
                "is_test_drive": acct.is_test_drive,
                "net_liquidating_value": float(balance.net_liquidating_value),
                "cash_balance": float(balance.cash_balance),
                "equity_buying_power": float(balance.equity_buying_power),
                "day_trading_buying_power": float(balance.day_trading_buying_power),
            })
        except Exception as exc:
            logger.warning("Could not fetch balance for %s: %s", acct.account_number, exc)
            results.append({"account_number": acct.account_number, "error": str(exc)})
    return results


async def _place_market_order(session, account_number: str, symbol: str, quantity: int) -> dict[str, Any]:
    """Place a market BUY order on the given account."""
    from tastytrade import Account
    from tastytrade.instruments import Equity
    from tastytrade.order import NewOrder, OrderAction, OrderTimeInForce, OrderType

    account = await Account.get(session, account_number=account_number)
    equity = await Equity.get(session, symbol)
    leg = equity.build_leg(Decimal(str(quantity)), OrderAction.BUY_TO_OPEN)

    order = NewOrder(
        time_in_force=OrderTimeInForce.DAY,
        order_type=OrderType.MARKET,
        legs=[leg],
    )

    response = await account.place_order(session, order, dry_run=False)
    return {
        "order_id": getattr(response.order, "id", None),
        "status": getattr(response.order, "status", "unknown"),
        "symbol": symbol,
        "quantity": quantity,
        "account": account_number,
    }


def execute_signals(signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Run each signal through risk rules and execute approved trades.

    Args:
        signals: List of signal dicts from signal_generator.generate_signals()

    Returns:
        List of execution result dicts with keys:
            ticker, approved, reason, quantity, order_result (if approved)
    """
    return asyncio.run(_execute_signals_async(signals))


async def _execute_signals_async(signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not signals:
        logger.info("No signals to execute.")
        return []

    # Load and refresh risk state
    state = _load_state()
    state = risk_rules.reset_daily_pnl(state)
    state = risk_rules.reset_weekly_pnl(state)

    # Check circuit breakers before starting
    halted, halt_reason = risk_rules.check_circuit_breakers(state)
    if halted:
        logger.warning("CIRCUIT BREAKER ACTIVE — no trades today: %s", halt_reason)
        _save_state(state)
        return [{"ticker": s["ticker"], "approved": False,
                 "reason": halt_reason, "quantity": 0} for s in signals]

    # Connect to Tastytrade
    try:
        session = await _get_session()
        account_info = await _get_account_info(session)
        logger.info("Connected to Tastytrade. Account info:")
        for acct in account_info:
            if "error" in acct:
                logger.warning("  %s — ERROR: %s", acct["account_number"], acct["error"])
            else:
                logger.info("  %s (%s): NLV=$%.2f  buying_power=$%.2f",
                            acct["account_number"], acct["account_type"],
                            acct["net_liquidating_value"], acct["equity_buying_power"])
    except Exception as exc:
        logger.error("Failed to connect to Tastytrade: %s", exc)
        return [{"ticker": s["ticker"], "approved": False,
                 "reason": f"Tastytrade connection failed: {exc}", "quantity": 0}
                for s in signals]

    results: list[dict[str, Any]] = []

    for signal in signals:
        ticker = signal["ticker"]
        proposal = {
            "symbol": ticker,
            "entry_price": signal["entry_price"],
            "stop_loss": signal["stop_loss"],
            "direction": "long",
            "risk_dollars": signal["risk_dollars"],
        }

        approved, reason, quantity = risk_rules.check_trade_approval(proposal, state)

        result: dict[str, Any] = {
            "ticker": ticker,
            "approved": approved,
            "reason": reason,
            "quantity": quantity,
            "rsi": signal.get("rsi"),
            "entry_price": signal["entry_price"],
            "stop_loss": signal["stop_loss"],
        }

        if not approved:
            logger.info("REJECTED %s: %s", ticker, reason)
            results.append(result)
            continue

        logger.info("APPROVED %s: %s", ticker, reason)

        # Execute via Tastytrade API
        try:
            order_result = await _place_market_order(session, PRIMARY_ACCOUNT, ticker, quantity)
            result["order_result"] = order_result
            logger.info("ORDER PLACED: %s x%d on %s — order_id=%s status=%s",
                        ticker, quantity, PRIMARY_ACCOUNT,
                        order_result.get("order_id"), order_result.get("status"))

            # Update risk state for the new open position
            state["open_positions_count"] = int(state.get("open_positions_count", 0)) + 1
            state["total_portfolio_risk_dollars"] = round(
                float(state.get("total_portfolio_risk_dollars", 0)) + signal["risk_dollars"], 4
            )
            _save_state(state)

        except Exception as exc:
            logger.error("Order failed for %s: %s", ticker, exc)
            result["order_result"] = {"error": str(exc)}

        results.append(result)

    _save_state(state)
    return results


async def test_connection() -> None:
    """Test Tastytrade connection and print account info."""
    print("\n=== Tastytrade Connection Test ===")
    try:
        session = await _get_session()
        accounts = await _get_account_info(session)

        if not accounts:
            print("No paper trading accounts found (expected: 5WI44426, 5WY37789)")
            return

        print(f"Connected successfully! Found {len(accounts)} paper account(s):\n")
        for acct in accounts:
            if "error" in acct:
                print(f"  {acct['account_number']} — ERROR: {acct['error']}")
            else:
                print(f"  Account:         {acct['account_number']}")
                print(f"  Type:            {acct['account_type']}")
                print(f"  Net Liq Value:   ${acct['net_liquidating_value']:,.2f}")
                print(f"  Cash Balance:    ${acct['cash_balance']:,.2f}")
                print(f"  Buying Power:    ${acct['equity_buying_power']:,.2f}")
                print(f"  Day Trade BP:    ${acct['day_trading_buying_power']:,.2f}")
                print()
    except Exception as exc:
        print(f"Connection FAILED: {exc}")
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s  %(levelname)-8s  %(name)s: %(message)s")
    asyncio.run(test_connection())
