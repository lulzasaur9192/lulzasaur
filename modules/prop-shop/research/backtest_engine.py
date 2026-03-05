"""
Backtesting engine for prop-shop swing trading research.

Transaction costs:
  - Slippage: $0.02/share
  - Commission: $0.01/share
  - Total: $0.03/share (entry + exit = $0.06/share round-trip)

Swing trade holding periods: 2-5 days.
"""

import json
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

RESEARCH_DIR = Path(__file__).parent
DB_PATH = RESEARCH_DIR / "hypotheses.db"
BACKTESTS_DIR = RESEARCH_DIR / "backtests"
DATA_CACHE_DIR = RESEARCH_DIR / "data"

# Transaction costs per share (one-way)
SLIPPAGE_PER_SHARE = 0.02
COMMISSION_PER_SHARE = 0.01
COST_PER_SHARE_ONE_WAY = SLIPPAGE_PER_SHARE + COMMISSION_PER_SHARE  # $0.03
COST_PER_SHARE_ROUND_TRIP = COST_PER_SHARE_ONE_WAY * 2              # $0.06


@dataclass
class Trade:
    entry_date: date
    exit_date: date
    entry_price: float
    exit_price: float
    shares: float
    pnl_gross: float
    pnl_net: float
    return_pct: float
    exit_reason: str


@dataclass
class BacktestResult:
    ticker: str
    strategy: str
    start_date: str
    end_date: str
    trades_count: int
    win_rate: float
    profit_factor: float
    total_pnl: float
    avg_return: float
    max_drawdown: float
    trades: list = field(default_factory=list)


def _init_db():
    """Create database tables if they don't exist."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.executescript("""
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


def fetch_ohlcv(ticker: str, start: str, end: str) -> pd.DataFrame:
    """Download OHLCV data via yfinance with local CSV caching."""
    cache_file = DATA_CACHE_DIR / f"{ticker}_{start}_{end}.csv"
    if cache_file.exists():
        df = pd.read_csv(cache_file, index_col=0, parse_dates=True)
        df.index = pd.to_datetime(df.index).date
        return df

    df = yf.download(ticker, start=start, end=end, auto_adjust=True, progress=False)
    if df.empty:
        raise ValueError(f"No data returned for {ticker} ({start} to {end})")

    # Flatten MultiIndex columns if present (yfinance >= 0.2.x)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    df.to_csv(cache_file)
    df.index = pd.to_datetime(df.index).date
    return df


def _apply_transaction_costs(price: float, shares: float, side: str) -> float:
    """Return the effective price after slippage + commission."""
    cost = COST_PER_SHARE_ONE_WAY * shares
    if side == "buy":
        return price * shares + cost   # total cash out
    else:
        return price * shares - cost   # total cash in


def calculate_metrics(trades: list[Trade]) -> dict:
    """Compute aggregate performance metrics from a list of trades."""
    if not trades:
        return {
            "trades_count": 0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "total_pnl": 0.0,
            "avg_return": 0.0,
            "max_drawdown": 0.0,
        }

    pnls = [t.pnl_net for t in trades]
    returns = [t.return_pct for t in trades]

    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]

    win_rate = len(wins) / len(pnls)
    gross_profit = sum(wins) if wins else 0.0
    gross_loss = abs(sum(losses)) if losses else 0.0
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else float("inf")

    # Equity curve for max drawdown
    cumulative = np.cumsum(pnls)
    running_max = np.maximum.accumulate(cumulative)
    drawdowns = running_max - cumulative
    max_drawdown = float(np.max(drawdowns)) if len(drawdowns) > 0 else 0.0

    return {
        "trades_count": len(trades),
        "win_rate": round(win_rate, 4),
        "profit_factor": round(profit_factor, 4),
        "total_pnl": round(sum(pnls), 2),
        "avg_return": round(float(np.mean(returns)), 4),
        "max_drawdown": round(max_drawdown, 2),
    }


