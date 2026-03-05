# Tastytrade API - Quick Start Guide

## TL;DR

✅ **Use OAuth 2.0 with refresh tokens**  
✅ **Install:** `pip install tastytrade`  
✅ **Two credentials needed:** `client_secret` + `refresh_token`  
✅ **Tokens never expire** - perfect for bots!

---

## Setup (5 minutes)

### Step 1: Create OAuth App
1. Go to: https://my.tastytrade.com/app.html#/manage/api-access/oauth-applications
2. Click "Create New Application"
3. Add scopes: `read_accounts`, `write_orders`, `read_balances`, `read_positions`, `read_market_data`
4. Set callback: `http://localhost:8000`
5. **Save the `client_secret`** (you can't retrieve it later!)

### Step 2: Generate Refresh Token
1. Go to your app → Manage → Create Grant
2. **Save the `refresh_token`**

### Step 3: Install SDK
```bash
pip install tastytrade
```

### Step 4: Test Authentication
```python
from tastytrade import Session, Account
import asyncio

async def test():
    session = Session('YOUR_CLIENT_SECRET', 'YOUR_REFRESH_TOKEN')
    accounts = await Account.get(session)
    print(f"✅ Connected! Accounts: {len(accounts)}")

asyncio.run(test())
```

---

## Required Credentials

Store these securely (env vars or secrets manager):

```bash
TASTYTRADE_CLIENT_SECRET=<from OAuth app creation>
TASTYTRADE_REFRESH_TOKEN=<from Create Grant>
```

---

## Python Code Template

```python
import os
from tastytrade import Session, Account
from tastytrade.instruments import Equity
from tastytrade.order import NewOrder, OrderAction, OrderTimeInForce, OrderType
from decimal import Decimal

# Create session
session = Session(
    os.getenv('TASTYTRADE_CLIENT_SECRET'),
    os.getenv('TASTYTRADE_REFRESH_TOKEN')
)

# Get accounts
accounts = await Account.get(session)
account = accounts[0]

# Get positions
positions = await account.get_positions(session)

# Place order
symbol = await Equity.get(session, 'SPY')
leg = symbol.build_leg(Decimal('10'), OrderAction.BUY_TO_OPEN)

order = NewOrder(
    time_in_force=OrderTimeInForce.DAY,
    order_type=OrderType.LIMIT,
    legs=[leg],
    price=Decimal('-450.00')
)

response = await account.place_order(session, order, dry_run=True)
```

---

## Key Points

- ✅ **OAuth is REQUIRED** (username/password is deprecated)
- ✅ **Refresh tokens NEVER expire** (perfect for headless bots)
- ✅ **SDK auto-refreshes session tokens** (15 min lifetime)
- ✅ **Full async/await support** (non-blocking)
- ✅ **WebSocket streaming** for real-time data
- ✅ **Type-safe** (100% Pydantic models)

---

## Sandbox Testing

Create sandbox account: https://developer.tastytrade.com/sandbox/

```python
session = Session(
    'sandbox_client_secret', 
    'sandbox_refresh_token',
    is_test=True  # <-- Use sandbox environment
)
```

---

## Documentation

- **Full Research Report:** `tastytrade_auth_research.md`
- **SDK Docs:** https://tastyworks-api.readthedocs.io/
- **Developer Portal:** https://developer.tastytrade.com/
- **GitHub:** https://github.com/tastyware/tastytrade

---

## Need Help?

See full research report in `tastytrade_auth_research.md` for:
- Detailed OAuth setup walkthrough
- Security best practices
- Production deployment guide
- Error handling examples
- Rate limiting considerations
