"""
risk_rules.py — Prop-Shop Risk Management Engine

All trading agents MUST call check_trade_approval() before entering a position
and check_circuit_breakers() before each trading session. State is persisted via
risk_state.json; callers are responsible for loading/saving that file.

Usage pattern (every agent):
    import json, risk_rules

    with open("risk_manager/risk_state.json") as f:
        state = json.load(f)

    # Before placing any trade:
    approved, reason, size = risk_rules.check_trade_approval(proposal, state)
    if not approved:
        # abort — log reason

    # After a trade closes:
    state = risk_rules.update_pnl(state, realized_pnl)

    with open("risk_manager/risk_state.json", "w") as f:
        json.dump(state, f, indent=2)
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import Any

# ---------------------------------------------------------------------------
# Constants — the single source of truth for all risk parameters
# ---------------------------------------------------------------------------

ACCOUNT_STARTING_BALANCE: float = 1000.00

# Maximum fraction of account balance risked on a single trade (5 %)
MAX_RISK_PER_TRADE_PCT: float = 0.05

# Hard cap on simultaneously open positions
MAX_CONCURRENT_POSITIONS: int = 3

# Maximum combined risk across all open positions (15 %)
MAX_TOTAL_PORTFOLIO_RISK_PCT: float = 0.15

# Absolute dollar loss limits
MAX_DAILY_LOSS_DOLLARS: float = 150.00
MAX_WEEKLY_LOSS_DOLLARS: float = 250.00

# Drawdown from peak equity that triggers a full trading halt (30 %)
DRAWDOWN_CIRCUIT_BREAKER_PCT: float = 0.30

# Single-session market drop that triggers an emergency halt (5 %)
EMERGENCY_MARKET_DROP_PCT: float = 0.05

# ---------------------------------------------------------------------------
# Required keys for state validation
# ---------------------------------------------------------------------------

_REQUIRED_STATE_KEYS: tuple[str, ...] = (
    "account_balance",
    "peak_equity",
    "daily_pnl",
    "weekly_pnl",
    "last_daily_reset",
    "last_weekly_reset",
    "trading_halted",
    "halt_reason",
    "halt_until",
    "paper_trading_mode",
    "open_positions_count",
    "total_portfolio_risk_dollars",
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _validate_state(state: dict[str, Any]) -> None:
    """Raise ValueError if any required key is missing from state."""
    missing = [k for k in _REQUIRED_STATE_KEYS if k not in state]
    if missing:
        raise ValueError(f"risk_state is missing required keys: {missing}")


def _validate_positive(value: float, name: str) -> None:
    if not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a number, got {type(value).__name__}")
    if value <= 0:
        raise ValueError(f"{name} must be positive, got {value}")


def _parse_date(date_str: str) -> date:
    """Parse ISO-8601 date string; raise ValueError on bad format."""
    try:
        return date.fromisoformat(date_str)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"Invalid date string '{date_str}': {exc}") from exc


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def calculate_position_size(
    account_balance: float,
    risk_per_trade_dollars: float,
    entry_price: float,
    stop_loss_price: float,
) -> int:
    """
    Calculate the maximum number of shares/contracts for a trade.

    Args:
        account_balance:       Current account equity in dollars.
        risk_per_trade_dollars: Dollar amount willing to risk on this trade.
                                Must not exceed MAX_RISK_PER_TRADE_PCT * account_balance.
        entry_price:           Planned entry price per share/contract.
        stop_loss_price:       Hard stop-loss price per share/contract.

    Returns:
        Maximum position size (integer shares/contracts, always >= 0).

    Raises:
        ValueError: if inputs are invalid or stop equals entry.
        TypeError:  if inputs are not numeric.
    """
    _validate_positive(account_balance, "account_balance")
    _validate_positive(entry_price, "entry_price")
    _validate_positive(stop_loss_price, "stop_loss_price")

    if not isinstance(risk_per_trade_dollars, (int, float)):
        raise TypeError(f"risk_per_trade_dollars must be a number, got {type(risk_per_trade_dollars).__name__}")
    if risk_per_trade_dollars <= 0:
        raise ValueError(f"risk_per_trade_dollars must be positive, got {risk_per_trade_dollars}")

    # Enforce the per-trade risk cap
    max_allowed_risk = account_balance * MAX_RISK_PER_TRADE_PCT
    if risk_per_trade_dollars > max_allowed_risk:
        raise ValueError(
            f"risk_per_trade_dollars ({risk_per_trade_dollars:.2f}) exceeds "
            f"MAX_RISK_PER_TRADE_PCT limit of {max_allowed_risk:.2f} "
            f"({MAX_RISK_PER_TRADE_PCT * 100:.0f}% of {account_balance:.2f})"
        )

    risk_per_share = abs(entry_price - stop_loss_price)
    if math.isclose(risk_per_share, 0.0, abs_tol=1e-9):
        raise ValueError("entry_price and stop_loss_price cannot be equal (zero risk per share)")

    raw_size = risk_per_trade_dollars / risk_per_share
    return max(0, math.floor(raw_size))


def check_trade_approval(
    trade_proposal: dict[str, Any],
    current_state: dict[str, Any],
) -> tuple[bool, str, int]:
    """
    Gate every trade through all risk rules before execution.

    trade_proposal keys (all required):
        symbol         (str)   — ticker or instrument identifier
        entry_price    (float) — planned entry price
        stop_loss      (float) — hard stop-loss price
        direction      (str)   — "long" or "short"
        risk_dollars   (float) — dollar risk the agent wants to allocate

    current_state: loaded risk_state.json dict.

    Returns:
        (approved: bool, reason: str, position_size: int)
        position_size is 0 when approved is False.
    """
    # --- validate inputs ---
    _validate_state(current_state)

    required_proposal_keys = ("symbol", "entry_price", "stop_loss", "direction", "risk_dollars")
    missing = [k for k in required_proposal_keys if k not in trade_proposal]
    if missing:
        return False, f"trade_proposal missing required keys: {missing}", 0

    symbol = str(trade_proposal["symbol"]).strip()
    if not symbol:
        return False, "symbol cannot be empty", 0

    direction = str(trade_proposal.get("direction", "")).lower()
    if direction not in ("long", "short"):
        return False, f"direction must be 'long' or 'short', got '{direction}'", 0

    try:
        entry_price = float(trade_proposal["entry_price"])
        stop_loss = float(trade_proposal["stop_loss"])
        risk_dollars = float(trade_proposal["risk_dollars"])
    except (ValueError, TypeError) as exc:
        return False, f"Numeric conversion error in trade_proposal: {exc}", 0

    if entry_price <= 0:
        return False, f"entry_price must be positive, got {entry_price}", 0
    if stop_loss <= 0:
        return False, f"stop_loss must be positive, got {stop_loss}", 0
    if risk_dollars <= 0:
        return False, f"risk_dollars must be positive, got {risk_dollars}", 0

    # Logical stop-loss direction check
    if direction == "long" and stop_loss >= entry_price:
        return False, f"Long trade: stop_loss ({stop_loss}) must be below entry_price ({entry_price})", 0
    if direction == "short" and stop_loss <= entry_price:
        return False, f"Short trade: stop_loss ({stop_loss}) must be above entry_price ({entry_price})", 0

    account_balance = float(current_state["account_balance"])
    open_positions = int(current_state["open_positions_count"])
    portfolio_risk = float(current_state["total_portfolio_risk_dollars"])
    daily_pnl = float(current_state["daily_pnl"])
    weekly_pnl = float(current_state["weekly_pnl"])

    # --- Rule 1: trading halt ---
    if current_state["trading_halted"]:
        reason = current_state.get("halt_reason") or "Trading is currently halted"
        halt_until = current_state.get("halt_until")
        if halt_until:
            reason += f" (until {halt_until})"
        return False, reason, 0

    # --- Rule 2: concurrent position limit ---
    if open_positions >= MAX_CONCURRENT_POSITIONS:
        return (
            False,
            f"Max concurrent positions reached ({open_positions}/{MAX_CONCURRENT_POSITIONS})",
            0,
        )

    # --- Rule 3: per-trade risk cap ---
    max_trade_risk = account_balance * MAX_RISK_PER_TRADE_PCT
    if risk_dollars > max_trade_risk:
        return (
            False,
            f"Trade risk ${risk_dollars:.2f} exceeds per-trade cap of ${max_trade_risk:.2f} "
            f"({MAX_RISK_PER_TRADE_PCT * 100:.0f}% of ${account_balance:.2f})",
            0,
        )

    # --- Rule 4: portfolio risk cap ---
    new_portfolio_risk = portfolio_risk + risk_dollars
    max_portfolio_risk = account_balance * MAX_TOTAL_PORTFOLIO_RISK_PCT
    if new_portfolio_risk > max_portfolio_risk:
        return (
            False,
            f"Adding ${risk_dollars:.2f} would bring total portfolio risk to ${new_portfolio_risk:.2f}, "
            f"exceeding the ${max_portfolio_risk:.2f} cap "
            f"({MAX_TOTAL_PORTFOLIO_RISK_PCT * 100:.0f}% of ${account_balance:.2f})",
            0,
        )

    # --- Rule 5: daily loss limit ---
    if daily_pnl <= -MAX_DAILY_LOSS_DOLLARS:
        return (
            False,
            f"Daily loss limit reached (${daily_pnl:.2f} / -${MAX_DAILY_LOSS_DOLLARS:.2f}). "
            "No new trades until daily reset.",
            0,
        )

    # --- Rule 6: weekly loss limit ---
    if weekly_pnl <= -MAX_WEEKLY_LOSS_DOLLARS:
        return (
            False,
            f"Weekly loss limit reached (${weekly_pnl:.2f} / -${MAX_WEEKLY_LOSS_DOLLARS:.2f}). "
            "No new trades until weekly reset.",
            0,
        )

    # --- Calculate position size ---
    try:
        position_size = calculate_position_size(
            account_balance=account_balance,
            risk_per_trade_dollars=risk_dollars,
            entry_price=entry_price,
            stop_loss_price=stop_loss,
        )
    except (ValueError, TypeError) as exc:
        return False, f"Position size calculation failed: {exc}", 0

    if position_size < 1:
        return (
            False,
            f"Position size rounds to 0 shares (risk ${risk_dollars:.2f}, "
            f"entry {entry_price}, stop {stop_loss}). Widen stop or increase risk budget.",
            0,
        )

    mode_note = " [PAPER TRADE]" if current_state.get("paper_trading_mode") else ""
    return (
        True,
        f"Approved{mode_note}: {direction.upper()} {position_size} {symbol} "
        f"@ {entry_price} stop @ {stop_loss} (risk ${risk_dollars:.2f})",
        position_size,
    )


def check_circuit_breakers(current_state: dict[str, Any]) -> tuple[bool, str]:
    """
    Evaluate all circuit-breaker conditions against the current state.

    Should be called at the start of each trading session and after every
    significant P&L event.

    Returns:
        (halted: bool, reason: str)
        reason is empty string when halted is False.
    """
    _validate_state(current_state)

    account_balance = float(current_state["account_balance"])
    peak_equity = float(current_state["peak_equity"])
    daily_pnl = float(current_state["daily_pnl"])
    weekly_pnl = float(current_state["weekly_pnl"])

    # Already halted — surface the stored reason
    if current_state["trading_halted"]:
        stored_reason = current_state.get("halt_reason") or "Trading halted (reason unspecified)"
        return True, stored_reason

    # Drawdown circuit breaker
    if peak_equity > 0:
        drawdown_pct = (peak_equity - account_balance) / peak_equity
        if drawdown_pct >= DRAWDOWN_CIRCUIT_BREAKER_PCT:
            reason = (
                f"CIRCUIT BREAKER: Drawdown of {drawdown_pct * 100:.1f}% from peak equity "
                f"(${peak_equity:.2f} → ${account_balance:.2f}) exceeds "
                f"{DRAWDOWN_CIRCUIT_BREAKER_PCT * 100:.0f}% limit."
            )
            return True, reason

    # Daily loss circuit breaker
    if daily_pnl <= -MAX_DAILY_LOSS_DOLLARS:
        reason = (
            f"CIRCUIT BREAKER: Daily loss of ${abs(daily_pnl):.2f} "
            f"exceeds ${MAX_DAILY_LOSS_DOLLARS:.2f} daily limit."
        )
        return True, reason

    # Weekly loss circuit breaker
    if weekly_pnl <= -MAX_WEEKLY_LOSS_DOLLARS:
        reason = (
            f"CIRCUIT BREAKER: Weekly loss of ${abs(weekly_pnl):.2f} "
            f"exceeds ${MAX_WEEKLY_LOSS_DOLLARS:.2f} weekly limit."
        )
        return True, reason

    return False, ""


def update_pnl(
    current_state: dict[str, Any],
    trade_pnl: float,
) -> dict[str, Any]:
    """
    Record a realized P&L event and update account balance and peak equity.

    This function does NOT persist state — callers must write the returned
    dict back to risk_state.json.

    Args:
        current_state: Current risk state dict.
        trade_pnl:     Realized P&L (positive = profit, negative = loss).

    Returns:
        Updated copy of current_state.

    Side effects (on returned state):
        - Adjusts daily_pnl and weekly_pnl
        - Updates account_balance
        - Updates peak_equity if new high-water mark is reached
        - Sets trading_halted / halt_reason if a limit is breached
    """
    _validate_state(current_state)

    if not isinstance(trade_pnl, (int, float)):
        raise TypeError(f"trade_pnl must be a number, got {type(trade_pnl).__name__}")

    state = dict(current_state)  # shallow copy — caller owns persistence

    state["daily_pnl"] = round(float(state["daily_pnl"]) + trade_pnl, 4)
    state["weekly_pnl"] = round(float(state["weekly_pnl"]) + trade_pnl, 4)
    state["account_balance"] = round(float(state["account_balance"]) + trade_pnl, 4)

    # Update peak equity (high-water mark)
    if state["account_balance"] > float(state["peak_equity"]):
        state["peak_equity"] = round(state["account_balance"], 4)

    # Check if any limit has been breached and auto-halt
    halted, reason = check_circuit_breakers(state)
    if halted and not state["trading_halted"]:
        state["trading_halted"] = True
        state["halt_reason"] = reason
        # No automatic resume time — requires manual intervention or daily reset
        state["halt_until"] = None

    return state


def reset_daily_pnl(current_state: dict[str, Any]) -> dict[str, Any]:
    """
    Reset daily P&L if the calendar day has advanced since last_daily_reset.

    Also clears a trading halt caused solely by hitting the daily loss limit
    (drawdown and weekly halts are NOT cleared here).

    Returns:
        Updated copy of current_state (persist it yourself).
    """
    _validate_state(current_state)

    today = date.today()
    last_reset = _parse_date(current_state["last_daily_reset"])

    if today <= last_reset:
        return dict(current_state)  # nothing to do

    state = dict(current_state)
    state["daily_pnl"] = 0.00
    state["last_daily_reset"] = today.isoformat()

    # Lift halt only if the halt was exclusively a daily-loss halt
    if state["trading_halted"]:
        halt_reason: str = state.get("halt_reason") or ""
        account_balance = float(state["account_balance"])
        peak_equity = float(state["peak_equity"])
        drawdown_pct = (peak_equity - account_balance) / peak_equity if peak_equity > 0 else 0.0
        weekly_pnl = float(state["weekly_pnl"])

        daily_limit_was_cause = "Daily loss" in halt_reason or "daily limit" in halt_reason.lower()
        drawdown_still_active = drawdown_pct >= DRAWDOWN_CIRCUIT_BREAKER_PCT
        weekly_still_active = weekly_pnl <= -MAX_WEEKLY_LOSS_DOLLARS

        if daily_limit_was_cause and not drawdown_still_active and not weekly_still_active:
            state["trading_halted"] = False
            state["halt_reason"] = None
            state["halt_until"] = None

    return state


def reset_weekly_pnl(current_state: dict[str, Any]) -> dict[str, Any]:
    """
    Reset weekly P&L if a new calendar week has begun since last_weekly_reset.

    Clears a trading halt caused by hitting the weekly loss limit (but not a
    drawdown halt, which requires manual review and account top-up).

    Returns:
        Updated copy of current_state (persist it yourself).
    """
    _validate_state(current_state)

    today = date.today()
    last_reset = _parse_date(current_state["last_weekly_reset"])

    # A new week starts on Monday; advance to next Monday from last reset
    days_since_reset = (today - last_reset).days
    # Calculate which ISO week each date belongs to
    if today.isocalendar()[1] <= last_reset.isocalendar()[1] and today.year == last_reset.year:
        return dict(current_state)  # still in same ISO week

    state = dict(current_state)
    state["weekly_pnl"] = 0.00
    state["last_weekly_reset"] = today.isoformat()

    # Lift halt only if the halt was exclusively a weekly-loss halt
    if state["trading_halted"]:
        halt_reason: str = state.get("halt_reason") or ""
        account_balance = float(state["account_balance"])
        peak_equity = float(state["peak_equity"])
        drawdown_pct = (peak_equity - account_balance) / peak_equity if peak_equity > 0 else 0.0

        weekly_limit_was_cause = "Weekly loss" in halt_reason or "weekly limit" in halt_reason.lower()
        drawdown_still_active = drawdown_pct >= DRAWDOWN_CIRCUIT_BREAKER_PCT

        if weekly_limit_was_cause and not drawdown_still_active:
            state["trading_halted"] = False
            state["halt_reason"] = None
            state["halt_until"] = None

    return state
