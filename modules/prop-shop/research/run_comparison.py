#!/usr/bin/env python3
"""
Multi-strategy comparison runner.

Runs BB Bounce and Volume Breakout strategies across all 6 tickers and
prints a summary table showing which combinations meet promotion standards:
  - 20+ trades
  - 55%+ win rate
  - 1.5+ profit factor

Usage:
    python3.11 research/run_comparison.py
    python3.11 research/run_comparison.py --start-date 2023-01-01
"""

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from research.backtesting.data_loader import load_symbol
from research.backtesting.engine import BacktestEngine
from research.strategies.bb_bounce import BBBounceStrategy
from research.strategies.volume_breakout import VolumeBreakoutStrategy

# ── Promotion thresholds ───────────────────────────────────────────────────
MIN_TRADES = 20
MIN_WIN_RATE = 0.55
MIN_PROFIT_FACTOR = 1.5

# ── Strategy definitions: (label, instance, engine kwargs) ─────────────────
STRATEGIES = [
    ("BB Bounce",        BBBounceStrategy(),       {"max_holding_days": 5}),
    ("Vol Breakout",     VolumeBreakoutStrategy(), {"max_holding_days": 3}),
]

TICKERS = ["SPY", "PLTR", "SOFI", "XLF", "RIOT", "GDX"]


def _passes(summary: dict) -> bool:
    return (
        summary["total_trades"] >= MIN_TRADES
        and summary["win_rate"] >= MIN_WIN_RATE
        and summary["profit_factor"] >= MIN_PROFIT_FACTOR
    )


def run_all(start_date: str, end_date: str, position_size: float = 10_000) -> list[dict]:
    results = []

    # Pre-fetch data for all tickers (shared across strategies)
    print(f"\nLoading data for {len(TICKERS)} tickers ({start_date} → {end_date})...")
    data = {}
    for ticker in TICKERS:
        try:
            data[ticker] = load_symbol(ticker, start=start_date, end=end_date)
            print(f"  {ticker}: {len(data[ticker])} bars")
        except Exception as exc:
            print(f"  {ticker}: FAILED — {exc}")
            data[ticker] = None

    print()

    for strat_label, strategy, engine_kwargs in STRATEGIES:
        print(f"{'─'*60}")
        print(f"  Strategy: {strat_label}")
        print(f"{'─'*60}")

        for ticker in TICKERS:
            df = data.get(ticker)
            if df is None:
                results.append({
                    "strategy": strat_label,
                    "ticker": ticker,
                    "trades": 0,
                    "win_rate": 0.0,
                    "profit_factor": 0.0,
                    "total_pnl": 0.0,
                    "pass": False,
                    "error": True,
                })
                continue

            engine = BacktestEngine(position_size_usd=position_size, **engine_kwargs)
            try:
                engine.run(df, strategy, symbol=ticker)
                summary = engine.summary()
                if "error" in summary:
                    # 0 trades — metrics module returns {"error": ...}
                    summary = {
                        "total_trades": 0, "win_rate": 0.0,
                        "profit_factor": 0.0, "total_pnl": 0.0,
                    }
                passed = _passes(summary)

                results.append({
                    "strategy": strat_label,
                    "ticker": ticker,
                    "trades": summary["total_trades"],
                    "win_rate": summary["win_rate"],
                    "profit_factor": summary["profit_factor"],
                    "total_pnl": summary["total_pnl"],
                    "pass": passed,
                    "error": False,
                })

                status = "PASS" if passed else "----"
                print(
                    f"  {ticker:<6}  trades={summary['total_trades']:>3}  "
                    f"wr={summary['win_rate']*100:>5.1f}%  "
                    f"pf={summary['profit_factor']:>5.2f}  "
                    f"pnl=${summary['total_pnl']:>8,.0f}  [{status}]"
                )

            except Exception as exc:
                print(f"  {ticker:<6}  ERROR: {exc}")
                results.append({
                    "strategy": strat_label,
                    "ticker": ticker,
                    "trades": 0,
                    "win_rate": 0.0,
                    "profit_factor": 0.0,
                    "total_pnl": 0.0,
                    "pass": False,
                    "error": True,
                })

    return results


def print_comparison_table(results: list[dict], start_date: str, end_date: str):
    col_w = 14
    h_strat  = "Strategy"
    h_ticker = "Ticker"
    h_trades = "Trades"
    h_wr     = "Win Rate"
    h_pf     = "Prof Factor"
    h_pnl    = "Total P&L"
    h_status = "Status"

    sep = "─" * 82
    header = (
        f"  {'Strategy':<{col_w}} {'Ticker':<7} {'Trades':>7}  "
        f"{'Win Rate':>9}  {'Prof Factor':>11}  {'Total P&L':>10}  Status"
    )

    print("\n")
    print("=" * 82)
    print(f"  STRATEGY COMPARISON REPORT  |  {start_date} → {end_date}")
    print(f"  Thresholds: {MIN_TRADES}+ trades, {MIN_WIN_RATE*100:.0f}%+ win rate, {MIN_PROFIT_FACTOR}+ profit factor")
    print("=" * 82)
    print(header)
    print(sep)

    prev_strat = None
    for r in results:
        if prev_strat and r["strategy"] != prev_strat:
            print(sep)

        if r["error"]:
            status_str = "ERROR"
            row = (
                f"  {r['strategy']:<{col_w}} {r['ticker']:<7} {'N/A':>7}  "
                f"{'N/A':>9}  {'N/A':>11}  {'N/A':>10}  {status_str}"
            )
        else:
            checks = []
            if r["trades"] >= MIN_TRADES:
                checks.append("T")
            if r["win_rate"] >= MIN_WIN_RATE:
                checks.append("W")
            if r["profit_factor"] >= MIN_PROFIT_FACTOR:
                checks.append("P")

            status_str = "PASS" if r["pass"] else f"fail({','.join(checks) or 'none'})"
            pf_str = f"{r['profit_factor']:.2f}" if r["profit_factor"] < 999 else "inf"

            row = (
                f"  {r['strategy']:<{col_w}} {r['ticker']:<7} {r['trades']:>7}  "
                f"{r['win_rate']*100:>8.1f}%  {pf_str:>11}  "
                f"${r['total_pnl']:>9,.0f}  {status_str}"
            )

        print(row)
        prev_strat = r["strategy"]

    print("=" * 82)

    # Summary of passing combinations
    passing = [r for r in results if r["pass"]]
    print(f"\n  Combinations meeting ALL thresholds: {len(passing)} / {len(results)}")
    if passing:
        print()
        for r in passing:
            print(
                f"    ✓  {r['strategy']} | {r['ticker']:<6}  "
                f"trades={r['trades']}  wr={r['win_rate']*100:.1f}%  "
                f"pf={r['profit_factor']:.2f}  pnl=${r['total_pnl']:,.0f}"
            )
    else:
        print("    None — consider tuning parameters or testing more tickers.")
    print()


def main():
    default_end = date.today().isoformat()
    default_start = "2023-03-04"

    parser = argparse.ArgumentParser(description="Multi-strategy comparison backtest.")
    parser.add_argument("--start-date", default=default_start)
    parser.add_argument("--end-date", default=default_end)
    parser.add_argument("--position-size", type=float, default=10_000)
    args = parser.parse_args()

    results = run_all(args.start_date, args.end_date, args.position_size)
    print_comparison_table(results, args.start_date, args.end_date)


if __name__ == "__main__":
    main()
