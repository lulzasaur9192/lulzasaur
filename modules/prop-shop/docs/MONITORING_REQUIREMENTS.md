# Prop Shop Trading — Monitoring Requirements

**Version:** 1.0
**Date:** 2026-03-03
**Status:** Specification
**Audience:** Developers building monitoring agents, infrastructure engineers, strategy reviewers

---

## Overview

This document defines the complete monitoring requirements for the Prop Shop Trading system. It covers database schema contracts, computed metrics, alert thresholds, report formats, health scoring, and integration points.

The monitoring layer is **read-only** with respect to trade data. It observes, computes, alerts, and reports — it does not modify positions, orders, or strategy state. Any remediation actions (e.g., retiring a strategy) must be triggered through designated write paths or human review workflows, not directly by monitoring agents.

---

## 1. Database Schema Requirements

### 1.1 `trades`

Primary record of all executed trades. Monitoring agents query this table for performance and execution analysis.

```sql
CREATE TABLE trades (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id       UUID        NOT NULL REFERENCES strategies(id),
  symbol            TEXT        NOT NULL,                      -- e.g. 'SPY', 'AAPL'
  entry_time        TIMESTAMPTZ NOT NULL,
  exit_time         TIMESTAMPTZ,                               -- NULL if position still open
  entry_price       NUMERIC(12,4) NOT NULL,
  exit_price        NUMERIC(12,4),                            -- NULL if position still open
  quantity          INTEGER     NOT NULL,                     -- shares / contracts
  pnl               NUMERIC(12,4),                           -- NULL if position still open
  status            TEXT        NOT NULL CHECK (status IN ('open','closed','cancelled','error')),
  execution_quality NUMERIC(6,4),                            -- composite 0.0–1.0 score
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trades_strategy    ON trades(strategy_id);
CREATE INDEX idx_trades_symbol      ON trades(symbol);
CREATE INDEX idx_trades_entry_time  ON trades(entry_time DESC);
CREATE INDEX idx_trades_status      ON trades(status);
CREATE INDEX idx_trades_exit_time   ON trades(exit_time DESC) WHERE exit_time IS NOT NULL;
```

**Monitoring contracts:**
- `pnl` and `exit_price` are NULL for open positions; monitors must handle this explicitly
- `execution_quality` is written by the execution engine post-fill; may be NULL briefly after order
- `status = 'error'` indicates the trade was attempted but failed to execute cleanly — these are tracked separately from normal win/loss accounting
- `quantity` is always positive; direction is implied by `entry_price` vs `exit_price` for equity strategies

---

### 1.2 `strategies`

Registry of all trading strategies. Monitoring agents check this table to scope trade queries and detect retirement candidates.

```sql
CREATE TABLE strategies (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL UNIQUE,
  win_rate          NUMERIC(5,4),                            -- lifetime win rate 0.0–1.0; NULL until first trade
  total_trades      INTEGER     NOT NULL DEFAULT 0,
  active            BOOLEAN     NOT NULL DEFAULT true,
  retired_at        TIMESTAMPTZ,                             -- NULL if still active
  retirement_reason TEXT,                                    -- human-readable; NULL if active
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_strategies_active ON strategies(active) WHERE active = true;
```

**Monitoring contracts:**
- `win_rate` here is the denormalized lifetime rate; rolling window rates are computed by monitors from the `trades` table, never stored here
- When a strategy is retired: `active = false`, `retired_at` is set, `retirement_reason` is populated
- Monitoring agents must NOT update `active`, `retired_at`, or `retirement_reason` — these are owned by the strategy management process
- A strategy with `active = false` should still have its historical trades available for backtest divergence analysis

---

### 1.3 `backtests`

Expected performance baseline for each strategy/symbol pairing. Used to detect live-versus-backtest divergence.

```sql
CREATE TABLE backtests (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id       UUID        NOT NULL REFERENCES strategies(id),
  symbol            TEXT        NOT NULL,
  expected_win_rate NUMERIC(5,4) NOT NULL,                  -- backtest win rate 0.0–1.0
  expected_pnl      NUMERIC(12,4) NOT NULL,                 -- expected avg PnL per trade
  date_range        TSTZRANGE   NOT NULL,                   -- backtest period (inclusive)
  sample_size       INTEGER,                                -- number of trades in backtest
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_backtests_strategy_symbol ON backtests(strategy_id, symbol);
```

