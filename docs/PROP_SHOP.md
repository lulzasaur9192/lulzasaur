# Prop-Shop: Automated Trading System

An example module built on top of Lulzasaur that demonstrates how to build a domain-specific project with its own agents, tasks, and workflows. A team of specialized agents runs a daily pipeline — fetching market data, researching entry signals, managing risk, and executing trades.

> **This is an example module.** It ships with Lulzasaur to demonstrate the project/module system. You can use it as a reference for building your own modules, or adapt it for your own trading strategies.

---

## Current Status

| Item | Status |
|------|--------|
| Mode | **Paper trading** (Tastytrade paper account) |
| Broker integration | **Not yet connected** — signal generation and backtesting work, but trade execution requires Tastytrade API setup (see below) |
| Capital | **$1,000** starting balance |
| Tracked symbols | PLTR, GDX (+ SPY/VIX for regime signals) |
| Strategy | RSI Oversold Bounce — RSI(14) < 40 entry |

> **Paper trading only.** No real money at risk. The system will not transition to live trading without explicit user approval.

---

## What It Does

Every trading day, the prop-shop runs a four-stage pipeline automatically:

```
Data → Research → Trade → Monitor
```

1. **Data** — Fetches daily OHLCV prices and calculates technical indicators (RSI, MACD, EMA, Bollinger Bands, ADX, ATR) for all tracked symbols. Stores everything in SQLite.

2. **Research** — Scans indicators for entry signals. Backtests strategies to validate edge before deployment.

3. **Trade** — When a signal is found, the trading agent requests risk approval, then places the paper trade via the Tastytrade API.

4. **Monitor** — Tracks open positions throughout the day. Checks exits: +2% profit target, RSI > 50 signal exit, -5% stop loss, or 5-day max hold.

---

## Active Strategy: RSI Oversold Bounce

Validated via 3-year backtest (2023–2026) before deployment.

| Parameter | Value |
|-----------|-------|
| Entry signal | RSI(14) < 40 |
| Profit target | +2% from entry |
| Signal exit | RSI(14) > 50 |
| Stop loss | -5% from entry |
| Max hold | 5 trading days |
| Validated tickers | PLTR (78.3% win rate, 8.53 profit factor) |
| | GDX (65.2% win rate, 2.10 profit factor) |

---

## Risk Rules (Hard-coded, Non-negotiable)

The risk manager enforces these with zero exceptions:

| Rule | Limit |
|------|-------|
| Max risk per trade | 5% of account ($50) |
| Max concurrent positions | 3 |
| Max total portfolio risk | 15% of account |
| Daily loss limit | $150 — triggers 24h halt |
| Weekly loss limit | $250 — triggers 48h halt + review |
| Drawdown circuit breaker | -30% from peak — full system pause + user alert |
| Emergency exit | Close all positions if market drops >5% intraday |

---

## Agent Team

| Agent | Role |
|-------|------|
| **prop-orchestrator** | Runs the daily cycle, coordinates all agents, escalates to user |
| **data-agent** | Fetches market data, calculates indicators |
| **research-agent** | Backtests strategies, validates edges, scans for signals |
| **trading-agent** | Executes trades via Tastytrade API |
| **risk-manager** | Approves/blocks all trades, enforces risk rules |
| **position-monitor** | Tracks open positions, manages exits |
| **monitor-agent** | System health checks |

Soul definitions: `modules/prop-shop/souls/`

---

## Market Hours

The system operates on **Pacific Time** (Tastytrade / US markets):

| Event | Time (PST) |
|-------|-----------|
| Market open | 6:30 AM |
| Pipeline runs | ~7:30 AM (fetches overnight data, scans for signals) |
| Market close | 1:00 PM |
| Position monitoring | Hourly, 7:00 AM – 1:00 PM |
| After-hours checks | As needed |

---

## Monitoring

Watch the bulletin board `discoveries` channel for findings from prop-shop agents, and use `get_system_health` for real-time task progress. Key posts to watch for:

- **prop-orchestrator** — Daily cycle status, critical decisions
- **position-monitor** — Open position alerts, exit signals
- **risk-manager** — Risk rule violations or circuit breakers
- **trading-agent** — Trade entries and rejections

### Alerts That Require Your Attention

The system will escalate to you (via main-orchestrator) when:

1. A **strategy change** is needed — you approve or reject
2. A **circuit breaker** triggers (large drawdown)
3. An **emergency exit** condition is detected
4. The system wants to transition from paper → live trading

Everything else runs autonomously.

---

## Project Files

```
modules/prop-shop/
├── README.md                    # Data pipeline technical reference
├── config.yaml                  # Symbols, indicators, strategy params
├── run_daily_pipeline.py        # Pipeline orchestrator script
├── src/                         # Market data fetch + indicator calculation
├── data/db/market_data.db       # SQLite database
├── docs/                        # Monitoring requirements + position guides
├── risk_manager/                # Risk enforcement code
├── souls/                       # Agent soul definitions
└── logs/                        # Daily pipeline logs
```

---

## Tastytrade Setup (Not Yet Integrated)

The prop-shop is designed to execute trades via the Tastytrade API, but broker integration is **not yet connected**. Currently the system generates signals and backtests strategies — trade execution is a placeholder.

To complete the integration, you would need:

1. **Create a Tastytrade account** at [tastytrade.com](https://tastytrade.com/)
2. **Open a paper trading account** (no real money required)
3. **Generate API credentials** from your Tastytrade account settings
4. **Add to `.env`:**
   ```bash
   TASTYTRADE_USERNAME=your-username
   TASTYTRADE_PASSWORD=your-password
   TASTYTRADE_ACCOUNT_ID=your-paper-account-id
   ```
5. **Implement the API client** in `modules/prop-shop/src/trade_executor.py`

The Tastytrade API docs are at [developer.tastytrade.com](https://developer.tastytrade.com/). This is left as an exercise — the data pipeline, signal generation, backtesting, and risk management are all functional without it.

---

## Decision Log

| Date | Decision | Outcome |
|------|----------|---------|
| Mar 3, 2026 | Activate paper trading with $1,000 | ✅ Approved |
| Mar 3, 2026 | RSI threshold: use 40 instead of 35 | ✅ Approved (research validated) |
| Mar 3, 2026 | Added ticker whitelist (PLTR, GDX only) | ✅ Auto-fixed by prop-orchestrator |
