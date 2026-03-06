# Position Monitoring Guide

**Agent:** position-monitor  
**Schedule:** Hourly during market hours (7 AM - 1 PM PST, Mon-Fri)  
**Purpose:** Protect profits and cut losses by executing timely exits

---

## Quick Status Check

```bash
# Check current positions
.venv/bin/python scripts/monitor_positions.py

# Check risk state
cat risk_manager/risk_state.json | grep -E "open_positions|trading_halted|account_balance"

# Check market conditions
.venv/bin/python -c "import yfinance as yf; spy = yf.Ticker('SPY'); h = spy.history(period='1d'); print(f'SPY: {((h.Close[-1]/h.Open[0])-1)*100:+.2f}%')"
```

---

## Exit Conditions (Priority Order)

| Priority | Condition | Action | Reason Code |
|----------|-----------|--------|-------------|
| 1 | SPY down >5% intraday | Close **ALL** positions | `emergency_market_drop` |
| 2 | Position P&L ≤ -5% | Close position | `stop_loss` |
| 3 | Position P&L ≥ +2% | Close position | `profit_target` |
| 4 | RSI(14) > 50 | Close position | `rsi_recovery` |
| 5 | Held ≥ 5 trading days | Close position | `time_stop` |

---

## Monitoring Workflow

### 1. Hourly Check (Automated via Heartbeat)

```bash
cd /Users/lulzbot/Desktop/lulzasaur/projects/prop-shop
.venv/bin/python scripts/monitor_positions.py
```

**Expected Output (no positions):**
```
INFO  Position Monitor starting
INFO  Tastytrade session established
INFO  No open positions found — nothing to monitor.
```

**Expected Output (with positions, no exits):**
```
INFO  Position Monitor starting
INFO  Found 2 open positions
INFO  SOFI: Entry $10.50, Current $10.60, P&L +0.95% — HOLD
INFO  PLTR: Entry $25.00, Current $25.30, P&L +1.20% — HOLD
INFO  No exits triggered
```

### 2. Exit Execution (Automatic)

When an exit condition is met, the script:
1. Logs the decision with reason
2. Submits `SELL_TO_CLOSE` market order to Tastytrade
3. Updates `risk_state.json` with realized P&L
4. Logs the fill price and final P&L

### 3. Review Logs

```bash
# Today's monitoring log
tail -f logs/position_monitor_$(date +%Y-%m-%d).log

# Recent position actions
grep -E "EXIT|CLOSE" logs/position_monitor_*.log | tail -20
```

---

## Emergency Protocol

**Trigger:** SPY drops >5% from open  
**Action:** Close ALL positions immediately  
**Notification:** Automatic via risk_rules.halt_trading()

```bash
# Manual emergency check
.venv/bin/python -c "
import yfinance as yf
spy = yf.Ticker('SPY')
hist = spy.history(period='1d', interval='1m')
pct = ((hist.Close[-1] - hist.Open[0]) / hist.Open[0]) * 100
print(f'SPY: {pct:+.2f}%')
if pct < -5:
    print('🚨 EMERGENCY: Close all positions!')
"
```

---

## Data Sources

| Data | Source | Method |
|------|--------|--------|
| Open positions | Tastytrade API | `Account.get_positions(session)` |
| Current prices | Tastytrade API | Position object `mark_price` |
| Entry prices | Tastytrade API | Position object `average_open_price` |
| RSI values | market_data.db | `SELECT rsi FROM market_data WHERE symbol=? ORDER BY date DESC LIMIT 1` |
| Hold duration | Estimated | `numpy.busday_count(entry_date, today)` |
| Market emergency | yfinance SPY | Real-time intraday change |

---

## Constraints & Rules

- ✅ **Paper trading ONLY** — Never trade live without explicit user approval
- ✅ **Monitor hourly** — Every 60 minutes during market hours (7 AM - 1 PM PST)
- ✅ **Stop loss mandatory** — Always execute at -5%, no exceptions
- ✅ **Max hold period** — Force close after 5 trading days
- ✅ **Emergency override** — Market drop >5% closes everything immediately

---

## Files & Locations

```
projects/prop-shop/
├── scripts/
│   └── monitor_positions.py       ← Main monitoring script
├── logs/
│   └── position_monitor_*.log     ← Daily monitoring logs
├── risk_manager/
│   └── risk_state.json            ← Current state (positions, P&L)
├── data/db/
│   └── market_data.db             ← Historical price & RSI data
└── docs/
    └── POSITION_MONITORING.md     ← This file
```

---

## Troubleshooting

### "No open positions found" (when positions should exist)

1. Check risk_state.json: `cat risk_manager/risk_state.json | grep open_positions_count`
2. Query Tastytrade directly:
```python
from tastytrade import Session, Account
import os, asyncio
from dotenv import load_dotenv
load_dotenv('.env')

async def check():
    session = Session(os.getenv('TASTYTRADE_CLIENT_SECRET'), os.getenv('TASTYTRADE_REFRESH_TOKEN'))
    accounts = await Account.get(session)
    for acc in accounts:
        positions = await acc.get_positions(session)
        print(f'{acc.account_number}: {len(positions)} positions')

asyncio.run(check())
```

### "Exit order failed"

- Check Tastytrade API status
- Verify account has sufficient buying power
- Review logs for specific error: `grep ERROR logs/position_monitor_*.log`

### "RSI value not found"

- Verify market_data.db is up to date: `sqlite3 data/db/market_data.db "SELECT MAX(date) FROM market_data"`
- Run data pipeline if stale: `python run_daily_pipeline.py`

---

**Last Updated:** 2026-03-03  
**Agent:** position-monitor  
**Status:** ✅ Operational & Ready