**Monitoring contracts:**
- Multiple backtest records may exist per `(strategy_id, symbol)` — monitors should use the most recently created record that whose `date_range` upper bound precedes current live trading start
- `expected_pnl` is per-trade average, not total; monitoring computes divergence against live per-trade average
- `sample_size` informs statistical confidence — divergence alerts for backtests with fewer than 30 sample trades should be flagged as LOW_CONFIDENCE

---

### 1.4 `market_data`

Intraday market data snapshots. Used for VIX regime detection and context enrichment in reports.

```sql
CREATE TABLE market_data (
  symbol      TEXT        NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL,
  price       NUMERIC(12,4) NOT NULL,
  volume      BIGINT,
  vix         NUMERIC(8,4),                                -- populated when symbol = index; may be NULL for equities
  PRIMARY KEY (symbol, timestamp)
);

CREATE INDEX idx_market_data_symbol_time ON market_data(symbol, timestamp DESC);
CREATE INDEX idx_market_data_vix         ON market_data(timestamp DESC) WHERE vix IS NOT NULL;
```

**Monitoring contracts:**
- To get current VIX: query the most recent row where `vix IS NOT NULL`, ordered by `timestamp DESC`
- Gaps in `market_data` are themselves a data quality signal — monitors check for gaps against expected trading session cadence
- Volume may be NULL for some data sources; monitors should treat NULL volume as missing, not zero

---

### 1.5 `executions`

Fill-level execution detail. Used for slippage analysis and execution quality scoring.

```sql
CREATE TABLE executions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id        UUID        NOT NULL REFERENCES trades(id),
  expected_price  NUMERIC(12,4) NOT NULL,                  -- mid-market or limit price at order time
  actual_price    NUMERIC(12,4) NOT NULL,                  -- actual fill price
  slippage        NUMERIC(12,4) GENERATED ALWAYS AS (actual_price - expected_price) STORED,
  timestamp       TIMESTAMPTZ NOT NULL,
  side            TEXT        NOT NULL CHECK (side IN ('entry','exit')),
  fill_quantity   INTEGER     NOT NULL,
  venue           TEXT,                                    -- broker/exchange routing; optional
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_executions_trade   ON executions(trade_id);
CREATE INDEX idx_executions_time    ON executions(timestamp DESC);
CREATE INDEX idx_executions_slippage ON executions(slippage);
```

**Monitoring contracts:**
- `slippage` is a computed column: positive = paid more / received less than expected (bad for trader), negative = favorable fill
- Each trade may have 1–2 execution records (entry + exit); partial fills may produce more
- Slippage analysis aggregates `ABS(slippage)` per share; direction is tracked separately for pattern detection

---

## 2. Metrics to Track

### 2.1 Win Rate

**Definition:** Percentage of closed trades where `pnl > 0`.

| Metric | Window | Query Basis |
|--------|--------|-------------|
| Lifetime win rate | All closed trades per strategy | `strategies.win_rate` (denormalized) |
| Rolling win rate (R20) | Last 20 closed trades per strategy | Computed from `trades` ORDER BY `exit_time DESC LIMIT 20` |
| Rolling win rate (R30) | Last 30 closed trades per strategy | Computed from `trades` ORDER BY `exit_time DESC LIMIT 30` |
| Cross-symbol win rate | All strategies, grouped by symbol | Computed from `trades JOIN strategies` |

**Computation:**
```sql
-- Rolling 20-trade win rate for a strategy
SELECT
  COUNT(*) FILTER (WHERE pnl > 0)::FLOAT / COUNT(*) AS win_rate_r20
FROM (
  SELECT pnl
  FROM trades
  WHERE strategy_id = $1
    AND status = 'closed'
  ORDER BY exit_time DESC
  LIMIT 20
) recent;
```

**Notes:**
- Exclude `status IN ('cancelled', 'error')` from all win rate calculations
- A trade with `pnl = 0` is a scratch; it is NOT counted as a win for threshold purposes but IS counted in the denominator
- Minimum 5 closed trades required before reporting win rate; below this report `INSUFFICIENT_DATA`

---

### 2.2 P&L

| Metric | Granularity | Definition |
|--------|-------------|------------|
| Daily P&L | Per calendar day | Sum of `pnl` for trades with `exit_time` on that date |
| Weekly P&L | Mon–Fri week | Sum of daily P&L for the week |
| Cumulative P&L | All time per strategy | Running sum of closed `pnl` |
| P&L per strategy | Per strategy | Cumulative P&L grouped by `strategy_id` |
| P&L per symbol | Per symbol | Cumulative P&L grouped by `symbol` |
| Open P&L | Current open positions | `(current_price - entry_price) * quantity` using latest `market_data` |

