"""
Research infrastructure configuration for prop-shop trading system.

All backtest parameters live here so results are reproducible.
Change these values and re-run to test sensitivity.
"""

# --- Universe ---
SYMBOLS = ['SOFI', 'PLTR', 'XLF', 'RIOT', 'GDX', 'SPY']

# --- Transaction cost model ---
SLIPPAGE_PER_SHARE = 0.02    # $0.02/share market impact (conservative)
COMMISSION_PER_SHARE = 0.01  # $0.01/share (typical retail broker)
TOTAL_COST_PER_SHARE = SLIPPAGE_PER_SHARE + COMMISSION_PER_SHARE  # $0.03/share round-trip per leg

# --- Position sizing ---
POSITION_SIZE_USD = 10_000   # Dollar amount per trade (adjust for your account size)
MAX_POSITION_PCT = 0.10      # Never more than 10% of account in one position

# --- Holding period (swing trading) ---
HOLDING_PERIOD_DAYS = (2, 5)  # Min/max days to hold a position
MIN_HOLDING_DAYS = HOLDING_PERIOD_DAYS[0]
MAX_HOLDING_DAYS = HOLDING_PERIOD_DAYS[1]

# --- Hypothesis validation thresholds ---
MIN_TRADES_FOR_VALIDATION = 20   # Need at least 20 trades to draw conclusions
MIN_WIN_RATE = 0.55              # Reject if win rate < 55%
MIN_PROFIT_FACTOR = 1.5          # Reject if gross profit / gross loss < 1.5

# --- Data defaults ---
DEFAULT_LOOKBACK_DAYS = 90       # Short test window
VALIDATION_LOOKBACK_DAYS = 1095  # 3-year validation window (~252 trading days/year)
DATA_CACHE_DIR = "research/.data_cache"

# --- RSI Strategy parameters ---
RSI_PERIOD = 14
RSI_OVERSOLD_THRESHOLD = 35      # Entry: RSI < 35
RSI_OVERBOUGHT_THRESHOLD = 65    # Exit: RSI > 65 (take profit early)

# --- Technical indicator parameters ---
SMA_SHORT_PERIOD = 20
SMA_LONG_PERIOD = 50

# --- Options spread parameters (for future use) ---
OPTIONS_MAX_RISK_PER_TRADE = 500   # Max loss on any single options spread ($)
OPTIONS_DELTA_TARGET = 0.30        # Target delta for short strikes
OPTIONS_DTE_ENTRY = (21, 45)       # Days to expiration at entry
OPTIONS_DTE_EXIT = 7               # Close when DTE reaches this level
