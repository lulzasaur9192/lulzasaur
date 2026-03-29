# SEC EDGAR Insider Trading API

Python client for the [SEC EDGAR Insider Trading Alerts API](https://rapidapi.com/lulzasaur9192/api/sec-insider-trades?utm_source=pypi&utm_medium=readme&utm_campaign=sec-edgar-insider) on RapidAPI.

Track insider trades, Form 4 filings, and executive buy/sell signals in real-time from SEC EDGAR.

## Install

```bash
pip install sec-edgar-insider
```

## Quick Start

```python
from sec_edgar_insider import SECEdgarClient

client = SECEdgarClient(api_key="YOUR_RAPIDAPI_KEY")

# Get recent insider trades
trades = client.get_recent_trades(days=7, limit=20)

# Get trades for a specific ticker
aapl_trades = client.get_trades_by_ticker("AAPL", days=30)

# Get full Form 4 filing details
filing = client.get_filing("0001234567-26-000123")
```

## API Methods

### `get_recent_trades(days=3, limit=20, offset=0, ticker=None)`
Get recent Form 4 insider trading filings.

### `get_trades_by_ticker(ticker, days=30, limit=50)`
Get all insider trades for a specific company.

### `get_filing(accession)`
Get full parsed Form 4 details for a specific filing.

## Get Your API Key

1. Go to [SEC Insider Trades API on RapidAPI](https://rapidapi.com/lulzasaur9192/api/sec-insider-trades?utm_source=pypi&utm_medium=readme&utm_campaign=sec-edgar-insider)
2. Subscribe (free tier: 200 requests/month)
3. Copy your API key

## Use Cases

- **Quant Trading**: Track insider buy/sell patterns as trading signals
- **Compliance**: Monitor executive trades for reporting requirements
- **Research**: Analyze insider trading patterns by sector or company

## License

MIT
