# Risk Manager

The Risk Manager is the central safety system for the prop-shop trading framework. **No agent may open a position without first obtaining approval from this module.**

---

## Files

| File | Purpose |
|---|---|
| `risk_rules.py` | Python module — import this in all trading agents |
| `risk_state.json` | Live state file — read/write on every trade event |

---

## Risk Guardrails

All limits are defined as constants at the top of `risk_rules.py` and are the single source of truth.

| Rule | Value | Constant |
|---|---|---|
| Max risk per trade | 5% of account balance | `MAX_RISK_PER_TRADE_PCT` |
| Max concurrent open positions | 3 | `MAX_CONCURRENT_POSITIONS` |
| Max total portfolio risk | 15% of account balance | `MAX_TOTAL_PORTFOLIO_RISK_PCT` |
| Max daily loss | $150.00 | `MAX_DAILY_LOSS_DOLLARS` |
| Max weekly loss | $250.00 | `MAX_WEEKLY_LOSS_DOLLARS` |
| Drawdown circuit breaker | 30% from peak equity | `DRAWDOWN_CIRCUIT_BREAKER_PCT` |
| Emergency market drop | 5% single-session drop | `EMERGENCY_MARKET_DROP_PCT` |

---

## How to Submit a Trade for Approval

Every trading agent must follow this exact pattern. **There are no exceptions.**

```python
import json
import risk_rules

# 1. Load current state
with open("risk_manager/risk_state.json") as f:
    state = json.load(f)

# 2. Run daily/weekly resets (call at session start)
state = risk_rules.reset_daily_pnl(state)
state = risk_rules.reset_weekly_pnl(state)

# 3. Check circuit breakers before any activity
halted, halt_reason = risk_rules.check_circuit_breakers(state)
if halted:
    print(f"Trading halted: {halt_reason}")
    # Save updated state and stop
    with open("risk_manager/risk_state.json", "w") as f:
        json.dump(state, f, indent=2)
    exit()

# 4. Build a trade proposal
proposal = {
    "symbol":      "AAPL",
    "entry_price": 175.00,
    "stop_loss":   170.00,   # must be below entry for long, above for short
    "direction":   "long",   # "long" or "short"
    "risk_dollars": 40.00,   # how much you're willing to lose on this trade
}

# 5. Request approval
approved, reason, position_size = risk_rules.check_trade_approval(proposal, state)

if not approved:
    print(f"Trade rejected: {reason}")
else:
    print(f"Trade approved: {reason}")
    # Execute trade with `position_size` shares …

    # 6. Update open positions count in state before saving
    state["open_positions_count"] += 1
    state["total_portfolio_risk_dollars"] = round(
        state["total_portfolio_risk_dollars"] + proposal["risk_dollars"], 4
    )

# 7. Persist state
with open("risk_manager/risk_state.json", "w") as f:
    json.dump(state, f, indent=2)
```

### After a trade closes

```python
# Realized P&L for the closed trade (positive = profit, negative = loss)
realized_pnl = 55.00

state = risk_rules.update_pnl(state, realized_pnl)

# Decrement open positions counter
state["open_positions_count"] = max(0, state["open_positions_count"] - 1)
state["total_portfolio_risk_dollars"] = max(
    0.0,
    round(state["total_portfolio_risk_dollars"] - original_risk_dollars, 4)
)

with open("risk_manager/risk_state.json", "w") as f:
    json.dump(state, f, indent=2)
```

---

## Circuit Breaker Conditions

A circuit breaker freezes all new trades by setting `trading_halted = true` in `risk_state.json`. The reason is stored in `halt_reason`.

| Trigger | Condition | Auto-Reset |
|---|---|---|
| Daily loss limit | `daily_pnl <= -$150` | Next calendar day (via `reset_daily_pnl`) |
| Weekly loss limit | `weekly_pnl <= -$250` | Next ISO week (via `reset_weekly_pnl`) |
| Drawdown breaker | Account drops 30%+ from `peak_equity` | **Manual only** — requires account review |

When a circuit breaker fires, `update_pnl()` automatically sets `trading_halted = true`. The halt persists in `risk_state.json` across restarts. **Daily and weekly resets will clear their respective halts automatically when called at session start — but the drawdown halt must be cleared manually** after human review.

To manually clear a drawdown halt (after funding the account or reviewing the situation):

```python
state["trading_halted"] = False
state["halt_reason"] = None
state["halt_until"] = None
state["peak_equity"] = state["account_balance"]  # reset high-water mark
```

---

## Position Sizing Calculation

`calculate_position_size()` uses fixed fractional position sizing:

```
position_size = floor(risk_per_trade_dollars / |entry_price - stop_loss_price|)
```

- `risk_per_trade_dollars` is capped at `MAX_RISK_PER_TRADE_PCT × account_balance`
- The result is floored to a whole number (no fractional shares)
- Returns `0` if the stop is too tight relative to the risk budget

Example — $1,000 account, willing to risk $40, entry $175, stop $170:

```
risk_per_share = |175 - 170| = $5.00
position_size  = floor(40 / 5) = 8 shares
```

---

## How Other Agents Must Interact with This System

### Mandatory protocol for all trading agents

1. **Load state** from `risk_manager/risk_state.json` at the start of every session.
2. **Call `reset_daily_pnl` and `reset_weekly_pnl`** at session start to trigger automatic resets.
3. **Call `check_circuit_breakers`** before any trading activity. Abort the session if halted.
4. **Call `check_trade_approval`** before every trade entry. Never bypass this check.
5. **Update state** with `update_pnl` after every trade closes.
6. **Decrement** `open_positions_count` and `total_portfolio_risk_dollars` when positions close.
7. **Persist state** back to `risk_manager/risk_state.json` after every mutation.

### Rules agents must never break

- Never open a position when `trading_halted` is `true`.
- Never exceed `MAX_CONCURRENT_POSITIONS` open at once.
- Never risk more than `MAX_RISK_PER_TRADE_PCT × account_balance` on a single trade.
- Never let `total_portfolio_risk_dollars` exceed `MAX_TOTAL_PORTFOLIO_RISK_PCT × account_balance`.
- Always use the position size returned by `check_trade_approval` — do not override it.

### Paper trading mode

`paper_trading_mode = true` in state means the system is running in simulation. Approvals still go through the full rule set — paper mode does not bypass any checks. Approved trade reasons are suffixed with `[PAPER TRADE]` for clarity.

---

## State File Reference

`risk_manager/risk_state.json` schema:

```json
{
  "account_balance":             1000.00,   // current equity
  "peak_equity":                 1000.00,   // high-water mark for drawdown calc
  "daily_pnl":                   0.00,      // P&L since last daily reset
  "weekly_pnl":                  0.00,      // P&L since last weekly reset
  "last_daily_reset":            "YYYY-MM-DD",
  "last_weekly_reset":           "YYYY-MM-DD",
  "trading_halted":              false,     // true = all new trades blocked
  "halt_reason":                 null,      // human-readable halt cause
  "halt_until":                  null,      // optional ISO datetime for timed halts
  "paper_trading_mode":          true,      // true = simulation, false = live
  "open_positions_count":        0,         // number of currently open positions
  "total_portfolio_risk_dollars": 0.00      // sum of risk_dollars for open trades
}
```
