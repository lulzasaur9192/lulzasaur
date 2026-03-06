"""Strategy Selector - Ranks and selects best strategy for market conditions."""

from typing import Dict, List, Optional, Tuple
from .strategy_registry import StrategyRegistry


class StrategySelector:
    """Selects the best strategy based on current market conditions and performance."""
    
    def __init__(self, registry: StrategyRegistry):
        """Initialize selector with a strategy registry."""
        self.registry = registry
        self.min_confidence_threshold = 0.55  # 55% min win rate to execute
    
    def select_best_strategy(
        self, 
        matching_strategies: List[str],
        market_conditions: Optional[Dict] = None,
    ) -> Optional[Dict]:
        """
        Select the best strategy from matching strategies.
        
        Args:
            matching_strategies: List of strategy keys that confirm the signal
            market_conditions: Optional dict with volatility, trend, etc.
        
        Returns:
            Dict with {strategy_key, display_name, confidence, reason, live_wr, backtest_wr}
            or None if no valid strategy passes threshold
        """
        if not matching_strategies:
            return None
        
        # Score each matching strategy
        scored = []
        for strategy_key in matching_strategies:
            if strategy_key not in self.registry.strategies:
                continue
            
            score_result = self._score_strategy(strategy_key, market_conditions)
            if score_result:
                scored.append(score_result)
        
        if not scored:
            return None
        
        # Sort by score descending
        scored.sort(key=lambda x: x['score'], reverse=True)
        best = scored[0]
        
        # Check if best passes minimum threshold
        if best['effective_wr'] < self.min_confidence_threshold * 100:
            return None
        
        return {
            'strategy_key': best['strategy_key'],
            'display_name': best['display_name'],
            'confidence': best['effective_wr'] / 100.0,
            'reason': best['reason'],
            'live_wr': best['live_wr'],
            'backtest_wr': best['backtest_wr'],
            'score': best['score'],
        }
    
    def _score_strategy(
        self, 
        strategy_key: str, 
        market_conditions: Optional[Dict] = None
    ) -> Optional[Dict]:
        """Score a single strategy."""
        strategy = self.registry.get_strategy(strategy_key)
        live_stats = self.registry.get_live_stats(strategy_key)
        
        if not strategy or not live_stats:
            return None
        
        # Get performance metrics
        backtest_wr = strategy['backtest_stats']['win_rate']
        sharpe = strategy['backtest_stats']['sharpe_ratio']
        
        # For live WR: use live if enough trades, else use backtest
        if live_stats['trades'] >= 10:
            live_wr = live_stats['live_win_rate']
        else:
            live_wr = backtest_wr
        
        # Effective WR: weighted average of live and backtest
        if live_stats['trades'] >= 5:
            effective_wr = (live_wr * 0.6) + (backtest_wr * 0.4)
        else:
            effective_wr = backtest_wr  # Trust backtest if not enough live trades
        
        # Score calculation (0-100)
        # 40% live WR, 30% Sharpe ratio, 30% backtest confidence
        score = (
            (effective_wr / 100.0) * 40 +
            (min(sharpe / 10.0, 1.0) * 30) +  # Normalize Sharpe to 0-1
            ((backtest_wr / 100.0) * 30)
        )
        
        reason = self._build_reason(strategy_key, live_wr, backtest_wr, sharpe)
        
        return {
            'strategy_key': strategy_key,
            'display_name': strategy['display_name'],
            'effective_wr': effective_wr,
            'live_wr': live_wr,
            'backtest_wr': backtest_wr,
            'sharpe': sharpe,
            'score': score,
            'reason': reason,
        }
    
    def _build_reason(
        self, 
        strategy_key: str, 
        live_wr: float, 
        backtest_wr: float, 
        sharpe: float
    ) -> str:
        """Build human-readable reason for strategy selection."""
        strategy = self.registry.get_strategy(strategy_key)
        display = strategy['display_name']
        
        if live_wr > backtest_wr:
            return f"{display} (live: {live_wr:.1f}% > backtest: {backtest_wr:.1f}%)"
        else:
            return f"{display} (backtest: {backtest_wr:.1f}%, Sharpe: {sharpe:.2f})"
