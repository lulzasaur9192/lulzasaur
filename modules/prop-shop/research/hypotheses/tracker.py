"""
Hypothesis tracking system for the prop-shop research pipeline.

Each hypothesis has a lifecycle:
  testing  →  validated  (meets win rate + profit factor thresholds)
           →  failed     (below thresholds OR insufficient data)

Results are persisted to a JSON file (candidates/ directory) so they
survive across sessions. The tracker also maintains a lessons-learned
log for failed hypotheses.

Usage
-----
    from research.hypotheses.tracker import HypothesisTracker

    tracker = HypothesisTracker()
    tracker.register(
        name="RSI Oversold Bounce — SPY",
        description="Long when RSI(14) < 35, exit when RSI > 65 or 5-day hold.",
        strategy_class="RSIOversoldStrategy",
    )

    # After running a backtest:
    from research.backtesting import metrics
    results = metrics.summary(trades)
    tracker.record_result("RSI Oversold Bounce — SPY", results, trades_df)
    tracker.print_status()
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

try:
    from config import MIN_TRADES_FOR_VALIDATION, MIN_WIN_RATE, MIN_PROFIT_FACTOR
except ImportError:
    MIN_TRADES_FOR_VALIDATION = 20
    MIN_WIN_RATE = 0.55
    MIN_PROFIT_FACTOR = 1.5

CANDIDATES_DIR = Path(__file__).resolve().parents[2] / "research" / "candidates"
TRACKER_FILE = CANDIDATES_DIR / "hypotheses.json"


class HypothesisTracker:
    """
    Tracks research hypotheses from initial idea to validated strategy.

    Parameters
    ----------
    min_trades : int
        Minimum number of trades required before evaluating.
    min_win_rate : float
        Minimum win rate threshold (0–1).
    min_profit_factor : float
        Minimum profit factor threshold.
    storage_path : Path, optional
        Custom path for the JSON persistence file.
    """

    def __init__(
        self,
        min_trades: int = MIN_TRADES_FOR_VALIDATION,
        min_win_rate: float = MIN_WIN_RATE,
        min_profit_factor: float = MIN_PROFIT_FACTOR,
        storage_path: Optional[Path] = None,
    ):
        self.min_trades = min_trades
        self.min_win_rate = min_win_rate
        self.min_profit_factor = min_profit_factor
        self._path = Path(storage_path) if storage_path else TRACKER_FILE
        self._hypotheses: dict[str, dict] = {}
        self._load()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _load(self) -> None:
        if self._path.exists():
            try:
                with open(self._path) as f:
                    self._hypotheses = json.load(f)
            except (json.JSONDecodeError, OSError):
                self._hypotheses = {}

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w") as f:
            json.dump(self._hypotheses, f, indent=2, default=str)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def register(
        self,
        name: str,
        description: str,
        strategy_class: str = "",
        parameters: Optional[dict] = None,
    ) -> None:
        """
        Register a new hypothesis for testing.

        If a hypothesis with the same name already exists, this is a no-op
        (won't overwrite existing results).
        """
        if name in self._hypotheses:
            print(f"[tracker] '{name}' already registered — skipping.")
            return

        self._hypotheses[name] = {
            "name": name,
            "description": description,
            "strategy_class": strategy_class,
            "parameters": parameters or {},
            "status": "testing",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "backtest_results": [],  # list of result dicts (one per run)
            "latest_metrics": {},
            "lessons_learned": [],
            "rejection_reasons": [],
        }
        self._save()
        print(f"[tracker] Registered hypothesis: '{name}'")

    def record_result(
        self,
        name: str,
        metrics_summary: dict,
        trades_df: Optional[pd.DataFrame] = None,
        symbol: str = "",
        date_range: str = "",
        notes: str = "",
    ) -> str:
        """
        Record a backtest result for a hypothesis and update its status.

        Parameters
        ----------
        name : str
            Hypothesis name (must have been registered first).
        metrics_summary : dict
            Output of metrics.summary(trades).
        trades_df : pd.DataFrame, optional
            Full trade log; saved as CSV alongside JSON if provided.
        symbol : str
            Symbol(s) tested, for logging.
        date_range : str
            Human-readable date range, e.g. "2022-01-01 → 2025-01-01".
        notes : str
            Free-form notes for this run.

        Returns
        -------
        str
            New status: "testing", "validated", or "failed".
        """
        if name not in self._hypotheses:
            raise KeyError(f"Hypothesis '{name}' not registered. Call register() first.")

        hyp = self._hypotheses[name]

        run_record = {
            "run_at": datetime.now().isoformat(),
            "symbol": symbol,
            "date_range": date_range,
            "notes": notes,
            **metrics_summary,
        }
        hyp["backtest_results"].append(run_record)
        hyp["latest_metrics"] = metrics_summary
        hyp["updated_at"] = datetime.now().isoformat()

        # Determine new status
        new_status = self._evaluate(metrics_summary)
        hyp["status"] = new_status

        if new_status == "failed":
            reasons = self._rejection_reasons(metrics_summary)
            hyp["rejection_reasons"].extend(reasons)

        # Optionally save trade log as CSV
        if trades_df is not None and not trades_df.empty:
            csv_name = f"{name.replace(' ', '_').replace('/', '-')}_{symbol}_{datetime.now().strftime('%Y%m%d')}.csv"
            csv_path = CANDIDATES_DIR / csv_name
            CANDIDATES_DIR.mkdir(parents=True, exist_ok=True)
            trades_df.to_csv(csv_path, index=False)
            run_record["trades_csv"] = str(csv_path)

        self._save()
        print(f"[tracker] '{name}' → status: {new_status.upper()}")
        return new_status

    def add_lesson(self, name: str, lesson: str) -> None:
        """Record a lesson learned for a hypothesis (especially useful for failures)."""
        if name not in self._hypotheses:
            raise KeyError(f"Hypothesis '{name}' not found.")
        self._hypotheses[name]["lessons_learned"].append({
            "recorded_at": datetime.now().isoformat(),
            "lesson": lesson,
        })
        self._save()

    # ------------------------------------------------------------------
    # Evaluation logic
    # ------------------------------------------------------------------

    def _evaluate(self, metrics: dict) -> str:
        """Return 'validated', 'failed', or 'testing' based on metrics."""
        n = metrics.get("total_trades", 0)
        if n < self.min_trades:
            return "testing"  # Not enough data yet

        wr = metrics.get("win_rate", 0)
        pf = metrics.get("profit_factor", 0)

        if wr >= self.min_win_rate and pf >= self.min_profit_factor:
            return "validated"
        return "failed"

    def _rejection_reasons(self, metrics: dict) -> list[str]:
        reasons = []
        wr = metrics.get("win_rate", 0)
        pf = metrics.get("profit_factor", 0)
        n = metrics.get("total_trades", 0)
        if n < self.min_trades:
            reasons.append(f"Insufficient trades: {n} < {self.min_trades}")
        if wr < self.min_win_rate:
            reasons.append(f"Win rate too low: {wr:.1%} < {self.min_win_rate:.1%}")
        if pf < self.min_profit_factor:
            reasons.append(f"Profit factor too low: {pf:.2f} < {self.min_profit_factor:.2f}")
        return reasons

    # ------------------------------------------------------------------
    # Querying
    # ------------------------------------------------------------------

    def get(self, name: str) -> dict:
        if name not in self._hypotheses:
            raise KeyError(f"Hypothesis '{name}' not found.")
        return self._hypotheses[name]

    def list_all(self) -> list[dict]:
        return list(self._hypotheses.values())

    def list_by_status(self, status: str) -> list[dict]:
        return [h for h in self._hypotheses.values() if h["status"] == status]

    def validated(self) -> list[dict]:
        return self.list_by_status("validated")

    def failed(self) -> list[dict]:
        return self.list_by_status("failed")

    def testing(self) -> list[dict]:
        return self.list_by_status("testing")

    # ------------------------------------------------------------------
    # Display
    # ------------------------------------------------------------------

    def print_status(self) -> None:
        """Print a summary table of all hypotheses."""
        print(f"\n{'='*65}")
        print(f"  Hypothesis Tracker — {len(self._hypotheses)} hypotheses")
        print(f"  Thresholds: win≥{self.min_win_rate:.0%}, PF≥{self.min_profit_factor}, trades≥{self.min_trades}")
        print(f"{'='*65}")
        print(f"  {'NAME':<35} {'STATUS':<12} {'WIN%':<8} {'PF':<6} {'TRADES'}")
        print(f"  {'-'*63}")

        for hyp in self._hypotheses.values():
            m = hyp.get("latest_metrics", {})
            wr = m.get("win_rate", "-")
            pf = m.get("profit_factor", "-")
            n = m.get("total_trades", "-")

            wr_str = f"{wr:.1%}" if isinstance(wr, float) else str(wr)
            pf_str = f"{pf:.2f}" if isinstance(pf, float) else str(pf)

            status = hyp["status"].upper()
            marker = {"VALIDATED": "✓", "FAILED": "✗", "TESTING": "…"}.get(status, " ")

            print(f"  {marker} {hyp['name']:<34} {status:<12} {wr_str:<8} {pf_str:<6} {n}")

        print(f"{'='*65}\n")
        print(f"  Validated: {len(self.validated())}  |  Failed: {len(self.failed())}  |  Testing: {len(self.testing())}\n")