**Computation for daily P&L:**
```sql
SELECT
  DATE(exit_time AT TIME ZONE 'America/New_York') AS trade_date,
  SUM(pnl)                                         AS daily_pnl,
  COUNT(*)                                         AS closed_trades,
  COUNT(*) FILTER (WHERE pnl > 0)                  AS winning_trades
FROM trades
WHERE status = 'closed'
  AND exit_time >= $start_date
  AND exit_time <  $end_date
GROUP BY 1
ORDER BY 1;
```

**Notes:**
- All P&L figures are pre-commission unless a `commission` column is added; document any commission adjustments explicitly
- Open P&L is marked-to-market, not locked in; reports should clearly distinguish realized vs. unrealized

---

### 2.3 Execution Quality

**Definition:** How close actual fill prices were to expected prices.

| Metric | Definition |
|--------|------------|
| Per-trade slippage | `SUM(ABS(slippage) * fill_quantity) / SUM(fill_quantity)` — dollar slippage per share |
| Average slippage (rolling 20) | Average per-trade slippage over last 20 trades |
| Average slippage (daily) | Average per-trade slippage for the trading day |
| Favorable fill rate | `COUNT(*) FILTER (WHERE slippage < 0) / COUNT(*)` — percentage of fills better than expected |

**Per-trade execution quality score (0.0–1.0):**

```
execution_quality = MAX(0, 1 - (abs_slippage_per_share / 0.10))
```

Where `0.10` is the maximum acceptable slippage per share (2× the alert threshold).
A score of `1.0` = zero slippage; `0.5` = $0.05/share slippage; `0.0` = $0.10+ slippage.

This score is written back to `trades.execution_quality` by the execution engine.

---

### 2.4 Backtest Divergence

**Definition:** How far live performance deviates from backtest expectations.

**Win rate divergence:**
```
divergence_pct = ABS(live_win_rate_r30 - expected_win_rate) / expected_win_rate * 100
```

**PnL-per-trade divergence:**
```
live_avg_pnl    = SUM(pnl) / COUNT(*) FROM last 30 closed trades
divergence_pct  = ABS(live_avg_pnl - expected_pnl) / ABS(expected_pnl) * 100
```

**Monitoring logic:**
1. For each active strategy, find the most recent `backtests` record
2. Compute live R30 metrics
3. If `total_trades < 30`, use available trades but flag as `LOW_SAMPLE`
4. If backtest `sample_size < 30`, flag result as `LOW_CONFIDENCE`
5. Divergence > 10% on either metric triggers an alert (see Section 3)

---

### 2.5 Consecutive Losses

**Definition:** Number of sequential closed trades with `pnl <= 0`, ordered by `exit_time DESC`.

```sql
-- Detect current consecutive loss streak for a strategy
WITH ranked AS (
  SELECT
    pnl,
    ROW_NUMBER() OVER (ORDER BY exit_time DESC) AS rn
  FROM trades
  WHERE strategy_id = $1
    AND status = 'closed'
  ORDER BY exit_time DESC
  LIMIT 50
),
first_win AS (
  SELECT MIN(rn) AS win_rn FROM ranked WHERE pnl > 0
)
SELECT
  COALESCE((SELECT win_rn FROM first_win), 50) - 1 AS consecutive_losses
FROM ranked
LIMIT 1;
```

**Notes:**
- Scratch trades (`pnl = 0`) count as a loss for consecutive-loss purposes
- Maximum lookback for this query is 50 trades; if the streak exceeds that, report `50+`
- This metric is per-strategy, not cross-strategy

---

### 2.6 Data Quality

**Definition:** Completeness and integrity of market data relative to expected trading session coverage.

| Check | Description |
|-------|-------------|
| Completeness % | `(actual_records / expected_records) * 100` for a given symbol and time window |
| Gap detection | Any interval > 2× the expected data frequency with no records |
| VIX availability | Whether VIX data is present and current for each trading day |
| Stale data | Any symbol where the most recent `market_data` timestamp > 15 minutes behind wall clock during session hours |

**Expected records baseline:**
- For 1-minute bars during US equity session (09:30–16:00 ET): 390 records per symbol per day
- For 5-minute bars: 78 records per symbol per day
- Monitoring agent should detect the actual cadence from the first 30 records and extrapolate expected count

