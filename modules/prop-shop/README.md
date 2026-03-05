# prop-shop — Data Pipeline

Daily market data ingestion, technical indicator calculation, market regime classification, and SQLite storage for the prop-shop trading system.

---

## Symbols tracked

| Symbol | Description |
|--------|-------------|
| SOFI   | SoFi Technologies |
| PLTR   | Palantir Technologies |
| XLF    | Financial Select Sector SPDR ETF |
| RIOT   | Riot Platforms (crypto mining proxy) |
| GDX    | VanEck Gold Miners ETF |
| SPY    | S&P 500 ETF (benchmark + regime signal) |
| VIX    | CBOE Volatility Index (fetched as ^VIX) |

---

## Quick start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the pipeline (initialises DB on first run, fetches 2 years of history)
python run_daily_pipeline.py

# 3. Schedule daily (cron example — 6:30 am ET weekdays)
# 30 10 * * 1-5 cd /path/to/prop-shop && python run_daily_pipeline.py
```

---

## Directory structure

```
prop-shop/
├── config.yaml                 # Symbols, indicator params, paths
├── requirements.txt
├── run_daily_pipeline.py       # Orchestrator — run this
├── src/
│   └── data_pipeline/
│       ├── fetch_market_data.py       # yfinance download
│       ├── technical_indicators.py    # RSI, MACD, EMA, BB, ADX, ATR
│       ├── market_regime.py           # SPY+VIX regime classification
│       ├── data_quality.py            # Missing days, outliers, staleness
│       └── database.py                # SQLite read/write interface
├── data/
│   ├── daily/                  # YYYY-MM-DD.csv snapshots (one per run)
│   └── db/
│       └── market_data.db      # SQLite database
├── logs/                       # pipeline_YYYYMMDD.log files
└── tests/                      # Unit tests
```

---

## Data sources

All price data is sourced from **Yahoo Finance** via the `yfinance` library.
- Data is adjusted for splits and dividends (`auto_adjust=True`).
- VIX is fetched using the `^VIX` ticker.

---

## Technical indicators

| Indicator | Parameters | Column(s) |
|-----------|-----------|-----------|
| RSI | period=14 | `rsi` |
| MACD | fast=12, slow=26, signal=9 | `macd`, `macd_signal`, `macd_hist` |
| EMA | 8, 21, 50 | `ema8`, `ema21`, `ema50` |
| Bollinger Bands | period=20, std=2 | `bb_upper`, `bb_middle`, `bb_lower` |
| ADX | period=14 | `adx` |
| ATR | period=14 | `atr` |

---

## Market regimes

Regime is classified daily based on **SPY EMA crossover** and **VIX level**.

| Regime | SPY trend | VIX level |
|--------|-----------|-----------|
| BULL_LOW_VIX | EMA8 > EMA21 | < 15 |
| BULL_MED_VIX | EMA8 > EMA21 | 15–25 |
| BULL_HIGH_VIX | EMA8 > EMA21 | ≥ 25 |
| BEAR_LOW_VIX | EMA8 < EMA21 | < 15 |
| BEAR_MED_VIX | EMA8 < EMA21 | 15–25 |
| BEAR_HIGH_VIX | EMA8 < EMA21 | ≥ 25 |
| SIDEWAYS_LOW_VIX | EMAs within 0.1% | < 15 |
| SIDEWAYS_MED_VIX | EMAs within 0.1% | 15–25 |
| SIDEWAYS_HIGH_VIX | EMAs within 0.1% | ≥ 25 |

---

## Database tables

### `market_data`

| Column | Type | Description |
|--------|------|-------------|
| date | TEXT | YYYY-MM-DD |
| symbol | TEXT | Ticker symbol |
| open / high / low / close | REAL | Price (split/dividend adjusted) |
| volume | REAL | Daily volume |
| rsi | REAL | RSI(14) |
| macd | REAL | MACD line |
| macd_signal | REAL | Signal line |
| macd_hist | REAL | Histogram (macd − signal) |
| ema8 / ema21 / ema50 | REAL | Exponential moving averages |
| bb_upper / bb_middle / bb_lower | REAL | Bollinger Bands |
| adx | REAL | ADX(14) |
| atr | REAL | ATR(14) |
| inserted_at | TEXT | UTC ISO timestamp of insert |

Primary key: `(symbol, date)` — duplicate inserts are silently ignored.

### `market_regimes`

| Column | Type | Description |
|--------|------|-------------|
| date | TEXT | YYYY-MM-DD |
| regime | TEXT | e.g. BULL_LOW_VIX |
| spy_trend | TEXT | BULL / BEAR / SIDEWAYS |
| vix_level | TEXT | LOW_VIX / MED_VIX / HIGH_VIX |
| spy_ema8 | REAL | SPY EMA(8) |
| spy_ema21 | REAL | SPY EMA(21) |
| vix_close | REAL | VIX closing value |

### `data_quality_log`

Logged once per symbol per pipeline run. Tracks missing market days, outliers, indicator completeness, and staleness.

---

## Configuration (`config.yaml`)

```yaml
symbols: [SOFI, PLTR, XLF, RIOT, GDX, SPY, VIX]
start_date: ""      # empty = 2 years back from today
end_date: ""        # empty = today
database:
  path: data/db/market_data.db
export:
  daily_dir: data/daily
```

All indicator parameters (RSI period, EMA lengths, etc.) are also configurable under `indicators:` and `regime:` keys.
