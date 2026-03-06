/**
 * MultiStrategyManager — single integration point for trading-agent strategy decisions.
 *
 * QUICK START
 *   import { multiStrategyManager } from "./trading/multi-strategy-manager.js";
 *
 *   const decision = multiStrategyManager.evaluateSignal(signal);
 *   if (decision) {
 *     // Execute trade using decision.strategy
 *     const won = await runTrade(...);
 *     multiStrategyManager.registerTrade(decision.strategy, won);
 *   }
 *
 * SIGNAL SHAPE
 *   ticker: string          — symbol (e.g. "PLTR")
 *   price:  number          — current price
 *   rsi:    number          — RSI value (0–100)
 *   macd:   number          — MACD histogram value
 *   bbands: {upper, middle, lower} — Bollinger Band levels
 *
 * ADDING STRATEGIES
 *   1. Register in strategy-registry.ts via strategyRegistry.register()
 *   2. Add an evaluator in strategy-selector.ts EVALUATORS map
 *   3. No changes needed here
 *
 * LIVE PERFORMANCE
 *   registerTrade() updates live win/loss stats on the registry. Rankings
 *   automatically shift to use live win rate once 1+ live trades are recorded.
 *   Strategies retire automatically if live WR falls below 40% after 10+ trades.
 */

import { strategyRegistry, liveWinRate, scoreStrategy } from "./strategy-registry.js";
import { strategySelector, type Signal } from "./strategy-selector.js";

export type { Signal };

export interface TradeDecision {
  strategy: string;
  reason: string;
  confidence: number;   // composite score 0–1
  liveWinRate: number;  // current effective WR (%)
  backtestWinRate: number;
}

export interface StrategyStatus {
  name: string;
  description: string;
  backtestWinRate: number;
  liveWinRate: number;
  liveTrades: number;
  liveWins: number;
  confidence: number;
  retired: boolean;
}

export class MultiStrategyManager {
  /**
   * Evaluate a market signal and return the best confirmed strategy.
   * Returns null when no strategy confirms the signal or all are below min WR.
   */
  evaluateSignal(signal: Signal): TradeDecision | null {
    const result = strategySelector.selectBestStrategy(signal);

    if (!result) {
      console.log(
        `[MultiStrategyManager] No strategy confirmed for ${signal.ticker} (RSI: ${signal.rsi.toFixed(1)})`
      );
      return null;
    }

    console.log(
      `[MultiStrategyManager] ${signal.ticker} → ${result.strategy} ` +
      `(${result.liveWinRate}% WR, confidence: ${result.confidence.toFixed(3)}): ${result.reason}`
    );

    return {
      strategy: result.strategy,
      reason: result.reason,
      confidence: result.confidence,
      liveWinRate: result.liveWinRate,
      backtestWinRate: result.backtestWinRate,
    };
  }

  /**
   * Record a closed trade result. Updates live stats and may retire the strategy
   * if win rate decays below threshold.
   */
  registerTrade(strategyName: string, won: boolean): void {
    strategyRegistry.registerTrade(strategyName, won);

    const s = strategyRegistry.getById(strategyName);
    if (!s) return;

    const liveWR = liveWinRate(s) * 100;
    const status = s.retired ? " [RETIRED]" : "";
    console.log(
      `[MultiStrategyManager] ${strategyName} live: ${s.live_wins}W/${s.live_trades}T ` +
      `(${liveWR.toFixed(1)}% WR)${status}`
    );
  }

  /** Returns current status for all non-retired strategies, ranked by score. */
  getStrategyStatus(): StrategyStatus[] {
    return strategyRegistry.rankStrategies().map((s) => ({
      name: s.name,
      description: s.description,
      backtestWinRate: s.backtest.win_rate,
      liveWinRate: parseFloat((liveWinRate(s) * 100).toFixed(2)),
      liveTrades: s.live_trades,
      liveWins: s.live_wins,
      confidence: parseFloat(scoreStrategy(s).toFixed(4)),
      retired: s.retired,
    }));
  }
}

export const multiStrategyManager = new MultiStrategyManager();