**Completeness calculation:**
```sql
SELECT
  symbol,
  COUNT(*) AS actual_records,
  ROUND(COUNT(*)::NUMERIC / $expected_records * 100, 2) AS completeness_pct
FROM market_data
WHERE timestamp >= $session_start
  AND timestamp <  $session_end
GROUP BY symbol;
```

---

### 2.7 VIX Regime

**Definition:** Classification of current market volatility environment based on VIX level.

| VIX Level | Regime | Code |
|-----------|--------|------|
| < 15 | Low volatility | `LOW_VOL` |
| 15–19.99 | Normal | `NORMAL` |
| 20–29.99 | Elevated | `ELEVATED` |
| ≥ 30 | Crisis | `CRISIS` |

**Tracking:**
- Current regime: from latest `market_data` row where `vix IS NOT NULL`
- Regime at market open: from first VIX reading of the trading day
- Previous regime: regime as of previous trading day close
- Regime change: when current regime code differs from previous regime code

```sql
-- Current VIX and regime
SELECT
  vix,
  CASE
    WHEN vix < 15   THEN 'LOW_VOL'
    WHEN vix < 20   THEN 'NORMAL'
    WHEN vix < 30   THEN 'ELEVATED'
    ELSE                 'CRISIS'
  END AS regime,
  timestamp AS as_of
FROM market_data
WHERE vix IS NOT NULL
ORDER BY timestamp DESC
LIMIT 1;
```

---

## 3. Alert Thresholds

### 3.1 Alert Severity Levels

| Level | Code | Action |
|-------|------|--------|
| Informational | `INFO` | Logged to daily report; no immediate action |
| Warning | `WARN` | Posted to bulletin board `status-updates` channel; review within 24h |
| Critical | `CRIT` | Posted to bulletin board `help-wanted` channel; review within 4h |
| Emergency | `EMRG` | Posted to bulletin board `help-wanted` channel (pinned); immediate human review required |

---

### 3.2 Strategy Performance Alerts

| Alert | Condition | Severity | Notes |
|-------|-----------|----------|-------|
| `STRATEGY_RETIREMENT_CANDIDATE` | R20 win rate < 55% AND total closed trades ≥ 20 | `CRIT` | Does not auto-retire; flags for review |
| `STRATEGY_POOR_START` | Win rate < 45% on first 10 trades | `WARN` | Early warning; insufficient trades for retirement |
| `STRATEGY_STRONG_DEGRADATION` | R20 win rate drops > 15 percentage points vs R50 win rate | `CRIT` | Sudden degradation is worse than gradual |
| `CONSECUTIVE_LOSSES` | Consecutive losses > 5 | `CRIT` | Reset counter on first profitable trade |
| `CONSECUTIVE_LOSSES_SEVERE` | Consecutive losses > 10 | `EMRG` | Potential strategy malfunction |

**Retirement threshold detail:**
- Required: `win_rate_r20 < 0.55` (current rolling 20-trade win rate below 55%)
- Required: `total_trades >= 20` (minimum sample for reliability)
- Recommended: flag for human review, do not auto-retire without confirmation
- The alert should include: strategy name, R20 win rate, R30 win rate, lifetime win rate, backtest expected win rate, total trades

---

### 3.3 Execution Quality Alerts

| Alert | Condition | Severity | Notes |
|-------|-----------|----------|-------|
| `SLIPPAGE_HIGH` | Per-trade slippage > $0.05/share | `WARN` | Single trade |
| `SLIPPAGE_CHRONIC` | Rolling 10-trade average slippage > $0.05/share | `CRIT` | Systemic issue |
| `SLIPPAGE_EXTREME` | Per-trade slippage > $0.15/share | `EMRG` | Possible execution error |
| `EXECUTION_QUALITY_LOW` | `trades.execution_quality` < 0.5 for > 20% of trades in past day | `WARN` | Aggregate quality degradation |

---

### 3.4 Data Quality Alerts

| Alert | Condition | Severity | Notes |
|-------|-----------|----------|-------|
| `DATA_INCOMPLETE` | Any symbol completeness < 95% during session | `WARN` | May affect strategy signals |
| `DATA_CRITICAL` | Any symbol completeness < 80% during session | `CRIT` | Strategies using this symbol should pause |
| `DATA_GAP_DETECTED` | Gap > 2× expected frequency for any active symbol | `WARN` | Include gap start/end times in alert |
| `VIX_DATA_MISSING` | No VIX update in > 30 minutes during session | `WARN` | Regime detection unavailable |
| `STALE_DATA` | Any symbol with no update > 15 minutes during session | `WARN` | Per-symbol alert |

