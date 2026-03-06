import { readFileSync } from "fs";
import { join } from "path";

export interface BacktestStats {
  win_rate: number;       // 0–100 (as stored in JSON)
  profit_factor: number;
  sharpe_ratio: number;
  trade_count: number;
}

export interface Strategy {
  name: string;
  description: string;
  validated: boolean;
  backtest: BacktestStats;
  live_trades: number;
  live_wins: number;
  retired: boolean;
}

/** Minimum live trades before retirement kicks in */
const RETIREMENT_THRESHOLD_TRADES = 10;
/** Retire if live win rate drops below this (0–1) */
const RETIREMENT_MIN_WIN_RATE = 0.40;

export function liveWinRate(s: Strategy): number {
  return s.live_trades > 0 ? s.live_wins / s.live_trades : s.backtest.win_rate / 100;
}

/** Composite score: live WR (primary) + Sharpe normalised (secondary) + profit factor */
export function scoreStrategy(s: Strategy): number {
  const wr = liveWinRate(s);
  // Normalise Sharpe to a 0-1 contribution (cap at 10)
  const sharpeNorm = Math.min(Math.max(s.backtest.sharpe_ratio, 0), 10) / 10;
  return wr * 0.6 + sharpeNorm * 0.2 + Math.min(s.backtest.profit_factor, 5) / 5 * 0.2;
}

export class StrategyRegistry {
  private strategies = new Map<string, Strategy>();

  register(strategy: Strategy): void {
    this.strategies.set(strategy.name, { ...strategy });
  }

  getAll(): Strategy[] {
    return Array.from(this.strategies.values()).filter((s) => !s.retired);
  }

  getById(name: string): Strategy | undefined {
    return this.strategies.get(name);
  }

  /** Increment live stats and retire strategy if win rate decays too far. */
  registerTrade(name: string, won: boolean): void {
    const s = this.strategies.get(name);
    if (!s) throw new Error(`Strategy not found: ${name}`);
    s.live_trades += 1;
    if (won) s.live_wins += 1;

    const liveWR = liveWinRate(s);
    if (s.live_trades >= RETIREMENT_THRESHOLD_TRADES && liveWR < RETIREMENT_MIN_WIN_RATE) {
      s.retired = true;
      console.warn(
        `[StrategyRegistry] ${name} retired — live WR ${(liveWR * 100).toFixed(1)}% < ${RETIREMENT_MIN_WIN_RATE * 100}%`
      );
    }
  }

  rankStrategies(): Strategy[] {
    return this.getAll().sort((a, b) => scoreStrategy(b) - scoreStrategy(a));
  }

  /** Load strategies from backtest_results.json summary section. */
  static loadFromBacktestFile(filePath: string): StrategyRegistry {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as {
      summary: Record<string, { win_rate: number; profit_factor: number; sharpe_ratio: number; trade_count: number }>;
    };

    const registry = new StrategyRegistry();

    const nameMap: Record<string, { id: string; description: string }> = {
      "RSI < 40": {
        id: "rsi_oversold",
        description: "RSI oversold bounce (RSI < 40)",
      },
      "RSI+MACD": {
        id: "rsi_macd_confirmation",
        description: "RSI oversold + MACD bullish crossover confirmation",
      },
      "RSI+BB": {
        id: "rsi_bollinger_bands",
        description: "RSI oversold + price at lower Bollinger Band",
      },
    };

    for (const [jsonName, stats] of Object.entries(data.summary)) {
      const meta = nameMap[jsonName];
      if (!meta) continue;

      registry.register({
        name: meta.id,
        description: meta.description,
        validated: true,
        backtest: {
          win_rate: stats.win_rate,
          profit_factor: stats.profit_factor,
          sharpe_ratio: stats.sharpe_ratio,
          trade_count: stats.trade_count,
        },
        live_trades: 0,
        live_wins: 0,
        retired: false,
      });
    }

    return registry;
  }
}

// ── Singleton loaded from backtest results ──────────────────────────────────
const backtestPath = join(
  import.meta.dirname ?? process.cwd(),
  "..",
  "..",
  "projects",
  "prop-shop",
  "backtest_results.json"
);

export const strategyRegistry = StrategyRegistry.loadFromBacktestFile(backtestPath);
