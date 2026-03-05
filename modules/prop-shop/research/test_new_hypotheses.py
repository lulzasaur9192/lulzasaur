#!/usr/bin/env python3
"""
Batch hypothesis tester for 3 new swing trading strategies.

Runs 18 backtests (3 strategies × 6 tickers), saves results to the
hypotheses database, and prints a summary report vs the RSI baseline.

Usage
-----
    python3.11 research/test_new_hypotheses.py
    python3.11 research/test_new_hypotheses.py --days 1095 --size 10000
    python3.11 research/test_new_hypotheses.py --tickers SOFI PLTR --days 730
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from research.backtesting.data_loader import load_symbol
from research.backtesting.engine import BacktestEngine
from research.backtesting import metrics as mt
from research.hypotheses.tracker import HypothesisTracker
from research.strategies.bb_squeeze import BBSqueezeStrategy
from research.strategies.gap_reversal import GapReversalStrategy
from research.strategies.ma_cross_volume import MACrossVolumeStrategy

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_TICKERS = ["SOFI", "PLTR", "XLF", "RIOT", "GDX", "SPY"]
DEFAULT_DAYS = 1095  # 3 years
DEFAULT_SIZE = 10_000

# RSI baseline (validated result for comparison)
RSI_BASELINE = {
    "name": "RSI Oversold Bounce",
    "win_rate": 0.645,
    "profit_factor": 2.10,
    "total_trades": 69,
    "total_pnl": 33_407,
}

# Promotion thresholds
MIN_WIN_RATE = 0.55
MIN_PROFIT_FACTOR = 1.5
MIN_TRADES = 20

STRATEGIES = [
    {
        "key": "bb_squeeze",
        "class": BBSqueezeStrategy,
        "name": "Bollinger Band Squeeze Breakout",
        "description": (
            "After BB squeeze (width < 10th pct of 60-day history), enter long "
            "when price closes above upper band with 1.5x volume. "
            "Exit below lower band or -3% stop."
        ),
        "params": {},
    },
    {
        "key": "gap_reversal",
        "class": GapReversalStrategy,
        "name": "Mean Reversion After Gap Down",
        "description": (
            "Enter long after >2% gap down with RSI < 45 and no news-volume spike "
            "(vol < 3x avg). Exit when 80% of gap fills or -4% stop."
        ),
        "params": {},
    },
    {
        "key": "ma_cross_volume",
        "class": MACrossVolumeStrategy,
        "name": "MA Crossover with Volume",
        "description": (
            "Enter long when SMA(10) crosses above SMA(20) with volume > 1.2x avg "
            "and RSI 40-60. Exit on reverse cross or -3.5% stop."
        ),
        "params": {},
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pass_fail(value: float, threshold: float) -> str:
    return "PASS" if value >= threshold else "FAIL"


def _aggregate_metrics(all_trade_dicts: list[dict]) -> dict:
    """Compute combined metrics across all tickers for a strategy."""
    if not all_trade_dicts:
        return {
            "total_trades": 0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "total_pnl": 0.0,
            "avg_return": 0.0,
            "max_drawdown": 0.0,
            "sharpe_ratio": 0.0,
        }
    return mt.summary(all_trade_dicts)


def _run_one(strategy_instance, ticker: str, start: str, end: str,
             position_size: float) -> tuple[dict, list[dict]]:
    """Run a single backtest and return (summary, trades_as_dicts)."""
    df = load_symbol(ticker, start=start, end=end)
    engine = BacktestEngine(position_size_usd=position_size)
    engine.run(df, strategy_instance, symbol=ticker)
    summary = engine.summary()
    trades_df = engine.trades_df()
    trades = trades_df.to_dict("records") if not trades_df.empty else []
    return summary, trades


def _print_ticker_row(ticker: str, summary: dict) -> None:
    n = summary["total_trades"]
    wr = summary["win_rate"] * 100
    pf = summary["profit_factor"]
    pnl = summary["total_pnl"]
    print(f"    {ticker:<6}  trades={n:>3}  WR={wr:>5.1f}%  PF={pf:>5.2f}  P&L=${pnl:>9.2f}")


def _print_strategy_banner(name: str) -> None:
    print("\n" + "═" * 62)
    print(f"  {name}")
    print("═" * 62)


def _print_combined_summary(name: str, combined: dict, promoted: bool) -> None:
    n = combined["total_trades"]
    wr = combined["win_rate"] * 100
    pf = combined["profit_factor"]
    pnl = combined["total_pnl"]

    print(f"\n  ── Combined across all tickers ──")
    print(f"  Trades:         {n:>4}  {_pass_fail(n, MIN_TRADES)} (min {MIN_TRADES})")
    print(f"  Win Rate:       {wr:>5.1f}%  {_pass_fail(wr / 100, MIN_WIN_RATE)} (min {MIN_WIN_RATE * 100:.0f}%)")
    print(f"  Profit Factor:  {pf:>5.2f}  {_pass_fail(pf, MIN_PROFIT_FACTOR)} (min {MIN_PROFIT_FACTOR})")
    print(f"  Total P&L:      ${pnl:>9.2f}")
    status = "VALIDATED ✓" if promoted else "FAILED ✗"
    print(f"  Status:         {status}")


def _print_baseline_comparison(results: list[dict]) -> None:
    b = RSI_BASELINE
    print("\n" + "═" * 62)
    print("  COMPARISON vs RSI BASELINE")
    print("═" * 62)
    print(f"  {'Strategy':<34} {'Trades':>6} {'WR%':>6} {'PF':>5} {'Status'}")
    print(f"  {'-'*34} {'-'*6} {'-'*6} {'-'*5} {'-'*12}")
    print(f"  {b['name']:<34} {b['total_trades']:>6} {b['win_rate']*100:>5.1f}% "
          f"{b['profit_factor']:>5.2f}  BASELINE")
    for r in results:
        c = r["combined"]
        promoted = (
            c["total_trades"] >= MIN_TRADES
            and c["win_rate"] >= MIN_WIN_RATE
            and c["profit_factor"] >= MIN_PROFIT_FACTOR
        )
        flag = "VALIDATED" if promoted else "failed"
        n = c["total_trades"]
        wr = c["win_rate"] * 100
        pf = c["profit_factor"]
        print(f"  {r['name']:<34} {n:>6} {wr:>5.1f}% {pf:>5.2f}  {flag}")
    print("═" * 62)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Batch-test 3 new swing trading hypotheses.")
    parser.add_argument("--tickers", nargs="+", default=DEFAULT_TICKERS)
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS,
                        help="Lookback days (default 1095 = 3yr)")
    parser.add_argument("--size", type=float, default=DEFAULT_SIZE,
                        help="USD position size per trade (default 10000)")
    parser.add_argument("--no-db", action="store_true",
                        help="Skip saving results to hypothesis tracker")
    args = parser.parse_args()

    end = date.today().isoformat()
    start = (date.today() - timedelta(days=args.days)).isoformat()

    tracker = HypothesisTracker() if not args.no_db else None

    print(f"\nBatch hypothesis test: {len(STRATEGIES)} strategies × {len(args.tickers)} tickers")
    print(f"Period: {start} → {end}  |  Position size: ${args.size:,.0f}")
    print(f"Tickers: {', '.join(args.tickers)}")

    # Pre-register hypotheses
    if tracker:
        for s in STRATEGIES:
            tracker.register(
                name=s["name"],
                description=s["description"],
                strategy_class=s["class"].__name__,
                parameters=s["params"],
            )

    all_results = []

    for strat_cfg in STRATEGIES:
        _print_strategy_banner(strat_cfg["name"])

        all_trades: list[dict] = []

        for ticker in args.tickers:
            strategy = strat_cfg["class"](**strat_cfg["params"])
            try:
                summary, trades = _run_one(strategy, ticker, start, end, args.size)
            except Exception as exc:
                print(f"    {ticker:<6}  ERROR: {exc}")
                continue

            _print_ticker_row(ticker, summary)
            all_trades.extend(trades)

            # Record per-ticker result in tracker
            if tracker and trades:
                trades_df = pd.DataFrame(trades)
                tracker.record_result(
                    name=strat_cfg["name"],
                    metrics_summary=summary,
                    trades_df=trades_df,
                    symbol=ticker,
                    date_range=f"{start} → {end}",
                )

        combined = _aggregate_metrics(all_trades)
        promoted = (
            combined["total_trades"] >= MIN_TRADES
            and combined["win_rate"] >= MIN_WIN_RATE
            and combined["profit_factor"] >= MIN_PROFIT_FACTOR
        )
        _print_combined_summary(strat_cfg["name"], combined, promoted)

        all_results.append({
            "key": strat_cfg["key"],
            "name": strat_cfg["name"],
            "combined": combined,
            "promoted": promoted,
        })

    # Final comparison report
    _print_baseline_comparison(all_results)

    promoted_count = sum(1 for r in all_results if r["promoted"])
    print(f"\n  {promoted_count}/{len(STRATEGIES)} strategies meet validation criteria.")

    if tracker:
        print("\n  Hypothesis tracker status:")
        tracker.print_status()

    print()


if __name__ == "__main__":
    main()