---

### 3.5 Backtest Divergence Alerts

| Alert | Condition | Severity | Notes |
|-------|-----------|----------|-------|
| `BACKTEST_WIN_RATE_DIVERGENCE` | Win rate divergence > 10% over 30+ trades | `WARN` | Possible regime change or overfitting |
| `BACKTEST_PNL_DIVERGENCE` | PnL-per-trade divergence > 10% over 30+ trades | `WARN` | |
| `BACKTEST_SEVERE_DIVERGENCE` | Either divergence > 25% over 30+ trades | `CRIT` | Strategy may be invalid in current conditions |
| `BACKTEST_LOW_CONFIDENCE` | Divergence alert fired but backtest sample < 30 | `INFO` | Downgrade to informational |

---

### 3.6 VIX Regime Alerts

| Alert | Condition | Severity | Notes |
|-------|-----------|----------|-------|
| `VIX_REGIME_CHANGE` | Regime crosses any threshold (15, 20, 30) | `WARN` | Always post to bulletin board |
| `VIX_ELEVATED_ENTRY` | VIX crosses above 20 | `WARN` | Review strategy assumptions for elevated vol |
| `VIX_CRISIS_ENTRY` | VIX crosses above 30 | `CRIT` | Consider reduced position sizing or halt |
| `VIX_CRISIS_EXIT` | VIX drops below 30 from above | `INFO` | Crisis regime ending; normal operations may resume |

---

### 3.7 Alert Deduplication

- Alerts of the same type for the same `strategy_id` / `symbol` should not fire more than once per 4 hours unless the condition worsens in severity
- `EMRG` alerts always fire immediately regardless of deduplication window
- Resolved alerts (condition no longer met) should post a `RESOLVED` followup to the same bulletin board channel

---

## 4. Report Formats

### 4.1 Daily Report Template

**Filename:** `reports/daily/YYYY-MM-DD.md`
**Generated:** End of trading day (16:30 ET) or on-demand

```markdown
# Daily Trading Report — {DATE}

**Generated:** {TIMESTAMP} ET
**System Health Score:** {SCORE}/100 ({GRADE})
**VIX Regime:** {REGIME} (VIX: {VIX_VALUE})

---

## Summary

| Metric | Value |
|--------|-------|
| Total Closed Trades | {N} |
| Winning Trades | {N} ({PCT}%) |
| Daily P&L (Realized) | ${AMOUNT} |
| Open Positions | {N} |
| Unrealized P&L | ${AMOUNT} |
| Avg Slippage/Share | ${AMOUNT} |
| Data Completeness | {PCT}% |

---

## Open Positions

| Symbol | Strategy | Entry Time | Entry Price | Current Price | Unrealized P&L | Size |
|--------|----------|------------|-------------|---------------|----------------|------|
{OPEN_POSITIONS_TABLE}

*No open positions.* (if empty)

---

## Closed Trades

| Time | Symbol | Strategy | P&L | Slippage/Share | Exec Quality |
|------|--------|----------|-----|----------------|--------------|
{CLOSED_TRADES_TABLE}

**Daily Total:** ${DAILY_PNL}

---

## P&L Breakdown

### By Strategy

| Strategy | Trades | Win Rate | P&L Today | Cumulative P&L | Status |
|----------|--------|----------|-----------|----------------|--------|
{STRATEGY_PNL_TABLE}

### By Symbol

| Symbol | Trades | Win Rate | P&L Today |
|--------|--------|----------|-----------|
{SYMBOL_PNL_TABLE}

---

## Alerts

{ALERTS_SECTION}
<!-- Format per alert:
### [{SEVERITY}] {ALERT_CODE} — {STRATEGY_OR_SYMBOL}
**Triggered:** {TIMESTAMP}
**Detail:** {DESCRIPTION}
**Recommended Action:** {ACTION}
-->

*No alerts today.* (if none)

---

## Strategy Health

| Strategy | Active | R20 Win Rate | R30 Win Rate | Lifetime Win Rate | Consec. Losses | vs Backtest |
|----------|--------|--------------|--------------|-------------------|----------------|-------------|
{STRATEGY_HEALTH_TABLE}

---

## Data Quality

| Symbol | Expected Records | Actual Records | Completeness | Gaps Detected |
|--------|-----------------|----------------|--------------|---------------|
{DATA_QUALITY_TABLE}

---

## Market Context

- **VIX Open:** {VIX_OPEN}
- **VIX Close:** {VIX_CLOSE}
- **Regime Today:** {REGIME}
- **Regime Change:** {YES/NO} — {DESCRIPTION if YES}

---

*Report generated by PropShop Monitor Agent. All data read-only from trading database.*
```