def run_backtest(
    strategy,
    ticker: str,
    start_date: str,
    end_date: str,
    hypothesis_id: int | None = None,
    shares_per_trade: float = 100.0,
) -> BacktestResult:
    """
    Execute a backtest for a given strategy object against historical data.

    The strategy must expose:
        strategy.name: str
        strategy.generate_signals(df: pd.DataFrame) -> pd.Series[bool]  # entry signal per bar
        strategy.should_exit(df, entry_idx, current_idx, entry_price) -> (bool, str)
    """
    _init_db()

    df = fetch_ohlcv(ticker, start_date, end_date)
    signals = strategy.generate_signals(df)

    trades: list[Trade] = []
    dates = list(df.index)
    in_trade = False
    entry_idx = None
    entry_price = None

    for i, d in enumerate(dates):
        if in_trade:
            exit_now, reason = strategy.should_exit(df, entry_idx, i, entry_price)
            if exit_now or i == len(dates) - 1:
                exit_price = float(df.loc[d, "Open"])
                cash_in = _apply_transaction_costs(exit_price, shares_per_trade, "sell")
                cash_out = _apply_transaction_costs(entry_price, shares_per_trade, "buy")
                pnl_gross = (exit_price - entry_price) * shares_per_trade
                pnl_net = cash_in - cash_out
                ret_pct = (exit_price - entry_price) / entry_price

                trades.append(Trade(
                    entry_date=dates[entry_idx],
                    exit_date=d,
                    entry_price=entry_price,
                    exit_price=exit_price,
                    shares=shares_per_trade,
                    pnl_gross=round(pnl_gross, 2),
                    pnl_net=round(pnl_net, 2),
                    return_pct=round(ret_pct, 4),
                    exit_reason=reason,
                ))
                in_trade = False
                entry_idx = None
                entry_price = None

        elif not in_trade and signals.iloc[i]:
            in_trade = True
            entry_idx = i
            entry_price = float(df.loc[d, "Close"])

    metrics = calculate_metrics(trades)

    result = BacktestResult(
        ticker=ticker,
        strategy=strategy.name,
        start_date=start_date,
        end_date=end_date,
        trades=trades,
        **metrics,
    )

    _save_result(result, hypothesis_id)
    _export_json(result)

    return result


def _save_result(result: BacktestResult, hypothesis_id: int | None):
    """Persist backtest metrics to the SQLite database."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        INSERT INTO backtest_results
            (hypothesis_id, ticker, strategy, trades_count, win_rate,
             profit_factor, total_pnl, avg_return, max_drawdown)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            hypothesis_id,
            result.ticker,
            result.strategy,
            result.trades_count,
            result.win_rate,
            result.profit_factor,
            result.total_pnl,
            result.avg_return,
            result.max_drawdown,
        ),
    )
    conn.commit()
    conn.close()


def _export_json(result: BacktestResult):
    """Write backtest result to a timestamped JSON file."""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = BACKTESTS_DIR / f"{result.strategy}_{result.ticker}_{ts}.json"

    payload = {
        "ticker": result.ticker,
        "strategy": result.strategy,
        "start_date": result.start_date,
        "end_date": result.end_date,
        "metrics": {
            "trades_count": result.trades_count,
            "win_rate": result.win_rate,
            "profit_factor": result.profit_factor,
            "total_pnl": result.total_pnl,
            "avg_return": result.avg_return,
            "max_drawdown": result.max_drawdown,
        },
        "transaction_costs": {
            "slippage_per_share": SLIPPAGE_PER_SHARE,
            "commission_per_share": COMMISSION_PER_SHARE,
            "round_trip_per_share": COST_PER_SHARE_ROUND_TRIP,
        },
        "trades": [
            {
                "entry_date": str(t.entry_date),
                "exit_date": str(t.exit_date),
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "shares": t.shares,
                "pnl_gross": t.pnl_gross,
                "pnl_net": t.pnl_net,
                "return_pct": t.return_pct,
                "exit_reason": t.exit_reason,
            }
            for t in result.trades
        ],
    }

    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)

    return out_path


def print_summary(result: BacktestResult):
    """Print a formatted summary report to stdout."""
    PASS = 55.0
    PF_PASS = 1.5
    TRADES_PASS = 20

    win_pct = result.win_rate * 100
    meets_win = win_pct >= PASS
    meets_pf = result.profit_factor >= PF_PASS
    meets_trades = result.trades_count >= TRADES_PASS
    promoted = meets_win and meets_pf and meets_trades

    print("\n" + "=" * 56)
    print(f"  BACKTEST SUMMARY: {result.strategy} | {result.ticker}")
    print("=" * 56)
    print(f"  Period:         {result.start_date} → {result.end_date}")
    print(f"  Trades:         {result.trades_count:>6}  {'PASS' if meets_trades else 'FAIL'} (min {TRADES_PASS})")
    print(f"  Win Rate:       {win_pct:>5.1f}%  {'PASS' if meets_win else 'FAIL'} (min {PASS}%)")
    print(f"  Profit Factor:  {result.profit_factor:>6.2f}  {'PASS' if meets_pf else 'FAIL'} (min {PF_PASS})")
    print(f"  Total P&L:      ${result.total_pnl:>8.2f}")
    print(f"  Avg Return:     {result.avg_return * 100:>5.2f}%")
    print(f"  Max Drawdown:   ${result.max_drawdown:>8.2f}")
    print("-" * 56)
    status = "PROMOTED TO CANDIDATE" if promoted else "DOES NOT MEET STANDARDS"
    print(f"  Status:  {status}")
    print("=" * 56 + "\n")
