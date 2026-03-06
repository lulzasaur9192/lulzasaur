# Multi-Strategy Integration

## Architecture

Three files form a layered stack. Each layer has one responsibility.

```
trading-agent
    └── MultiStrategyManager       src/trading/multi-strategy-manager.ts
            ├── StrategySelector   src/trading/strategy-selector.ts
            └── StrategyRegistry   src/trading/strategy-registry.ts
```

| Layer | Responsibility |
|---|---|
| **StrategyRegistry** | Stores strategy metadata, tracks live wins/trades, ranks by score |
| **StrategySelector** | Evaluates a market signal against each strategy's conditions |
| **MultiStrategyManager** | Single API for trading-agent — process, execute, update, report |

**Ranking score** = `win_rate × profit_factor`. When `live_trades > 0`, live win rate replaces the backtested value, so rankings self-correct over time.

---

## Using MultiStrategyManager in trading-agent

Import the singleton and call three methods in sequence per trade:

```typescript
import { multiStrategyManager } from "./multi-strategy-manager";

// 1. Evaluate a market signal
const decision = multiStrategyManager.processSignal({
  ticker: "PLTR",
  price: 18.42,
  rsi: 32.1,
  macd: 0.05,
  bbands: { upper: 21.0, middle: 19.5, lower: 18.0 },
});

// 2. Execute if confirmed
if (decision.shouldTrade) {
  console.log(`Strategy: ${decision.strategy} — ${decision.reason}`);
  const result = await multiStrategyManager.executeTrade(decision.strategy, signal);

  if (result.success) {
    // 3. Record outcome when trade closes
    const won = exitPrice > entryPrice;
    multiStrategyManager.updateTradeResult(decision.strategy, won);
  }
}

// 4. Inspect live metrics at any time
const metrics = multiStrategyManager.getStrategyMetrics();
console.table(metrics);
```

`processSignal` never throws — it returns `{ shouldTrade: false }` when no strategy confirms, so no try/catch is needed at the call site.

---

## Adding a New Strategy

### Step 1 — Register in strategy-registry.ts

```typescript
strategyRegistry.register({
  name: "rsi_volume_spike",
  description: "RSI oversold + volume 2x average — backtested 68% WR",
  validated: true,
  win_rate: 0.68,
  profit_factor: 1.7,
  live_trades: 0,
  live_wins: 0,
});
```

Set `validated: false` until backtesting confirms thresholds. The selector skips unvalidated strategies automatically.

### Step 2 — Add an evaluator in strategy-selector.ts

Export a named function and add it to the `EVALUATORS` map:

```typescript
// Named function — testable in isolation
export function rsiVolumeSpike(rsi: number, volumeRatio: number): boolean {
  return rsi < RSI_OVERSOLD_THRESHOLD && volumeRatio >= 2.0;
}

// Wire into the evaluator map
const EVALUATORS: Record<string, (signal: Signal) => boolean> = {
  rsi_oversold:          (s) => rsiOversold(s.rsi),
  rsi_macd_confirmation: (s) => rsiMacdConfirmation(s.rsi, s.macd),
  rsi_bollinger_bands:   (s) => rsiBolingerConfirmation(s.rsi, s.bbands, s.price),
  rsi_volume_spike:      (s) => rsiVolumeSpike(s.rsi, s.volumeRatio), // new
};
```

If the strategy needs data not currently in `Signal`, extend the interface:

```typescript
export interface Signal {
  // ...existing fields...
  volumeRatio?: number;  // add optional fields to avoid breaking callers
}
```

### Step 3 — Add a reason in buildReason()

```typescript
case "rsi_volume_spike":
  return `RSI ${signal.rsi.toFixed(1)} oversold with volume spike (${signal.volumeRatio?.toFixed(1)}x avg)`;
```

### Step 4 — Verify with example signals

```typescript
import { strategySelector } from "./strategy-selector";

// Should select rsi_volume_spike (highest score when volume confirms)
const result = strategySelector.evaluateSignal({
  ticker: "RIOT", price: 8.50, rsi: 28, macd: -0.01, volumeRatio: 2.4,
  bbands: { upper: 10.0, middle: 9.0, lower: 8.8 },
});
console.assert(result?.selectedStrategy === "rsi_volume_spike");

// Should fall back to rsi_oversold when volume is normal
const fallback = strategySelector.evaluateSignal({
  ticker: "RIOT", price: 8.50, rsi: 28, macd: -0.01, volumeRatio: 1.1,
  bbands: { upper: 10.0, middle: 9.0, lower: 8.8 },
});
console.assert(fallback?.selectedStrategy === "rsi_oversold");
```

No changes to `MultiStrategyManager` are needed.

---

## Live Stats Tracking

Call `updateTradeResult(strategy, won)` once per closed trade:

```typescript
multiStrategyManager.updateTradeResult("rsi_bollinger_bands", true);  // win
multiStrategyManager.updateTradeResult("rsi_bollinger_bands", false); // loss
```

Internally this increments `live_trades` (always) and `live_wins` (on win). The registry stores the running totals. The selector uses `live_wins / live_trades` as the effective win rate once `live_trades > 0`, replacing the backtested value.

A strategy whose live win rate drops below `MIN_WIN_RATE` (0.55) is automatically skipped by the selector until performance recovers.

---

## Registered Strategies (as of initial release)

| Name | Backtested WR | Profit Factor | Condition |
|---|---|---|---|
| `rsi_macd_confirmation` | 75% | 2.1 | RSI < 40 AND MACD > 0 |
| `rsi_bollinger_bands` | 70% | 1.9 | RSI < 40 AND price ≤ BB lower × 1.01 |
| `rsi_oversold` | 72% | 1.8 | RSI < 40 |

Initial ranking: `rsi_macd_confirmation` scores highest (0.75 × 2.1 = 1.575). The selector tries strategies in ranked order and returns the first one that confirms the signal.

---

## Future Enhancements

**Regime-aware selection** — detect whether the market is trending or ranging and weight strategies accordingly. RSI+BB performs better in ranging markets; RSI+MACD better in trends.

**Dynamic profit factor** — update `profit_factor` from live trade PnL rather than leaving it fixed at the backtested value.

**Per-ticker strategy affinity** — track win rates per (strategy, ticker) pair, not just per strategy globally. RSI oversold has different performance on PLTR vs GDX.

**Confidence scores** — return a numeric confidence (0–1) alongside `shouldTrade` so position sizing can scale with signal strength.

**Strategy cooldown** — after a losing streak (e.g. 3 consecutive losses), pause a strategy for N hours before re-enabling it.

**Persistence** — flush live stats to disk or DB on each update so stats survive process restarts. Current implementation is in-memory only.
