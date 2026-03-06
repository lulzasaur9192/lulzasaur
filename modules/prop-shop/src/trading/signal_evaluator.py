"""Signal Evaluator - Integrates multi-strategy framework with trading decisions."""

from typing import Dict, Optional
from src.trading.multi_strategy import MultiStrategyManager


class SignalEvaluator:
    """Evaluates market signals using multi-strategy framework."""
    
    def __init__(self, backtest_results_path: str):
        """Initialize with multi-strategy manager."""
        self.manager = MultiStrategyManager(backtest_results_path)
    
    def evaluate_rsi_signal(self, ticker: str, rsi: float, price_data: Dict) -> Optional[Dict]:
        """
        Evaluate an RSI < 40 signal using multi-strategy framework.
        
        Args:
            ticker: Stock symbol (PLTR, GDX, etc.)
            rsi: Current RSI value
            price_data: Dict with price, indicators, etc.
        
        Returns:
            Decision dict with {strategy_key, display_name, confidence, reason}
            or None if no valid strategy
        """
        
        # Check if RSI < 40 threshold met
        if rsi >= 40:
            return None
        
        # Signal context
        signal = {
            'ticker': ticker,
            'rsi': rsi,
            'price_data': price_data,
            'conditions': {'rsi_oversold': True},
        }
        
        # All 3 strategies confirm RSI oversold signal
        matching_strategies = ['rsi_oversold', 'rsi_macd', 'rsi_bollinger_bands']
        
        # Get best strategy for this signal
        decision = self.manager.evaluate_signal(signal, matching_strategies)
        
        return decision
    
    def register_trade_result(self, strategy_key: str, won: bool) -> None:
        """Register trade result to update live strategy stats."""
        self.manager.register_trade(strategy_key, won)
    
    def get_strategy_status(self) -> Dict:
        """Get status of all strategies."""
        return self.manager.get_strategy_status()
