# Marketplace Price Tracker

JavaScript client for the [Marketplace Price Tracker API](https://rapidapi.com/lulzasaur9192/api/marketplace-price-api?utm_source=npm&utm_medium=readme&utm_campaign=marketplace-price-tracker) on RapidAPI.

Search and compare prices across 14+ online marketplaces from a single API: OfferUp, Reverb, TCGPlayer, StubHub, Swappa, Poshmark, Craigslist, Grailed, Bonanza, and more.

## Install

```bash
npm install marketplace-price-tracker
```

## Quick Start

```javascript
const MarketplacePriceTracker = require('marketplace-price-tracker');

const tracker = new MarketplacePriceTracker('YOUR_RAPIDAPI_KEY');

// Search TCGPlayer for Pokemon cards
const cards = await tracker.tcgplayer('charizard vmax', { limit: 10 });

// Search Reverb for guitars
const guitars = await tracker.reverb('fender stratocaster', { limit: 20 });

// Search OfferUp locally
const deals = await tracker.offerup('macbook pro', { location: 'new york' });

// Search any marketplace generically
const results = await tracker.search('swappa', { query: 'iphone 15', limit: 10 });

// Compare prices across marketplaces
for (const market of ['offerup', 'swappa', 'craigslist']) {
  const res = await tracker.search(market, { query: 'ps5' });
  console.log(`${market}: ${res.results?.length} listings`);
}
```

## Supported Marketplaces

| Marketplace | Method | Best For |
|-------------|--------|----------|
| TCGPlayer | `tcgplayer(query)` | Trading cards (Pokemon, MTG, Yu-Gi-Oh) |
| Reverb | `reverb(query)` | Music gear (guitars, amps, pedals) |
| OfferUp | `offerup(query)` | Local marketplace deals |
| StubHub | `stubhub(query)` | Event tickets |
| Swappa | `swappa(query)` | Used electronics |
| Poshmark | `poshmark(query)` | Fashion & accessories |
| Craigslist | `craigslist(city, category, query)` | Local classifieds |
| Grailed | `grailed(query)` | Designer/streetwear |
| Bonanza | `bonanza(query)` | General marketplace |
| Goodreads | `search('goodreads', ...)` | Books |
| AbeBooks | `search('abebooks', ...)` | Rare/used books |
| ThriftBooks | `search('thriftbooks', ...)` | Used books |
| Houzz | `search('houzz', ...)` | Home design |
| Redfin | `search('redfin', ...)` | Real estate |

## Additional Endpoints

### `homeServices(service, location)`
Get cost estimates for home services (plumbing, electrical, etc.).

### `estateSales(location, options?)`
Find estate sales near a location.

### `storage(location, options?)`
Compare self-storage facility pricing.

## Use Cases

- **Arbitrage**: Find price discrepancies across marketplaces
- **Price Monitoring**: Track product prices over time
- **Market Research**: Compare pricing across platforms
- **Deal Alerts**: Build notification systems for price drops
- **E-commerce Tools**: Power price comparison features

## Get Your API Key

1. Go to [Marketplace Price API on RapidAPI](https://rapidapi.com/lulzasaur9192/api/marketplace-price-api?utm_source=npm&utm_medium=readme&utm_campaign=marketplace-price-tracker)
2. Subscribe (free tier: 200 requests/month)
3. Copy your API key from the dashboard

## License

MIT
