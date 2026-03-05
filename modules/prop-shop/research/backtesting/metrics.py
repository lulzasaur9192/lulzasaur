"""
Performance metrics calculator for backtest trade logs.

All functions take a list of trade dicts (or a DataFrame) and return
scalar values. Nothing here mutates state.

Trade dict schema (minimum required fields):
    {
        "entry_date":  datetime,
        "exit_date":   datetime,
        "pnl_net":     float,   # P&L after all transaction costs
        "pnl_gross":   float,   # P&L before costs
        "is_win":      bool,
    }
"""

from __future__ import annotations

import math
from typing import Sequence

import numpy as np
import pandas as pd


def _to_series(trades: list[dict] | pd.DataFrame, field: str) -> pd.Series:
    if isinstance(trades, pd.DataFrame):
        return trades[field]
    return pd.Series([t[field] for t in trades])


def win_rate(trades: list[dict] | pd.DataFrame) -> float:
    """Fraction of trades that are profitable (net of costs)."""
    if len(trades) == 0:
        return 0.0
    wins = _to_series(trades, "is_win")
    return float(wins.sum() / len(wins))


def profit_factor(trades: list[dict] | pd.DataFrame) -> float:
    """
    Gross profit / gross loss.

    Returns inf if there are no losing trades (be suspicious of this).
    Returns 0.0 if there are no winning trades.
    """
    pnl = _to_series(trades, "pnl_net")
    gross_profit = pnl[pnl > 0].sum()
    gross_loss = abs(pnl[pnl < 0].sum())
    if gross_loss == 0:
        return math.inf if gross_profit > 0 else 0.0
    return float(gross_profit / gross_loss)


def avg_return_per_trade(trades: list[dict] | pd.DataFrame) -> float:
    """Mean net P&L per trade in dollars."""
    if len(trades) == 0:
        return 0.0
    return float(_to_series(trades, "pnl_net").mean())


def avg_win(trades: list[dict] | pd.DataFrame) -> float:
    """Mean P&L of winning trades."""
    pnl = _to_series(trades, "pnl_net")
    wins = pnl[pnl > 0]
    return float(wins.mean()) if len(wins) > 0 else 0.0


def avg_loss(trades: list[dict] | pd.DataFrame) -> float:
    """Mean P&L of losing trades (returned as a negative number)."""
    pnl = _to_series(trades, "pnl_net")
    losses = pnl[pnl < 0]
    return float(losses.mean()) if len(losses) > 0 else 0.0


def risk_reward_ratio(trades: list[dict] | pd.DataFrame) -> float:
    """avg_win / abs(avg_loss). Returns 0 if there are no losses."""
    loss = avg_loss(trades)
    if loss == 0:
        return 0.0
    return float(avg_win(trades) / abs(loss))


def total_pnl(trades: list[dict] | pd.DataFrame) -> float:
    """Sum of all net P&L (after all transaction costs)."""
    return float(_to_series(trades, "pnl_net").sum())


def max_drawdown(trades: list[dict] | pd.DataFrame) -> float:
    """
    Maximum peak-to-trough drawdown on the cumulative P&L equity curve.

    Returns a negative number (e.g. -1500 means the worst drawdown was $1500).
    """
    pnl = _to_series(trades, "pnl_net")
    cumulative = pnl.cumsum()
    rolling_max = cumulative.cummax()
    drawdown = cumulative - rolling_max
    return float(drawdown.min())


def sharpe_ratio(trades: list[dict] | pd.DataFrame, risk_free_daily: float = 0.0) -> float:
    """
    Annualised Sharpe ratio based on per-trade returns.

    Uses the number of trades per year as the annualisation factor.
    Returns NaN if fewer than 2 trades.

    Parameters
    ----------
    risk_free_daily : float
        Daily risk-free rate (default 0 for simplicity; adjust for T-bill rate).
    """
    pnl = _to_series(trades, "pnl_net")
    if len(pnl) < 2:
        return float("nan")

    # Approximate trades-per-year from the date range
    if isinstance(trades, pd.DataFrame):
        dates = pd.to_datetime(trades["entry_date"])
    else:
        dates = pd.to_datetime([t["entry_date"] for t in trades])

    date_range_days = (dates.max() - dates.min()).days
    if date_range_days <= 0:
        return float("nan")

    trades_per_year = len(pnl) / (date_range_days / 365.25)
    excess = pnl - risk_free_daily
    std = excess.std(ddof=1)
    if std == 0:
        return float("nan")

    # Annualise: multiply by sqrt of number of periods per year
    return float((excess.mean() / std) * math.sqrt(trades_per_year))


def summary(trades: list[dict] | pd.DataFrame) -> dict:
    """
    Return a dict with all key metrics. Handy for printing / logging.
    """
    n = len(trades)
    if n == 0:
        return {"error": "No trades to summarise"}

    return {
        "total_trades":       n,
        "win_rate":           round(win_rate(trades), 4),
        "profit_factor":      round(profit_factor(trades), 3),
        "avg_return":         round(avg_return_per_trade(trades), 2),
        "avg_win":            round(avg_win(trades), 2),
        "avg_loss":           round(avg_loss(trades), 2),
        "risk_reward":        round(risk_reward_ratio(trades), 2),
        "max_drawdown":       round(max_drawdown(trades), 2),
        "total_pnl":          round(total_pnl(trades), 2),
        "sharpe_ratio":       round(sharpe_ratio(trades), 3) if n >= 2 else float("nan"),
    }


def print_summary(trades: list[dict] | pd.DataFrame, label: str = "Backtest") -> None:
    """Pretty-print a metrics summary."""
    s = summary(trades)
    print(f"\n{'='*40}")
    print(f"  {label}")
    print(f"{'='*40}")
    if "error" in s:
        print(f"  {s['error']}")
        return
    print(f"  Trades:         {s['total_trades']}")
    print(f"  Win Rate:       {s['win_rate']:.1%}")
    print(f"  Profit Factor:  {s['profit_factor']:.2f}")
    print(f"  Avg Return:     ${s['avg_return']:,.2f}")
    print(f"  Avg Win:        ${s['avg_win']:,.2f}")
    print(f"  Avg Loss:       ${s['avg_loss']:,.2f}")
    print(f"  Risk/Reward:    {s['risk_reward']:.2f}")
    print(f"  Max Drawdown:   ${s['max_drawdown']:,.2f}")
    print(f"  Total P&L:      ${s['total_pnl']:,.2f}")
    print(f"  Sharpe Ratio:   {s['sharpe_ratio']:.3f}")
    print(f"{'='*40}\n")
