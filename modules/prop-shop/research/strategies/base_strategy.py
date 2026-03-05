"""
Abstract base class for all research strategies.

Every strategy must implement:
    generate_signals(df) -> pd.DataFrame  # adds 'signal' column
    should_exit(position, current_bar) -> bool

The backtesting engine calls these methods – strategies should be
stateless between calls so they compose cleanly with the engine.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

import pandas as pd


@dataclass
class Position:
    """Represents an open trade position."""
    symbol: str
    entry_date: datetime
    entry_price: float
    shares: int
    direction: str = "long"   # "long" or "short"
    metadata: dict = field(default_factory=dict)  # strategy-specific context

    @property
    def cost_basis(self) -> float:
        return self.entry_price * self.shares

    def days_held(self, current_date: datetime) -> int:
        return (current_date - self.entry_date).days


@dataclass
class Trade:
    """Completed (closed) trade record."""
    symbol: str
    entry_date: datetime
    exit_date: datetime
    entry_price: float
    exit_price: float
    shares: int
    direction: str
    exit_reason: str          # e.g. "signal", "max_hold", "stop_loss"
    fees: float               # total transaction costs (both legs)
    pnl_gross: float          # (exit_price - entry_price) * shares [long]
    pnl_net: float            # pnl_gross - fees
    is_win: bool
    metadata: dict = field(default_factory=dict)

    @classmethod
    def from_position(
        cls,
        position: Position,
        exit_date: datetime,
        exit_price: float,
        fees: float,
        exit_reason: str = "signal",
        metadata: Optional[dict] = None,
    ) -> "Trade":
        if position.direction == "long":
            pnl_gross = (exit_price - position.entry_price) * position.shares
        else:
            pnl_gross = (position.entry_price - exit_price) * position.shares

        pnl_net = pnl_gross - fees
        return cls(
            symbol=position.symbol,
            entry_date=position.entry_date,
            exit_date=exit_date,
            entry_price=position.entry_price,
            exit_price=exit_price,
            shares=position.shares,
            direction=position.direction,
            exit_reason=exit_reason,
            fees=fees,
            pnl_gross=pnl_gross,
            pnl_net=pnl_net,
            is_win=pnl_net > 0,
            metadata={**position.metadata, **(metadata or {})},
        )

    def to_dict(self) -> dict:
        return {
            "symbol":       self.symbol,
            "entry_date":   self.entry_date,
            "exit_date":    self.exit_date,
            "entry_price":  self.entry_price,
            "exit_price":   self.exit_price,
            "shares":       self.shares,
            "direction":    self.direction,
            "exit_reason":  self.exit_reason,
            "fees":         self.fees,
            "pnl_gross":    self.pnl_gross,
            "pnl_net":      self.pnl_net,
            "is_win":       self.is_win,
            **{f"meta_{k}": v for k, v in self.metadata.items()},
        }


class BaseStrategy(ABC):
    """
    Abstract strategy interface.

    Subclasses must implement `generate_signals` and `should_exit`.
    They may optionally override `name` and `description`.
    """

    name: str = "UnnamedStrategy"
    description: str = ""

    @abstractmethod
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add an 'entry_signal' column (and optionally 'exit_signal') to *df*.

        Parameters
        ----------
        df : pd.DataFrame
            OHLCV + indicators DataFrame (output of data_loader.add_indicators).

        Returns
        -------
        pd.DataFrame
            Same DataFrame with 'entry_signal' column added:
              1  = go long
              -1 = go short
              0  = no action
        """
        ...

    @abstractmethod
    def should_exit(self, position: Position, current_bar: pd.Series) -> tuple[bool, str]:
        """
        Decide whether to close *position* on *current_bar*.

        Parameters
        ----------
        position : Position
            The open position.
        current_bar : pd.Series
            A single row from the price/indicator DataFrame.

        Returns
        -------
        (exit: bool, reason: str)
        """
        ...

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name={self.name!r})"
