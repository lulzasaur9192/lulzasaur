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
  'nurse-license': { name: 'Nurse License Verification', description: 'Verify nurse licenses', category: 'Data', yamlFile: 'nurse-license.yaml' },
  'contractor-license': { name: 'Contractor License Verification', description: 'Verify contractor licenses', category: 'Data', yamlFile: 'contractor-license.yaml' },
  'fcc-id': { name: 'FCC ID Certification Lookup', description: 'Look up FCC equipment authorization data by FCC ID, grantee code, or applicant name. Get detailed grant info and frequencies.', category: 'Data', yamlFile: 'fcc-id.yaml' },
  'agent-memory': { name: 'Agent Memory Persistence API', description: 'Persistent memory for AI agents — FTS5 search, batch ops, namespace isolation, TTL expiry, access tracking. Inspectable state agents can trust.', category: 'Data', yamlFile: 'agent-memory.yaml' },
  'agent-drift': { name: 'Agent Drift Detection API', description: 'Monitor AI agent outputs for silent degradation. Golden test cases, 4 match modes, cron scheduling, webhook alerts, drift dashboard.', category: 'Data', yamlFile: 'agent-drift.yaml' },
  'skillguard-premium': { name: 'Skillguard Premium API', description: 'AI agent skill safety verification. Classify skills as SAFE/CAUTION/DANGER before installation. Audit trails, batch verification, confidence scores.', category: 'Data', yamlFile: 'skillguard.yaml' },
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

  // Navigate to Monetize tab — look for Hub Listing > Monetize
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

    const spinner = iframe.getByRole('spinbutton');
    await spinner.click({ clickCount: 3 });
    await spinner.fill('50');
    await sleep(300);

    const saveBtn = iframe.getByRole('button', { name: /save changes/i });
    await saveBtn.click();
    await sleep(1500);
  }

  // Step 2-4: Enable and configure PRO, ULTRA, MEGA
  for (const tier of PRICING.slice(1)) {
    console.log(`  Enabling ${tier.plan} ($${tier.price}/mo, ${tier.quota} req)...`);

    // Enable the plan
    const checkbox = iframe.getByRole('switch', { name: new RegExp(`${tier.plan}`, 'i') });
    if (await checkbox.count() > 0) {
      await checkbox.click();
      await sleep(1000);
    }

    // Edit price
    const editBtns = iframe.getByRole('button', { name: /edit/i });
    // Find the Edit button in this plan's column
    for (let i = 0; i < await editBtns.count(); i++) {
      const btn = editBtns.nth(i);
      const text = await btn.textContent();
      if (text?.toLowerCase().includes('edit')) {
        await btn.click();
        await sleep(1000);

        const priceInput = iframe.getByRole('spinbutton');
        if (await priceInput.count() > 0) {
          await priceInput.click({ clickCount: 3 });
          await priceInput.fill(tier.price.toString());
          await sleep(300);

          const saveBtn = iframe.getByRole('button', { name: /save changes/i });
          if (await saveBtn.count() > 0) {
            await saveBtn.click();
            await sleep(1500);
          }
        }
        break;
      }
    }

    // Add quota
    const addQuotaBtn = iframe.getByRole('button', { name: /add quota/i });
    if (await addQuotaBtn.count() > 0) {
      await addQuotaBtn.last().click();
      await sleep(1000);

      const quotaSpinner = iframe.getByRole('spinbutton');
      if (await quotaSpinner.count() > 0) {
        await quotaSpinner.click({ clickCount: 3 });
        await quotaSpinner.fill(tier.quota.toString());
        await sleep(300);

        const saveBtn = iframe.getByRole('button', { name: /save changes/i });
        if (await saveBtn.count() > 0) {
          await saveBtn.click();
          await sleep(1500);
        }
      }
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