---

### 4.2 Weekly Report Template

**Filename:** `reports/weekly/YYYY-WNN.md` (ISO week number)
**Generated:** Friday 17:00 ET or on-demand

```markdown
# Weekly Trading Report — Week {WEEK_NUMBER}, {YEAR}
# {MON_DATE} – {FRI_DATE}

**Generated:** {TIMESTAMP} ET
**Average Health Score:** {SCORE}/100
**Week VIX Range:** {VIX_LOW} – {VIX_HIGH} | Dominant Regime: {REGIME}

---

## Week at a Glance

| Metric | Value | vs Prior Week |
|--------|-------|---------------|
| Total Closed Trades | {N} | {DELTA} ({PCT}%) |
| Win Rate (week) | {PCT}% | {DELTA}pp |
| Weekly P&L | ${AMOUNT} | {DELTA} |
| Cumulative P&L (all-time) | ${AMOUNT} | — |
| Avg Daily Trades | {N} | — |
| Avg Slippage/Share | ${AMOUNT} | {DELTA} |
| Worst Drawdown Day | {DATE} (${AMOUNT}) | — |

---

## Daily P&L

| Date | Trades | Win Rate | P&L | Cumulative |
|------|--------|----------|-----|------------|
| {MON} | {N} | {PCT}% | ${AMT} | ${CUM} |
| {TUE} | {N} | {PCT}% | ${AMT} | ${CUM} |
| {WED} | {N} | {PCT}% | ${AMT} | ${CUM} |
| {THU} | {N} | {PCT}% | ${AMT} | ${CUM} |
| {FRI} | {N} | {PCT}% | ${AMT} | ${CUM} |
| **Total** | **{N}** | **{PCT}%** | **${AMT}** | — |

---

## Strategy Performance

| Strategy | Trades | Win Rate | P&L | R20 Win Rate | Backtest Expected | Divergence | Flag |
|----------|--------|----------|-----|--------------|-------------------|------------|------|
{STRATEGY_PERFORMANCE_TABLE}

**Flags:** RETIRE_CANDIDATE, LOW_SAMPLE, DIVERGENCE_HIGH, DEGRADING

---

## Execution Quality

| Strategy | Avg Slippage/Share | Favorable Fill % | Worst Single-Trade Slippage |
|----------|--------------------|------------------|-----------------------------|
{EXECUTION_QUALITY_TABLE}

---

## Alerts This Week

### Critical / Emergency

{CRIT_EMRG_ALERTS}

### Warnings

{WARN_ALERTS}

### Resolved

{RESOLVED_ALERTS}

---

## Strategy Retirement Review

{RETIREMENT_REVIEW_SECTION}
<!--
For each STRATEGY_RETIREMENT_CANDIDATE alert fired this week:
### {STRATEGY_NAME}
- R20 Win Rate: {PCT}%  (threshold: 55%)
- Total Trades: {N}
- Backtest Expected Win Rate: {PCT}%
- Recommendation: RETIRE / MONITOR / INSUFFICIENT_DATA
- Notes: {free text}
-->

*No retirement candidates this week.* (if none)

---

## Data Quality Summary

| Symbol | Week Completeness | Gap Events | Worst Day | VIX Coverage |
|--------|-------------------|------------|-----------|--------------|
{DATA_QUALITY_TABLE}

---

## Market Regime Summary

| Day | Opening Regime | Closing Regime | VIX Range | Regime Changes |
|-----|----------------|----------------|-----------|----------------|
{REGIME_TABLE}

---

## Recommendations

{RECOMMENDATIONS_SECTION}
<!-- Auto-generated based on alerts and metrics:
- strategies to review
- data sources to investigate
- execution routing changes to consider
-->

---

*Report generated by PropShop Monitor Agent. All data read-only from trading database.*
```

---

## 5. System Health Score Calculation

The health score is a composite 0–100 score used in report headers and bulletin board status updates.

### 5.1 Component Weights

