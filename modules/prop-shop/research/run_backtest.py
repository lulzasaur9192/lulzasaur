#!/usr/bin/env python3
"""
CLI backtest runner for prop-shop research.

Uses the backtesting/engine.py + backtesting/data_loader.py framework.
Results are persisted to hypotheses.db and a timestamped JSON file.

Usage examples:
    python run_backtest.py --strategy rsi_oversold --ticker SPY
    python run_backtest.py --strategy rsi_oversold --ticker SOFI --start-date 2022-01-01
    python run_backtest.py --strategy rsi_oversold --ticker PLTR --start-date 2022-01-01 --end-date 2024-12-31
"""

import argparse
import importlib
import json
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# Make the prop-shop project root importable
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from research.backtesting.data_loader import load_symbol
from research.backtesting.engine import BacktestEngine
from research.backtesting import metrics as mt

DB_PATH = Path(__file__).parent / "hypotheses.db"
BACKTESTS_DIR = Path(__file__).parent / "backtests"

STRATEGY_REGISTRY = {
    "rsi_oversold": ("research.strategies.rsi_oversold", "RSIOversoldStrategy"),
    "rsi_oversold_40": ("research.strategies.rsi_oversold_40", "RSIOversold40Strategy"),
    "bb_bounce": ("research.strategies.bb_bounce", "BBBounceStrategy"),
    "volume_breakout": ("research.strategies.volume_breakout", "VolumeBreakoutStrategy"),
    "bb_squeeze": ("research.strategies.bb_squeeze", "BBSqueezeStrategy"),
    "gap_reversal": ("research.strategies.gap_reversal", "GapReversalStrategy"),
    "ma_cross_volume": ("research.strategies.ma_cross_volume", "MACrossVolumeStrategy"),
}

# Promotion thresholds
MIN_WIN_RATE = 0.55
MIN_PROFIT_FACTOR = 1.5
MIN_TRADES = 20


def load_strategy(name: str):
    if name not in STRATEGY_REGISTRY:
        print(f"Unknown strategy '{name}'. Available: {list(STRATEGY_REGISTRY.keys())}")
        sys.exit(1)
    module_path, class_name = STRATEGY_REGISTRY[name]
    module = importlib.import_module(module_path)
    return getattr(module, class_name)()


