# SEC EDGAR Insider Trading API

JavaScript client for the [SEC EDGAR Insider Trading Alerts API](https://rapidapi.com/lulzasaur9192/api/sec-insider-trades?utm_source=npm&utm_medium=readme&utm_campaign=sec-edgar-insider-api) on RapidAPI.

Track insider trades, Form 4 filings, and executive buy/sell signals in real-time from SEC EDGAR.

## Install

```bash
npm install sec-edgar-insider-api
```

## Quick Start

```javascript
const SECEdgarClient = require('sec-edgar-insider-api');

const client = new SECEdgarClient('YOUR_RAPIDAPI_KEY');

// Get recent insider trades
const trades = await client.getRecentTrades({ days: 7, limit: 20 });
console.log(trades);

// Get trades for a specific ticker
const applTrades = await client.getTradesByTicker('AAPL', { days: 30 });

// Get full Form 4 filing details
const filing = await client.getFiling('0001234567-26-000123');
```

## API Methods

### `getRecentTrades(options?)`
Get recent Form 4 insider trading filings.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| days | number | 3 | Lookback period (1-30) |
| limit | number | 20 | Results per page (1-100) |
| offset | number | 0 | Pagination offset |
| ticker | string | - | Filter by company ticker |

### `getTradesByTicker(ticker, options?)`
Get all insider trades for a specific company.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| ticker | string | required | Company ticker (e.g. "AAPL") |
| days | number | 30 | Lookback period (1-365) |
| limit | number | 50 | Results per page (1-100) |

### `getFiling(accession)`
Get full parsed Form 4 details for a specific filing.

| Parameter | Type | Description |
|-----------|------|-------------|
| accession | string | Accession number (format: XXXXXXXXXX-YY-ZZZZZZ) |

## Get Your API Key

1. Go to [SEC Insider Trades API on RapidAPI](https://rapidapi.com/lulzasaur9192/api/sec-insider-trades?utm_source=npm&utm_medium=readme&utm_campaign=sec-edgar-insider-api)
2. Subscribe (free tier: 200 requests/month)
3. Copy your API key from the dashboard

## Use Cases

- **Quant Trading**: Track insider buy/sell patterns as trading signals
- **Compliance**: Monitor executive trades for reporting requirements
- **Research**: Analyze insider trading patterns by sector or company
- **Alerts**: Build real-time notification systems for insider activity

## License

MIT