| Component | Weight | Source |
|-----------|--------|--------|
| Execution Quality | 25% | Average `trades.execution_quality` for last 20 closed trades |
| Data Quality | 25% | Average completeness % across all active symbols |
| Win Rate Trend | 30% | Relative performance of R20 vs lifetime win rate |
| Drawdown Level | 20% | Current drawdown from equity peak |

### 5.2 Execution Quality Component (0–100)

```
eq_score = AVG(execution_quality) * 100
           FROM trades
           WHERE status = 'closed'
           ORDER BY exit_time DESC
           LIMIT 20
```

If fewer than 5 trades: use 75 (neutral) with a `LOW_SAMPLE` annotation.

---

### 5.3 Data Quality Component (0–100)

```
dq_score = AVG(completeness_pct) ACROSS all active_symbols for today's session
```

- Completeness 100% = 100 points
- Completeness 95% = 75 points
- Completeness 90% = 50 points
- Completeness 80% = 25 points
- Completeness < 80% = 0 points

If no session data exists yet (pre-market): use 100 (full credit) with a `PRE_SESSION` annotation.

---

### 5.4 Win Rate Trend Component (0–100)

```
lifetime_wr = strategies.win_rate (weighted average across all active strategies)
r20_wr      = rolling 20-trade win rate (weighted average across all active strategies)
delta       = r20_wr - lifetime_wr
```

Scoring:
- `delta >= +0.05` (improving) → 100
- `delta >= 0`    (flat/slight improvement) → 75
- `delta >= -0.05` (mild degradation) → 50
- `delta >= -0.10` (moderate degradation) → 25
- `delta < -0.10`  (severe degradation) → 0

If insufficient trade history (< 20 trades per strategy): use 50 (neutral).

---

### 5.5 Drawdown Level Component (0–100)

```
peak_equity   = MAX(cumulative_pnl) up to current date
current_equity = current cumulative_pnl (realized only)
drawdown_pct  = (peak_equity - current_equity) / ABS(peak_equity) * 100
                IF peak_equity > 0 ELSE 0
```

Scoring:
- Drawdown 0–2% → 100
- Drawdown 2–5% → 75
- Drawdown 5–10% → 50
- Drawdown 10–20% → 25
- Drawdown > 20% → 0

---

### 5.6 Composite Score and Grade

```
health_score = (eq_score * 0.25) + (dq_score * 0.25) + (wr_score * 0.30) + (dd_score * 0.20)
health_score = ROUND(health_score)    -- integer 0–100
```

| Score | Grade | Description |
|-------|-------|-------------|
| 90–100 | A | All systems optimal |
| 75–89 | B | Minor issues; acceptable |
| 60–74 | C | Degraded; review recommended |
| 45–59 | D | Multiple issues; action required |
| 0–44 | F | Critical failure; immediate review |

---

## 6. Integration Points

### 6.1 Database Access

**Access mode:** Read-only. The monitoring agent connects using a database role with `SELECT` privileges only on the following tables:
- `trades`
- `strategies`
- `backtests`
- `market_data`
- `executions`

**Connection string:** Provided via `PROP_SHOP_DB_URL` environment variable (read-only credentials).
**Connection pool:** Max 3 connections. The monitoring agent is low-frequency; it must not exhaust connection pools shared with the trading engine.

**Strictly prohibited:**
- `INSERT`, `UPDATE`, `DELETE` on any trading table
- DDL operations of any kind
- Accessing tables outside the above list without explicit permission

---

### 6.2 Report Output Directories

```
projects/prop-shop/
├── reports/
│   ├── daily/
│   │   └── YYYY-MM-DD.md
│   ├── weekly/
│   │   └── YYYY-WNN.md
│   └── alerts/
│       └── YYYY-MM-DD-alert-{CODE}-{STRATEGY}.md   # individual alert snapshots
└── data/
    └── health_scores.jsonl    # append-only JSONL: {date, score, components, grade}
```

The monitoring agent must create directories if they don't exist. Reports are never deleted by the monitoring agent — archival is a separate process.

---

### 6.3 Alert Notification Channels

Alerts are delivered through two mechanisms:

**1. Bulletin Board (lulzasaur agent system)**

All alerts `WARN` and above are posted to the shared bulletin board using the `post_bulletin` tool:

| Alert Severity | Channel | Pinned |
|---------------|---------|--------|
| `WARN` | `status-updates` | No |
| `CRIT` | `help-wanted` | No |
| `EMRG` | `help-wanted` | Yes |

