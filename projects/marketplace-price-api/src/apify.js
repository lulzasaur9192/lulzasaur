const APIFY_TOKEN = process.env.APIFY_TOKEN;
const BASE = 'https://api.apify.com/v2';

async function runActor(actorId, input, timeoutSecs = 120) {
  const url = `${BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=${timeoutSecs}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify error ${res.status}: ${text}`);
  }
  return res.json();
}

async function searchReverb({ query, maxPrice, minPrice, condition, maxListings = 25 }) {
  const input = {
    searchQueries: [query],
    maxListings,
  };
  if (maxPrice) input.maxPrice = Number(maxPrice);
  if (minPrice) input.minPrice = Number(minPrice);
  if (condition) input.condition = condition;

  return runActor('lulzasaur9192~reverb-scraper', input);
}

async function searchTCG({ query, productLine, maxListings = 25 }) {
  const input = {
    searchQueries: [query],
    maxListings,
  };
  if (productLine) input.productLine = productLine;

  return runActor('lulzasaur9192~tcgplayer-scraper', input);
}

function computePriceStats(items, priceField) {
  const prices = items.map(i => i[priceField]).filter(p => typeof p === 'number' && p > 0);
  if (prices.length === 0) return { min: null, max: null, avg: null, median: null, count: 0 };
  prices.sort((a, b) => a - b);
  const sum = prices.reduce((a, b) => a + b, 0);
  const mid = Math.floor(prices.length / 2);
  return {
    min: prices[0],
    max: prices[prices.length - 1],
    avg: Math.round((sum / prices.length) * 100) / 100,
    median: prices.length % 2 ? prices[mid] : Math.round(((prices[mid - 1] + prices[mid]) / 2) * 100) / 100,
    count: prices.length,
  };
}

module.exports = { searchReverb, searchTCG, computePriceStats };
