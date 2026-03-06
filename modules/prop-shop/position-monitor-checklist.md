# Position Monitor Checklist

Run this checklist every hour during market hours (7 AM – 1 PM PST, Mon–Fri, non-holiday).

---

## 0. Pre-Check: Any Open Positions?

```sql
SELECT id, symbol, entry_price, entry_timestamp, size, direction, strike, expiration
FROM trades
WHERE exit_price IS NULL;
```

If result is empty → stop. Nothing to do.

---

## 1. Gather Data

| Data | Source |
|---|---|
| Open positions | `trades WHERE exit_price IS NULL` |
| Current price per symbol | Tastytrade API or latest market close |
| RSI(14) per symbol | Calculated from OHLCV data (14-period) |
| Hold duration | `NOW() - entry_timestamp` (trading days only) |
| SPY/QQQ intraday change | Market data feed (% change from prior close) |

---

## 2. Evaluate Exit Conditions (in priority order)

For each open position, check these in order — exit on the **first** condition met.

### Priority 1: Emergency Stop
- [ ] SPY **or** QQQ down **> 5%** intraday
- → Exit ALL open positions immediately, reason: `emergency_market_drop`

### Priority 2: Stop Loss
- [ ] `(current_price - entry_price) / entry_price <= -0.05`
- → Exit position, reason: `stop_loss`

### Priority 3: Profit Target
- [ ] `(current_price - entry_price) / entry_price >= +0.02`
- → Exit position, reason: `profit_target`

### Priority 4: Indicator Recovery
- [ ] RSI(14) for symbol **> 50**
- → Exit position, reason: `rsi_recovery`

### Priority 5: Time Stop
- [ ] Position held **>= 5 trading days**
- → Exit position, reason: `time_stop`

If none of the above → hold, check again next hour.

---

## 3. Exit Execution Steps

For each position to exit:

1. **Calculate P&L**
   ```
   pnl = (current_price - entry_price) * size
   hold_duration = trading_days(entry_timestamp, NOW())
   ```

2. **Execute close via Tastytrade API**
   - Submit closing order for the position
   - Confirm fill and capture `exit_price` from fill response

3. **Update trades table**
   ```sql
   UPDATE trades SET
     exit_price      = <fill_price>,
     exit_timestamp  = NOW(),
     pnl             = <calculated_pnl>,
     exit_reason     = '<reason>',
     hold_duration   = <trading_days>
   WHERE id = <position_id>;
   ```

4. **Verify** the row now has `exit_price IS NOT NULL`

---

## 4. Database Schema Reference

```sql
-- trades table
id              SERIAL PRIMARY KEY,
symbol          TEXT NOT NULL,
entry_price     NUMERIC NOT NULL,
entry_timestamp TIMESTAMPTZ NOT NULL,
size            NUMERIC NOT NULL,
direction       TEXT NOT NULL,        -- 'call' | 'put'
strike          NUMERIC NOT NULL,
expiration      DATE NOT NULL,
exit_price      NUMERIC,              -- NULL = position still open
exit_timestamp  TIMESTAMPTZ,
pnl             NUMERIC,
exit_reason     TEXT,                 -- 'profit_target' | 'stop_loss' | 'rsi_recovery' | 'time_stop' | 'emergency_market_drop'
hold_duration   INTEGER               -- trading days
```

---

## 5. Exit Reason Quick Reference

| Reason | Trigger |
|---|---|
| `profit_target` | Price +2% from entry |
| `stop_loss` | Price -5% from entry |
| `rsi_recovery` | RSI(14) crosses above 50 |
| `time_stop` | Held 5 trading days |
| `emergency_market_drop` | SPY or QQQ down >5% intraday |

---

## 6. Monitoring Schedule

- **Hours**: 7:00 AM – 1:00 PM PST (market open through early afternoon)
- **Days**: Monday – Friday, excluding US market holidays
- **Frequency**: Every 60 minutes
- **Skip if**: No open positions (Step 0 returns empty)

---

*Last updated: 2026-03-03*
