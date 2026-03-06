import { strategyRegistry, scoreStrategy, liveWinRate, type Strategy } from "./strategy-registry.js";

export interface Signal {
  ticker: string;
  price: number;
  rsi: number;
  macd: number;
  bbands: { upper: number; middle: number; lower: number };
}

export interface SelectionResult {
  strategy: string;
  reason: string;
  confidence: number;   // 0–1 composite score
  liveWinRate: number;  // current effective win rate
  backtestWinRate: number;
}

const RSI_OVERSOLD_THRESHOLD = 40;
const MIN_EFFECTIVE_WIN_RATE = 0.55;
/** Price is "near" lower Bollinger Band if within 1% above it */
const BB_PROXIMITY_PCT = 0.01;

// ── Signal evaluators ────────────────────────────────────────────────────────

function evalRsiOversold(s: Signal): boolean {
  return s.rsi < RSI_OVERSOLD_THRESHOLD;
}

function evalRsiMacd(s: Signal): boolean {
  return s.rsi < RSI_OVERSOLD_THRESHOLD && s.macd > 0;
}

function evalRsiBB(s: Signal): boolean {
  const nearLower = s.price <= s.bbands.lower * (1 + BB_PROXIMITY_PCT);
  return s.rsi < RSI_OVERSOLD_THRESHOLD && nearLower;
}

const EVALUATORS: Record<string, (s: Signal) => boolean> = {
  rsi_oversold: evalRsiOversold,
  rsi_macd_confirmation: evalRsiMacd,
  rsi_bollinger_bands: evalRsiBB,
};

// ── Selector ─────────────────────────────────────────────────────────────────

export class StrategySelector {
  /**
   * Find all strategies that confirm the signal, rank them, and return the best.
   * Returns null if no strategy confirms or all pass the minimum win-rate filter.
   */
  selectBestStrategy(signal: Signal): SelectionResult | null {
    const ranked = strategyRegistry.rankStrategies();

    const candidates: { strategy: Strategy; score: number }[] = [];

    for (const strategy of ranked) {
      const evaluate = EVALUATORS[strategy.name];
      if (!evaluate) continue;
      if (!evaluate(signal)) continue;

      const effectiveWR = liveWinRate(strategy);
      if (effectiveWR < MIN_EFFECTIVE_WIN_RATE) continue;

      candidates.push({ strategy, score: scoreStrategy(strategy) });
    }

    if (candidates.length === 0) return null;

    // Already sorted by registry rank — take the top scorer
    const best = candidates.sort((a, b) => b.score - a.score)[0]!;

    return {
      strategy: best.strategy.name,
      reason: buildReason(best.strategy.name, signal),
      confidence: parseFloat(best.score.toFixed(4)),
      liveWinRate: parseFloat((liveWinRate(best.strategy) * 100).toFixed(2)),
      backtestWinRate: best.strategy.backtest.win_rate,
    };
  }

  /** @deprecated Use selectBestStrategy(). Kept for backwards compatibility. */
  evaluateSignal(signal: Signal): SelectionResult | null {
    return this.selectBestStrategy(signal);
  }
}

function buildReason(strategyName: string, s: Signal): string {
  switch (strategyName) {
    case "rsi_oversold":
      return `RSI ${s.rsi.toFixed(1)} is oversold (<${RSI_OVERSOLD_THRESHOLD})`;
    case "rsi_macd_confirmation":
      return `RSI ${s.rsi.toFixed(1)} oversold with bullish MACD histogram (${s.macd.toFixed(4)})`;
    case "rsi_bollinger_bands":
      return `RSI ${s.rsi.toFixed(1)} oversold with price ${s.price.toFixed(2)} near BB lower band ${s.bbands.lower.toFixed(2)}`;
    default:
      return `Signal confirmed by ${strategyName}`;
  }
}

export const strategySelector = new StrategySelector();
