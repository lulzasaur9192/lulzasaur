"""Strategy Registry - Maintains validated strategies with performance metrics."""

import json
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime

class StrategyRegistry:
    """Registry for validated trading strategies with live performance tracking."""
    
    def __init__(self, backtest_results_path: str):
        """Initialize registry from backtest results JSON."""
        self.strategies: Dict = {}
        self.live_stats: Dict[str, Dict] = {}
        self.backtest_results_path = backtest_results_path
        self._load_strategies()
    
    def _load_strategies(self):
        """Load validated strategies from backtest results."""
        with open(self.backtest_results_path, 'r') as f:
            data = json.load(f)
        
        strategies_data = data.get('strategies', {})
        
        # Map strategy names to their combined stats
        strategy_mapping = {
            'rsi_oversold': 'RSI < 40',
            'rsi_macd': 'RSI+MACD',
            'rsi_bollinger_bands': 'RSI+BB',
        }
        
        for key, backtest_name in strategy_mapping.items():
            if backtest_name in strategies_data:
                combined = strategies_data[backtest_name].get('combined', {})
                self.strategies[key] = {
                    'name': key,
                    'display_name': backtest_name,
                    'validated': True,
                    'backtest_stats': {
                        'win_rate': combined.get('win_rate', 0),
                        'profit_factor': combined.get('profit_factor', 0),
                        'sharpe_ratio': combined.get('sharpe_ratio', 0),
                        'trade_count': combined.get('trade_count', 0),
                    },
                    'entry_rule_name': self._get_entry_rule(key),
                }
                
                # Initialize live stats
                self.live_stats[key] = {
                    'trades': 0,
                    'wins': 0,
                    'losses': 0,
                    'live_win_rate': 0.0,
                    'active': True,
                }
    
    def _get_entry_rule(self, strategy_key: str) -> str:
        """Get entry rule description for strategy."""
        rules = {
            'rsi_oversold': 'RSI < 40',
            'rsi_macd': 'RSI < 40 AND MACD histogram positive',
            'rsi_bollinger_bands': 'RSI < 40 AND price at lower Bollinger Band',
        }
        return rules.get(strategy_key, 'Unknown')
    
    def register_trade(self, strategy_key: str, won: bool) -> None:
        """Update live stats for a strategy after trade completion."""
        if strategy_key not in self.live_stats:
            return
        
        stats = self.live_stats[strategy_key]
        stats['trades'] += 1
        
        if won:
            stats['wins'] += 1
        else:
            stats['losses'] += 1
        
        # Update live win rate
        if stats['trades'] > 0:
            stats['live_win_rate'] = (stats['wins'] / stats['trades']) * 100
        
        # Check edge decay: retire if WR < 40% after 10+ trades
        if stats['trades'] >= 10 and stats['live_win_rate'] < 40:
            stats['active'] = False
    
    def retire_strategy(self, strategy_key: str) -> None:
        """Retire a strategy due to edge decay."""
        if strategy_key in self.live_stats:
            self.live_stats[strategy_key]['active'] = False
    
    def get_active_strategies(self) -> List[str]:
        """Get list of active strategy keys."""
        return [
            key for key, stats in self.live_stats.items()
            if stats['active'] and key in self.strategies
        ]
    
    def get_strategy(self, strategy_key: str) -> Optional[Dict]:
        """Get strategy details."""
        return self.strategies.get(strategy_key)
    
    def get_live_stats(self, strategy_key: str) -> Optional[Dict]:
        """Get live performance stats for a strategy."""
        return self.live_stats.get(strategy_key)
    
    def get_all_strategies_status(self) -> Dict:
        """Get status of all strategies."""
        status = {}
        for key in self.strategies:
            stats = self.live_stats[key]
            strategy = self.strategies[key]
            status[key] = {
                'display_name': strategy['display_name'],
                'backtest_wr': strategy['backtest_stats']['win_rate'],
                'live_wr': stats['live_win_rate'],
                'trades': stats['trades'],
                'active': stats['active'],
            }
        return status
