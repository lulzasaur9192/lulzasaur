# License Verifier

Python client for the [Healthcare License Verification API](https://rapidapi.com/lulzasaur9192/api/healthcare-license?utm_source=pypi&utm_medium=readme&utm_campaign=license-verifier) on RapidAPI.

Verify professional licenses across all 50 US states + DC. Supports 22 healthcare professions.

## Install

```bash
pip install license-verifier
```

## Quick Start

```python
from license_verifier import LicenseVerifier

verifier = LicenseVerifier(api_key="YOUR_RAPIDAPI_KEY")

# Verify a nurse's license
result = verifier.verify(state="CA", last_name="Johnson", license_type="RN")

# Direct NPI lookup
provider = verifier.lookup_npi("1234567890")

# Search by name
providers = verifier.search_by_name("Smith", "TX", license_type="MD", limit=10)
```

## Supported License Types

MD, DO, RN, LPN, NP, APRN, CNA, PT, PTA, OT, OTA, SLP, CF, PSYCH, RPH, PHARMD, DDS, DMD, PA, DC, OD, DPM

## Use Cases

- **Staffing Agencies**: Verify nurse credentials before placement
- **Background Checks**: Confirm professional license status
- **HR Compliance**: Validate healthcare worker licenses at scale
- **Credentialing**: Automate provider credentialing workflows

## Get Your API Key

1. Go to [Healthcare License API on RapidAPI](https://rapidapi.com/lulzasaur9192/api/healthcare-license?utm_source=pypi&utm_medium=readme&utm_campaign=license-verifier)
2. Subscribe (free tier: 200 requests/month)
3. Copy your API key

## License

MIT
