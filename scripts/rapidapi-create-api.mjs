#!/usr/bin/env node
/**
 * Automate RapidAPI API project creation + monetization setup via Playwright.
 *
 * Usage:
 *   node scripts/rapidapi-create-api.mjs nyc-violations
 *   node scripts/rapidapi-create-api.mjs nyc-violations --monetize-only
 *   node scripts/rapidapi-create-api.mjs nyc-violations --create-only
 *
 * Prerequisites:
 *   - npx playwright install chromium
 *   - Logged into RapidAPI in Chrome as lulzasaur9192
 *   - OpenAPI YAML at rapidapi-backend/openapi/<name>.yaml
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// API definitions — add new APIs here
const APIS = {
  'nyc-violations': {
    name: 'NYC Building Violations API',
    description: 'Search NYC DOB violation records by address, BIN, or block/lot. Data from 3 official DOB datasets via NYC Open Data.',
    category: 'Data',
    yamlFile: 'nyc-violations.yaml',
  },
  'poshmark': { name: 'Poshmark Fashion Resale', description: 'Search Poshmark listings', category: 'eCommerce', yamlFile: 'poshmark.yaml' },
  'craigslist': { name: 'Craigslist Classifieds Search', description: 'Search Craigslist listings', category: 'Data', yamlFile: 'craigslist.yaml' },
  'stubhub': { name: 'StubHub Event Tickets', description: 'Search StubHub event tickets', category: 'Entertainment', yamlFile: 'stubhub.yaml' },
  'swappa': { name: 'Swappa Used Electronics', description: 'Search Swappa listings', category: 'eCommerce', yamlFile: 'swappa.yaml' },
  'offerup': { name: 'OfferUp Local Marketplace', description: 'Search OfferUp listings', category: 'eCommerce', yamlFile: 'offerup.yaml' },
  'goodreads': { name: 'Goodreads Book Data', description: 'Search Goodreads books', category: 'Data', yamlFile: 'goodreads.yaml' },
  'abebooks': { name: 'AbeBooks Rare & Used Books', description: 'Search AbeBooks listings', category: 'eCommerce', yamlFile: 'abebooks.yaml' },
  'thriftbooks': { name: 'ThriftBooks Used Books', description: 'Search ThriftBooks listings', category: 'eCommerce', yamlFile: 'thriftbooks.yaml' },
  'houzz': { name: 'Houzz Home Pro Directory', description: 'Search Houzz professionals', category: 'Data', yamlFile: 'houzz.yaml' },
  'bonanza': { name: 'Bonanza Online Marketplace', description: 'Search Bonanza listings', category: 'eCommerce', yamlFile: 'bonanza.yaml' },
  'imdb': { name: 'IMDb Movies & TV Shows', description: 'Search IMDb titles', category: 'Entertainment', yamlFile: 'imdb.yaml' },
  'redfin': { name: 'Redfin Real Estate Data', description: 'Search Redfin property listings', category: 'Data', yamlFile: 'redfin.yaml' },
  'grailed': { name: 'Grailed Designer Fashion', description: 'Search Grailed listings', category: 'eCommerce', yamlFile: 'grailed.yaml' },
  'psa-pop': { name: 'PSA Card Population Report', description: 'Look up PSA grading data', category: 'Data', yamlFile: 'psa-pop.yaml' },
  'graded-card-census': { name: 'Graded Card Census API', description: 'Trading card grade census data — population reports for entire sets or single cards. Full grade breakdown. Covers PSA-graded cards.', category: 'Data', yamlFile: 'psa-pop.yaml' },
  'nurse-license': { name: 'Nurse License Verification', description: 'Verify nurse licenses', category: 'Data', yamlFile: 'nurse-license.yaml' },
  'contractor-license': { name: 'Contractor License Verification', description: 'Verify contractor licenses', category: 'Data', yamlFile: 'contractor-license.yaml' },
  'fcc-id': { name: 'FCC ID Certification Lookup', description: 'Look up FCC equipment authorization data by FCC ID, grantee code, or applicant name. Get detailed grant info and frequencies.', category: 'Data', yamlFile: 'fcc-id.yaml' },
  'agent-memory': { name: 'Agent Memory Persistence API', description: 'Persistent memory for AI agents — FTS5 search, batch ops, namespace isolation, TTL expiry, access tracking. Inspectable state agents can trust.', category: 'Data', yamlFile: 'agent-memory.yaml' },
  'agent-drift': { name: 'Agent Drift Detection API', description: 'Monitor AI agent outputs for silent degradation. Golden test cases, 4 match modes, cron scheduling, webhook alerts, drift dashboard.', category: 'Data', yamlFile: 'agent-drift.yaml' },
  'skillguard-premium': { name: 'Skillguard Premium API', description: 'AI agent skill safety verification. Classify skills as SAFE/CAUTION/DANGER before installation. Audit trails, batch verification, confidence scores.', category: 'Data', yamlFile: 'skillguard.yaml' },
  'license-verify': { name: 'License Verify API', description: 'Multi-state professional license verification — contractors and nurses across CA, TX, FL, NY. Real-time status, expiration, bond info.', category: 'Data', yamlFile: 'license-verify.yaml' },
  'vertical-api-directory': { name: 'Vertical API Directory', description: 'API marketplace by industry vertical. Browse, list, and feature APIs in Real Estate, E-Commerce, Healthcare, Finance, and more.', category: 'Data', yamlFile: 'vertical-api-directory.yaml' },
  'sec-insider-trades': { name: 'SEC Insider Trading API', description: 'Real-time SEC Form 4 insider trading data — stock purchases, sales, option exercises by officers, directors, and 10% owners.', category: 'Finance', yamlFile: 'sec-insider-trades.yaml' },
  'healthcare-license': { name: 'Healthcare License Verification API', description: 'Verify healthcare professional licenses across all 50 US states. 22 professions: MD, RN, PT, DDS, PA, DC, OD and more via NPPES NPI Registry + deep state board verification.', category: 'Data', yamlFile: 'healthcare-license.yaml' },
  'insider-buy-signal': { name: 'Insider Buy Signal API', description: 'Track when CEOs and directors BUY their own stock — the strongest insider bullish signal. Filtered SEC Form 4 purchases as clean JSON. No XML parsing.', category: 'Finance', yamlFile: 'insider-buy-signal.yaml' },
  'marketplace-price-tracker': { name: 'Cross-Marketplace Price Tracker', description: 'Search Reverb, TCGPlayer, OfferUp, and Poshmark from one API. Market prices, conditions, seller ratings. One integration, four marketplaces, normalized JSON.', category: 'eCommerce', yamlFile: 'marketplace-price-tracker.yaml' },
  'dentist-optometrist-license': { name: 'Dentist & Optometrist License Verification API', description: 'Verify dentist (DDS/DMD) and optometrist (OD) licenses across all 50 US states via NPPES NPI Registry. Instant lookup by name, state, or NPI number.', category: 'Data', yamlFile: 'dentist-optometrist-license.yaml' },
  'childcare-calculator': { name: 'Childcare Cost Calculator API', description: 'Calculate and compare childcare costs across the US. Weekly/annual pricing by ZIP, county, or state. DOL data, 3,200+ counties, 2008-2022.', category: 'Data', yamlFile: 'childcare-calculator.yaml' },
  'vintage-guitar-valuation': { name: 'Vintage Guitar Valuation API', description: 'Get real-time market values for vintage and used guitars from Reverb.com. Prices, conditions, seller details for Gibson, Fender, Martin & more.', category: 'Music', yamlFile: 'vintage-guitar-valuation.yaml' },
  'fashion-resale-price-guide': { name: 'Fashion Resale Price Guide API', description: 'Get resale prices for designer fashion from Grailed and Poshmark. Two platforms, one API. Sneakers, designer clothing, handbags, accessories.', category: 'eCommerce', yamlFile: 'fashion-resale-price-guide.yaml' },
  'event-ticket-tracker': { name: 'Event Ticket Price Tracker API', description: 'Track event ticket prices and availability from StubHub. Concerts, sports, theater, festivals. Real-time pricing, venues, dates, ticket counts.', category: 'Entertainment', yamlFile: 'event-ticket-tracker.yaml' },
  'used-electronics-resale': { name: 'Used Electronics Resale Price API', description: 'Get resale prices for used phones, laptops, and electronics from Swappa and OfferUp. Two marketplaces, one API. Carrier, storage, battery health.', category: 'eCommerce', yamlFile: 'used-electronics-resale.yaml' },
  'rare-book-price': { name: 'Rare & Used Book Price API', description: 'Search ThriftBooks, AbeBooks, and Goodreads from one API. Used book prices, rare editions, ISBN data, ratings, seller info. Three platforms, one integration.', category: 'eCommerce', yamlFile: 'rare-book-price.yaml' },
  'agent-compliance-logger': { name: 'AI Agent Compliance Logger API', description: 'Tamper-evident audit logging for AI agents. HMAC-SHA256 chained entries, chain verification, GDPR redaction. SOC 2 and regulatory compliance evidence.', category: 'Data', yamlFile: 'agent-compliance-logger.yaml' },
  'resale-arbitrage-scanner': { name: 'Resale Arbitrage Scanner API', description: 'Search 5 resale marketplaces from one API — OfferUp, Poshmark, Grailed, Bonanza, Craigslist. Find underpriced items to flip across platforms.', category: 'eCommerce', yamlFile: 'resale-arbitrage-scanner.yaml' },
  // Wave 3 — niche verticals (2026-04-02)
  'building-permits': { name: 'US Building Permits API', description: 'Search building permits in NYC, Chicago, and SF. Permit numbers, status, dates, property details from city open data.', category: 'Data', yamlFile: 'building-permits.yaml' },
  'pharmacy-license': { name: 'Pharmacy & Pharmacist License Verification API', description: 'Verify pharmacist (RPH/PharmD) licenses in all 50 states via NPPES NPI Registry. Instant name, state, or NPI lookup.', category: 'Data', yamlFile: 'pharmacy-license.yaml' },
  'sports-card-prices': { name: 'Sports Card Price Tracker API', description: 'Track sports card prices from TCGPlayer. Search by player, set, or sport. Market prices, conditions, recent sales for collectors.', category: 'eCommerce', yamlFile: 'sports-card-prices.yaml' },
  'music-gear-deals': { name: 'Music Gear Deals API', description: 'Find deals on guitars, amps, pedals from Reverb.com. Prices, conditions, seller ratings for used music equipment.', category: 'Music', yamlFile: 'music-gear-deals.yaml' },
  'government-surplus': { name: 'Government Surplus Auction API', description: 'Search GSA government surplus auctions. Vehicles, electronics, office equipment at deep discounts. Official GSA data.', category: 'Data', yamlFile: 'government-surplus.yaml' },
  // Wave 4 — recall/safety APIs (2026-04-02)
  'fda-drug-recalls': { name: 'FDA Drug Recall Alert API', description: 'Search FDA drug recall and enforcement data. Class I/II/III recalls, firm info, product descriptions, dates. Official openFDA data.', category: 'Data', yamlFile: 'fda-drug-recalls.yaml' },
  'vehicle-recalls': { name: 'Vehicle Recall & Safety API', description: 'Search NHTSA vehicle recalls and safety complaints. By make, model, year. Official government recall data.', category: 'Data', yamlFile: 'vehicle-recalls.yaml' },
  'product-safety-recalls': { name: 'Consumer Product Safety Recall API', description: 'Search CPSC consumer product safety recalls. Product descriptions, hazards, remedies. From SaferProducts.gov.', category: 'Data', yamlFile: 'product-safety-recalls.yaml' },
};

const PRICING = [
  { plan: 'BASIC', price: 0, quota: 50 },
  { plan: 'PRO', price: 9.99, quota: 1000 },
  { plan: 'ULTRA', price: 29.99, quota: 5000 },
  { plan: 'MEGA', price: 99.99, quota: 25000 },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function createApiProject(page, api, yamlPath) {
  console.log(`\n📦 Creating API project: ${api.name}`);

  await page.goto('https://rapidapi.com/studio');
  await sleep(8000);

  const iframe = page.locator('#studio-iframe').contentFrame();

  // Wait for iframe content to load by waiting for the Add API Project button
  const addBtn = iframe.getByRole('button', { name: /add.*api.*project/i });
  await addBtn.waitFor({ state: 'visible', timeout: 60000 });

  // Click "Add API Project"
  await addBtn.click();
  await sleep(1500);

  // Fill name (2nd textbox — 1st is search bar)
  await iframe.getByRole('textbox').nth(1).fill(api.name);
  await sleep(300);

  // Fill description (3rd textbox)
  await iframe.getByRole('textbox').nth(2).fill(api.description);
  await sleep(300);

  // Select category — find dropdown with "Select a category" text
  const categoryDropdown = iframe.locator('text=Select a category').first();
  await categoryDropdown.click();
  await sleep(500);
  // Try clicking the category option by text
  const categoryOption = iframe.getByRole('option', { name: api.category });
  if (await categoryOption.count() > 0) {
    await categoryOption.click();
  } else {
    // Fallback: click text match in the dropdown list
    await iframe.locator(`text="${api.category}"`).first().click();
  }
  await sleep(300);

  // Select OpenAPI radio
  await iframe.getByRole('radio', { name: 'OpenAPI' }).click();
  await sleep(300);

  // Upload YAML file
  const fileChooserPromise = page.waitForEvent('filechooser');
  await iframe.getByRole('button', { name: 'Upload File' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(yamlPath);
  await sleep(2000);

  // Submit — find the submit button in the dialog footer (not the toolbar one)
  const submitBtns = iframe.getByRole('button', { name: /add api project/i });
  const count = await submitBtns.count();
  // Click the last one (dialog footer button)
  await submitBtns.nth(count - 1).click();
  await sleep(5000);

  console.log(`✅ API project created: ${api.name}`);
}

async function setupMonetization(page, api) {
  console.log(`\n💰 Setting up monetization for: ${api.name}`);

  const iframe = page.locator('#studio-iframe').contentFrame();

  // Helper: dismiss any open dialog
  async function dismissDialog() {
    const cancelBtn = iframe.getByRole('button', { name: /cancel/i });
    if (await cancelBtn.count() > 0) {
      try { await cancelBtn.first().click({ timeout: 2000 }); } catch {}
      await sleep(500);
    }
  }

  // Helper: fill spinbutton + save in current dialog
  async function fillAndSave(value) {
    const spinner = iframe.getByRole('spinbutton');
    if (await spinner.count() > 0) {
      await spinner.first().click({ clickCount: 3 });
      await spinner.first().fill(String(value));
      await sleep(300);
      const saveBtn = iframe.getByRole('button', { name: /save changes/i });
      if (await saveBtn.count() > 0) {
        await saveBtn.first().click();
        await sleep(2000);
        return true;
      }
    }
    return false;
  }

  // Navigate to Monetize tab
  const monetizeLink = iframe.getByRole('link', { name: /monetize/i });
  if (await monetizeLink.count() > 0) {
    await monetizeLink.first().click();
    await sleep(2000);
  }

  // Step 1: Edit BASIC plan quota (default is 500,000 — change to 50)
  console.log('  Setting BASIC plan quota to 50...');
  const basicQuotaBtn = iframe.locator('button:has-text("/month")').first();
  if (await basicQuotaBtn.count() > 0) {
    await basicQuotaBtn.click();
    await sleep(1000);
    if (await fillAndSave(50)) {
      console.log('    BASIC quota saved');
    }
  }

  // Step 2-4: Enable and configure PRO, ULTRA, MEGA
  for (const tier of PRICING.slice(1)) {
    console.log(`  Enabling ${tier.plan} ($${tier.price}/mo, ${tier.quota} req)...`);

    // Enable the plan toggle
    const checkbox = iframe.getByRole('switch', { name: new RegExp(`${tier.plan}`, 'i') });
    if (await checkbox.count() > 0) {
      await checkbox.first().click();
      await sleep(2000);
    }

    // Edit price — find Edit buttons, click the last visible one (new tier's Edit)
    try {
      const editBtns = iframe.getByRole('button', { name: /^edit$/i });
      const editCount = await editBtns.count();
      if (editCount > 0) {
        // Click last Edit button (the one for the newly enabled tier)
        await editBtns.nth(editCount - 1).click({ timeout: 5000 });
        await sleep(1000);
        if (await fillAndSave(tier.price)) {
          console.log(`    ${tier.plan} price set to $${tier.price}`);
        } else {
          await dismissDialog();
        }
      }
    } catch (e) {
      console.log(`    Price edit skipped: ${e.message.split('\n')[0]}`);
      await dismissDialog();
    }

    // Add quota for Requests — target by aria-label containing "Request"
    try {
      // Look for Add Quota buttons in the Requests row specifically
      const reqQuotaBtns = iframe.locator('button[aria-label*="Request"][aria-label*="Add quota"]');
      const fallbackBtns = iframe.locator('button[aria-label*="Add quota"]').filter({ hasNotText: /bandwidth/i });
      const quotaBtns = (await reqQuotaBtns.count() > 0) ? reqQuotaBtns : fallbackBtns;

      // Find first enabled Add Quota button
      let clicked = false;
      for (let qi = 0; qi < await quotaBtns.count(); qi++) {
        const btn = quotaBtns.nth(qi);
        const disabled = await btn.isDisabled().catch(() => true);
        if (!disabled) {
          await btn.click({ timeout: 5000 });
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        console.log(`    No enabled Add Quota button for ${tier.plan}`);
        continue;
      }
      await sleep(1500);

      // The dialog asks for Quota Type first (Unlimited/Monthly/Daily)
      // Select "Monthly" radio if present
      const monthlyRadio = iframe.getByLabel(/monthly/i);
      if (await monthlyRadio.count() > 0) {
        await monthlyRadio.first().click();
        await sleep(1000);
      }

      // Now fill the quota number and save
      if (await fillAndSave(tier.quota)) {
        console.log(`    ${tier.plan} quota set to ${tier.quota}/month`);
      } else {
        console.log(`    ${tier.plan} quota: no spinbutton found after selecting Monthly`);
        await dismissDialog();
      }
    } catch (e) {
      console.log(`    Quota add failed: ${e.message.split('\n')[0]}`);
      await dismissDialog();
    }
  }

  console.log(`✅ Monetization configured for: ${api.name}`);
}

// Navigate to a specific API's page in Studio (for monetize-only mode)
async function navigateToApiPage(page, apiName) {
  console.log(`\n🔍 Navigating to API: ${apiName}`);
  await page.goto('https://rapidapi.com/studio');
  await sleep(8000);

  const iframe = page.locator('#studio-iframe').contentFrame();
  const addBtn = iframe.getByRole('button', { name: /add.*api.*project/i });
  await addBtn.waitFor({ state: 'visible', timeout: 60000 });

  // Click the API in the project list
  const apiLink = iframe.locator(`a:has-text("${apiName}")`).first();
  await apiLink.waitFor({ state: 'visible', timeout: 10000 });
  await apiLink.click();
  await sleep(5000);
  console.log(`✅ Opened: ${apiName}`);
}

async function launchBrowser() {
  const authFile = resolve(__dirname, '.rapidapi-auth.json');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    storageState: existsSync(authFile) ? authFile : undefined,
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();
  return { browser, page };
}

// Main
const args = process.argv.slice(2);
const apiName = args.find(a => !a.startsWith('--'));
const monetizeOnly = args.includes('--monetize-only');
const createOnly = args.includes('--create-only');
const batchMonetize = args.includes('--batch-monetize');

const CONFIG_PATH = resolve(__dirname, 'rapidapi-config.json');

if (batchMonetize) {
  // Batch mode: monetize all APIs with pricing: null from config
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  const unmonetized = Object.entries(config.apis).filter(([, v]) => v.pricing === null);
  console.log(`\n💰 Batch monetizing ${unmonetized.length} APIs...\n`);

  const { browser, page } = await launchBrowser();
  let success = 0, failed = 0;

  for (const [key, entry] of unmonetized) {
    try {
      await navigateToApiPage(page, entry.name);
      await setupMonetization(page, { name: entry.name });
      success++;
    } catch (err) {
      console.error(`\n❌ Failed for ${entry.name}: ${err.message}`);
      await page.screenshot({ path: `/tmp/rapidapi-error-${key}.png` });
      console.log(`   Screenshot: /tmp/rapidapi-error-${key}.png`);
      failed++;
    }
  }

  console.log(`\n🎉 Batch done: ${success} succeeded, ${failed} failed.`);
  await browser.close();
} else {
  // Single API mode
  if (!apiName || !APIS[apiName]) {
    console.log('Available APIs:', Object.keys(APIS).join(', '));
    console.log('\nUsage:');
    console.log('  node scripts/rapidapi-create-api.mjs <api-name> [--create-only|--monetize-only]');
    console.log('  node scripts/rapidapi-create-api.mjs --batch-monetize');
    process.exit(1);
  }

  const api = APIS[apiName];
  const yamlPath = resolve(ROOT, 'rapidapi-backend', 'openapi', api.yamlFile);

  if (!monetizeOnly && !existsSync(yamlPath)) {
    console.error(`❌ YAML file not found: ${yamlPath}`);
    process.exit(1);
  }

  console.log(`🚀 RapidAPI Setup: ${api.name}`);
  console.log(`   Category: ${api.category}`);
  if (!monetizeOnly) console.log(`   YAML: ${yamlPath}`);
  console.log(`   Mode: ${monetizeOnly ? 'monetize-only' : createOnly ? 'create-only' : 'create + monetize'}`);

  const { browser, page } = await launchBrowser();

  try {
    if (!monetizeOnly) {
      await createApiProject(page, api, yamlPath);
    } else {
      await navigateToApiPage(page, api.name);
    }

    if (!createOnly) {
      await setupMonetization(page, api);
    }

    console.log('\n🎉 Done! Check https://rapidapi.com/studio to verify.');
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    await page.screenshot({ path: `/tmp/rapidapi-error-${apiName}.png` });
    console.log(`Screenshot saved to /tmp/rapidapi-error-${apiName}.png`);
  } finally {
    await sleep(3000);
    await browser.close();
  }
}
