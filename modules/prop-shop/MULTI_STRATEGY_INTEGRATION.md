# Multi-Strategy Integration Guide

## Overview
The trading system now uses an autonomous multi-strategy selection framework that evaluates market signals and selects the best strategy to trade based on live performance metrics.

## How to Use in Trading-Agent

### 1. Import the Signal Evaluator

```python
from src.trading.signal_evaluator import SignalEvaluator

# Initialize evaluator
evaluator = SignalEvaluator('/path/to/backtest_results.json')
```

### 2. Evaluate Market Signals

When an RSI < 40 signal is detected:

```python
# Get price data and indicators for symbol
price_data = {
    'close': current_price,
    'high': day_high,
    'low': day_low,
    'rsi': rsi_value,
    'macd': macd_value,
    'bb_upper': bb_upper,
    'bb_lower': bb_lower,
}

# Evaluate signal using multi-strategy framework
decision = evaluator.evaluate_rsi_signal(
    ticker='PLTR',
    rsi=rsi_value,
    price_data=price_data
)

if decision:
    # Signal confirmed by framework
    strategy = decision['strategy_key']  # 'rsi_oversold', 'rsi_macd', or 'rsi_bollinger_bands'
    confidence = decision['confidence']  # 0.0 to 1.0
    reason = decision['reason']  # Human-readable explanation
    
    print(f"Trading {ticker} with {decision['display_name']} strategy")
    print(f"Confidence: {confidence:.1%}")
    print(f"Reason: {reason}")
    
    # Proceed with trade using selected strategy
    execute_trade(ticker, strategy, confidence)
else:
    # No valid strategy confirmed this signal
    skip_signal()
```

### 3. Register Trade Results

After a trade completes, update live performance metrics:

```python
# After trade closes
won = final_price > entry_price  # or whatever your P&L logic is
evaluator.register_trade_result(strategy_key='rsi_bollinger_bands', won=won)
```

### 4. Monitor Strategy Status

Get status of all strategies for dashboard/logging:

```python
status = evaluator.get_strategy_status()
for strategy_key, info in status.items():
    print(f"{strategy_key}:")
    print(f"  Backtest WR: {info['backtest_wr']:.1f}%")
    print(f"  Live WR: {info['live_wr']:.1f}%")
    print(f"  Trades: {info['trades']}")
    print(f"  Active: {info['active']}")
```

## Validated Strategies

### 1. RSI + Bollinger Bands (BEST) ⭐
- **Win Rate**: 71.11%
- **Profit Factor**: 1.67x
- **Entry**: RSI < 40 AND price at lower Bollinger Band
- **Key**:  `rsi_bollinger_bands`

### 2. RSI + MACD Confirmation
- **Win Rate**: 70.59%
- **Profit Factor**: 1.39x
- **Entry**: RSI < 40 AND MACD histogram positive
- **Key**: `rsi_macd`

### 3. RSI Oversold (Baseline)
- **Win Rate**: 67.74%
- **Profit Factor**: 1.43x
- **Entry**: RSI < 40
- **Key**: `rsi_oversold`

## Framework Behavior

### Strategy Selection
For each RSI < 40 signal:
1. Framework checks which strategies confirm the signal
2. Ranks by: live win rate (40%), Sharpe ratio (30%), backtest confidence (30%)
3. Returns highest-ranked strategy that passes 55% confidence threshold
4. Returns None if no strategy passes threshold

### Live Performance Tracking
- Trades are logged with strategy selection
- Win rate calculated per strategy (wins / total trades)
- Strategies auto-retire if live WR drops below 40% after 10+ trades
- Live performance improves strategy ranking over time

### Example Flow

```
Market signal: PLTR RSI = 7.5 (< 40 threshold)
↓
All 3 strategies confirm signal (RSI < 40 = true)
↓
Selector ranks them:
  1. RSI+BB: 71.11% backtest WR → rank #1
  2. RSI+MACD: 70.59% backtest WR → rank #2
  3. RSI baseline: 67.74% backtest WR → rank #3
↓
Decision: Trade with RSI+BB (highest ranked, passes 55% threshold)
↓
Trade executes, monitor position
↓
Position closes: profit = yes
↓
register_trade_result('rsi_bollinger_bands', won=True)
↓
Live WR for RSI+BB updates: 1/1 = 100%
↓
Next signal: RSI+BB will rank even higher due to live performance
```

## Integration Checklist

- [ ] Import SignalEvaluator in trading-agent code
- [ ] Initialize with backtest_results.json path
- [ ] Call evaluate_rsi_signal() for each RSI < 40 signal
- [ ] Execute trade using selected strategy
- [ ] Call register_trade_result() when position closes
- [ ] Log decision and strategy selection
- [ ] Monitor strategy status dashboard

## Files

**Core Framework:**
- `src/trading/multi_strategy/strategy_registry.py` - Loads strategies, tracks live stats
- `src/trading/multi_strategy/strategy_selector.py` - Ranks and selects best strategy
- `src/trading/multi_strategy/multi_strategy_manager.py` - Main API
- `src/trading/multi_strategy/__init__.py` - Module exports

**Integration:**
- `src/trading/signal_evaluator.py` - Trading-agent integration layer

**Data:**
- `backtest_results.json` - Validated strategy stats from March 5 backtesting

## Next Steps

1. ✅ Framework implemented and approved
2. → Integrate SignalEvaluator into trading-agent.py
3. → Test with live market signals (PLTR RSI 7.5, GDX RSI 5.2)
4. → Monitor first trades and strategy selection
5. → Adjust ranking weights based on live performance

**Status:** Integration ready. Framework is production code.