def _init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS hypotheses (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT,
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS backtest_results (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            hypothesis_id INTEGER REFERENCES hypotheses(id),
            ticker        TEXT NOT NULL,
            strategy      TEXT NOT NULL,
            trades_count  INTEGER,
            win_rate      REAL,
            profit_factor REAL,
            total_pnl     REAL,
            avg_return    REAL,
            max_drawdown  REAL,
            test_date     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS lessons_learned (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            hypothesis_id INTEGER REFERENCES hypotheses(id),
            lesson        TEXT NOT NULL,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    conn.commit()
    conn.close()


def get_or_create_hypothesis(name: str, description: str = "") -> int:
    _init_db()
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT id FROM hypotheses WHERE name = ?", (name,)).fetchone()
    if row:
        hyp_id = row[0]
    else:
        cur = conn.execute(
            "INSERT INTO hypotheses (name, description, status) VALUES (?, ?, 'active')",
            (name, description),
        )
        hyp_id = cur.lastrowid
        conn.commit()
    conn.close()
    return hyp_id


def save_result(hyp_id: int, ticker: str, strategy_name: str, summary: dict):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """INSERT INTO backtest_results
           (hypothesis_id, ticker, strategy, trades_count, win_rate,
            profit_factor, total_pnl, avg_return, max_drawdown)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            hyp_id, ticker, strategy_name,
            summary["total_trades"],
            summary["win_rate"],
            summary["profit_factor"],
            summary["total_pnl"],
            summary["avg_return"],
            summary["max_drawdown"],
        ),
    )
    conn.commit()
    conn.close()


def export_json(ticker: str, strategy_name: str, start: str, end: str,
                summary: dict, trades_dicts: list) -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = BACKTESTS_DIR / f"{strategy_name}_{ticker}_{ts}.json"
    payload = {
        "ticker": ticker,
        "strategy": strategy_name,
        "start_date": start,
        "end_date": end,
        "transaction_costs": {
            "slippage_per_share": 0.02,
            "commission_per_share": 0.01,
            "round_trip_per_share": 0.06,
        },
        "metrics": summary,
        "trades": [
            {k: str(v) if hasattr(v, "isoformat") else v for k, v in t.items()}
            for t in trades_dicts
        ],
    }
    with open(out, "w") as f:
        json.dump(payload, f, indent=2, default=str)
    return out


def print_promotion_summary(ticker: str, strategy_name: str,
                             start: str, end: str, summary: dict):
    n = summary["total_trades"]
    wr = summary["win_rate"]
    pf = summary["profit_factor"]
    pnl = summary["total_pnl"]
    avg = summary["avg_return"]
    dd = summary["max_drawdown"]

    meets_trades = n >= MIN_TRADES
    meets_wr = wr >= MIN_WIN_RATE
    meets_pf = pf >= MIN_PROFIT_FACTOR
    promoted = meets_trades and meets_wr and meets_pf

    print("\n" + "=" * 56)
    print(f"  BACKTEST SUMMARY: {strategy_name} | {ticker}")
    print("=" * 56)
    print(f"  Period:         {start} → {end}")
    print(f"  Trades:         {n:>6}  {'PASS' if meets_trades else 'FAIL'} (min {MIN_TRADES})")
    print(f"  Win Rate:       {wr*100:>5.1f}%  {'PASS' if meets_wr else 'FAIL'} (min {MIN_WIN_RATE*100:.0f}%)")
    print(f"  Profit Factor:  {pf:>6.2f}  {'PASS' if meets_pf else 'FAIL'} (min {MIN_PROFIT_FACTOR})")
    print(f"  Total P&L:      ${pnl:>8.2f}")
    print(f"  Avg Return:     ${avg:>7.2f}/trade")
    print(f"  Max Drawdown:   ${dd:>8.2f}")
    print("-" * 56)
    print(f"  Status:  {'PROMOTED TO CANDIDATE' if promoted else 'DOES NOT MEET STANDARDS'}")
    print("=" * 56 + "\n")


def main():
    default_end = date.today().isoformat()
    default_start = (date.today() - timedelta(days=3 * 365)).isoformat()

    parser = argparse.ArgumentParser(description="Run a prop-shop backtest.")
    parser.add_argument("--strategy", required=True, choices=list(STRATEGY_REGISTRY.keys()))
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--start-date", default=default_start)
    parser.add_argument("--end-date", default=default_end)
    parser.add_argument("--position-size", type=float, default=10_000,
                        help="USD position size per trade (default: 10000)")
    parser.add_argument("--hypothesis", default=None,
                        help="Hypothesis name to associate results with")
    args = parser.parse_args()

    strategy = load_strategy(args.strategy)

    hyp_name = args.hypothesis or args.strategy
    hyp_id = get_or_create_hypothesis(
        hyp_name,
        f"Auto-created hypothesis for strategy: {args.strategy}",
    )

    print(f"\nRunning backtest: {args.strategy} | {args.ticker}")
    print(f"Period: {args.start_date} → {args.end_date}")
    print(f"Position size: ${args.position_size:,.0f}")

    # Load data with indicators
    df = load_symbol(args.ticker, start=args.start_date, end=args.end_date)
    print(f"Loaded {len(df)} trading days  ({df.index[0].date()} → {df.index[-1].date()})")

    # Run backtest
    engine = BacktestEngine(position_size_usd=args.position_size)
    engine.run(df, strategy, symbol=args.ticker)

    summary = engine.summary()
    trades_df = engine.trades_df()
    trades_dicts = trades_df.to_dict("records") if not trades_df.empty else []

    # Persist
    save_result(hyp_id, args.ticker, args.strategy, summary)
    json_path = export_json(
        args.ticker, args.strategy,
        args.start_date, args.end_date,
        summary, trades_dicts,
    )

    print_promotion_summary(
        args.ticker, args.strategy,
        args.start_date, args.end_date,
        summary,
    )
    print(f"Results saved to: {json_path.name}")


if __name__ == "__main__":
    main()
