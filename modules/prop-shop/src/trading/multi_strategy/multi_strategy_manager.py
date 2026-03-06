"""Multi-Strategy Manager - Main API for autonomous strategy selection."""

from typing import Dict, Optional, List
from .strategy_registry import StrategyRegistry
from .strategy_selector import StrategySelector


class MultiStrategyManager:
    """Main manager for multi-strategy evaluation and execution."""
    
    def __init__(self, backtest_results_path: str):
        """Initialize manager."""
        self.registry = StrategyRegistry(backtest_results_path)
        self.selector = StrategySelector(self.registry)
        self.decision_log: List[Dict] = []
    
    def evaluate_signal(
        self, 
        signal: Dict,
        matching_strategy_keys: Optional[List[str]] = None
    ) -> Optional[Dict]:
        """
        Evaluate a market signal and select best strategy to trade it.
        
        Args:
            signal: Dict with signal details (ticker, price_data, indicators, etc.)
            matching_strategy_keys: List of strategies that confirm this signal.
                                    If None, defaults to all active strategies.
        
        Returns:
            Dict with {strategy_key, display_name, confidence, reason, live_wr, backtest_wr}
            or None if no valid strategy found
        """
        if matching_strategy_keys is None:
            matching_strategy_keys = self.registry.get_active_strategies()
        
        # Select best strategy
        decision = self.selector.select_best_strategy(
            matching_strategy_keys,
            market_conditions=signal.get('conditions'),
        )
        
        if decision:
            # Log the decision
            decision['signal'] = signal.get('ticker', 'unknown')
            self.decision_log.append(decision)
        
        return decision
    
    def register_trade(self, strategy_key: str, won: bool) -> None:
        """Register a completed trade to update live strategy stats."""
        self.registry.register_trade(strategy_key, won)
    
    def get_strategy_status(self) -> Dict:
        """Get status of all strategies for monitoring/dashboard."""
        return self.registry.get_all_strategies_status()
    
    def get_decision_log(self, limit: int = 100) -> List[Dict]:
        """Get recent trading decisions."""
        return self.decision_log[-limit:]
    
    def get_active_strategies(self) -> List[str]:
        """Get list of active strategy keys."""
        return self.registry.get_active_strategies()