Post format:
```
Title: [{SEVERITY}] {ALERT_CODE} — {STRATEGY_OR_SYMBOL}
Body:
  Triggered: {TIMESTAMP}
  Strategy: {STRATEGY_NAME} ({STRATEGY_ID})
  Metric: {METRIC_NAME} = {VALUE} (threshold: {THRESHOLD})
  Detail: {HUMAN_READABLE_DESCRIPTION}
  Recommended Action: {ACTION}
Tags: ["prop-shop", "alert", "{alert_code_lowercase}", "{strategy_name_lowercase}"]
```

**2. File-based alert log**

Each alert also writes a structured record to `reports/alerts/YYYY-MM-DD-alert-{CODE}-{ID}.md` for audit and replay purposes.

---

### 6.4 Bulletin Board Updates for Cross-Agent Coordination

The monitoring agent participates in the lulzasaur multi-agent system via the bulletin board. Specific integration behaviors:

**Heartbeat posts (daily, `status-updates` channel):**
- Post the current system health score and grade at start of trading day
- Post a brief EOD summary with daily P&L and any unresolved alerts

**Discovery posts (`discoveries` channel):**
- Post when a new regime change is detected with full context
- Post when a strategy's live performance significantly exceeds backtest expectations (upside divergence > 15%)

**Help-wanted posts:**
- Post when a strategy hits `CRIT` threshold and awaits human review
- Include a structured decision request: RETIRE / CONTINUE / REDUCE_SIZE

**Reading the board:**
- At each heartbeat, read the `status-updates` and `help-wanted` channels for responses to previous posts
- If a human or another agent posts a decision about a flagged strategy, log it to the alert file and update the health score computation accordingly

**Project scoping:**
- All bulletin board posts use the `prop-shop` project ID to scope visibility appropriately

---

## 7. Implementation Notes

### 7.1 Monitoring Agent Heartbeat Schedule

| Task | Frequency |
|------|-----------|
| Win rate / P&L check | Every 15 minutes during session |
| Slippage check | After each trade closes (event-driven) or every 5 minutes |
| Data quality check | Every 10 minutes during session |
| VIX regime check | Every 5 minutes during session |
| Health score update | Every 15 minutes; logged to `health_scores.jsonl` |
| Daily report generation | 16:30 ET |
| Weekly report generation | Friday 17:00 ET |
| Pre-market data check | 09:25 ET (5 minutes before open) |

### 7.2 Time Zone Handling

- All timestamps in the database are stored as `TIMESTAMPTZ` (UTC)
- All reports display times in **US/Eastern (ET)** unless noted otherwise
- Trading session: 09:30–16:00 ET; extended hours data (if present) is separated in reports
- "Today" for a daily report refers to the ET calendar date, not UTC

### 7.3 Query Performance Guidelines

- Always filter by `exit_time` range before grouping in P&L queries to use the time index
- Use the `strategy_id` index when computing per-strategy metrics
- The `health_scores.jsonl` file is the preferred way to serve health score history — do not run expensive aggregate queries more than once per 15-minute interval
- Cache VIX regime in memory between heartbeats; only re-query if > 5 minutes has passed

### 7.4 Graceful Degradation

If any metric cannot be computed (e.g., missing data, DB unavailable):
- Log the failure to the alert file
- Report `UNAVAILABLE` for the affected metric in reports
- Do **not** use stale cached values for alert threshold comparisons — skip the check and note `SKIPPED: data unavailable`
- Continue computing other metrics; a partial report is better than no report

---

## 8. Glossary

| Term | Definition |
|------|------------|
| R20 | Rolling 20-trade window (most recent 20 closed trades) |
| R30 | Rolling 30-trade window |
| R50 | Rolling 50-trade window |
| Win Rate | % of closed trades with `pnl > 0`; scratches (`pnl = 0`) count as losses |
| Slippage | `actual_price - expected_price`; positive = unfavorable for buyer |
| Execution Quality | Normalized per-trade score 0.0–1.0 based on slippage magnitude |
| Backtest Divergence | `ABS(live_metric - expected_metric) / expected_metric * 100` |
| Drawdown | Peak-to-trough decline in cumulative realized P&L |
| VIX Regime | Categorical label for volatility environment based on VIX level |
| Health Score | Composite 0–100 score across execution, data, win rate, and drawdown components |
| LOW_SAMPLE | Fewer than 20 trades in window; statistical reliability reduced |
| LOW_CONFIDENCE | Backtest sample size < 30; backtest baseline may not be robust |
