# License Verify API

JavaScript client for the [Healthcare License Verification API](https://rapidapi.com/lulzasaur9192/api/healthcare-license?utm_source=npm&utm_medium=readme&utm_campaign=license-verify-api) on RapidAPI.

Verify professional licenses across all 50 US states + DC. Supports 22 healthcare professions including nurses, doctors, dentists, pharmacists, therapists, and more.

## Install

```bash
npm install license-verify-api
```

## Quick Start

```javascript
const LicenseVerifyClient = require('license-verify-api');

const client = new LicenseVerifyClient('YOUR_RAPIDAPI_KEY');

// Verify a nurse's license in California
const result = await client.verify({
  state: 'CA',
  lastName: 'Johnson',
  licenseType: 'RN',
});
console.log(result);

// Direct NPI lookup
const provider = await client.lookupNPI('1234567890');

// Search by name
const providers = await client.searchByName('Smith', 'TX', {
  licenseType: 'MD',
  limit: 10,
});
```

## API Methods

### `verify(options)`
Search and verify healthcare professional licenses.

| Parameter | Type | Description |
|-----------|------|-------------|
| state | string | US state code (e.g. "CA", "FL") |
| lastName | string | Provider last name (required unless using npiNumber) |
| firstName | string | Provider first name (optional) |
| licenseType | string | License type filter (see supported types below) |
| npiNumber | string | NPI number (alternative to name search) |
| limit | number | Max results (default: 50) |

### `lookupNPI(npi)`
Direct lookup by 10-digit NPI number. Returns full provider details including taxonomies and practice locations.

### `searchByName(lastName, state, options?)`
Convenience method for name-based provider search.

## Supported License Types

MD, DO, RN, LPN, NP, APRN, CNA, PT, PTA, OT, OTA, SLP, CF, PSYCH, RPH, PHARMD, DDS, DMD, PA, DC, OD, DPM

## Use Cases

- **Staffing Agencies**: Verify nurse credentials before placement
- **Background Checks**: Confirm professional license status
- **HR Compliance**: Validate healthcare worker licenses at scale
- **Credentialing**: Automate provider credentialing workflows
- **Telemedicine**: Verify cross-state licensing for remote providers

## Get Your API Key

1. Go to [Healthcare License API on RapidAPI](https://rapidapi.com/lulzasaur9192/api/healthcare-license?utm_source=npm&utm_medium=readme&utm_campaign=license-verify-api)
2. Subscribe (free tier: 200 requests/month)
3. Copy your API key from the dashboard

## License

MIT
