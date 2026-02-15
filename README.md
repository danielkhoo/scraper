# SGX Company Announcements Scraper

A Puppeteer-based web scraper that extracts company announcements from the Singapore Exchange (SGX) website with automated PDF transaction data extraction.

## Features

- Scrapes company announcements from SGX (ANNC14 category)
- Extracts PDF attachments and parses transaction details using Jina.ai
- Automatically runs daily via GitHub Actions
- Extracts the following data fields:
  - **Basic Info**: Date & Time, Issuer Name, Security Name, Title
  - **Links**: Announcement link, PDF attachment link
  - **Transaction Data**:
    - Form Type (Form 1 or Form 3)
    - Transaction Date
    - Number of Shares
    - Securities Type
    - Consideration Amount
    - Total Before/After Shares and Percentages
- Saves data to JSON format with version control

## Installation

```bash
npm install
```

## Usage

### Local Usage

Run the scraper manually:

```bash
node scraper.js
```

Or use the npm script:

```bash
npm start
```

### Automated Daily Scraping

This scraper runs automatically every day at **8:00 AM UTC (4:00 PM Singapore Time)** via GitHub Actions.

- Automatically commits updated data to the repository
- Tracks changes over time using git history
- Can be triggered manually from the GitHub Actions tab

## Configuration

The scraper can be configured in `scraper.js`:

```javascript
scrapeSGXAnnouncements({
  page: 1,        // Page number to scrape
  pageSize: 5     // Number of announcements to fetch
})
```

## Output

The scraper generates a `scrape.json` file with detailed announcement and transaction data:

```json
[
  {
    "dateTime": "13 Feb 2026 07:52 PM",
    "issuerName": "HIAP SENG INDUSTRIES LIMITED",
    "securityName": "HIAP SENG INDUSTRIES LIMITED",
    "title": "Disclosure of Interest/ Changes in Interest...",
    "link": "https://links.sgx.com/1.0.0/corporate-announcements/...",
    "attachment": "https://links.sgx.com/.../875183__eFORM3V2.pdf",
    "formType": "Form 3",
    "transactionDate": "13-Feb-2026",
    "numberOfShares": 368324125,
    "securitiesType": "voting shares",
    "consideration": "2198895.03",
    "totalBeforeShares": 2304725,
    "totalBeforePercent": 0.05,
    "totalAfterShares": 370628850,
    "totalAfterPercent": 7.65
  }
]
```

## GitHub Actions Setup

### Enable Write Permissions

For the automated scraper to commit changes, you need to enable write permissions:

1. Go to repository **Settings**
2. Navigate to **Actions** > **General**
3. Under **"Workflow permissions"**:
   - Select **"Read and write permissions"**
   - Check **"Allow GitHub Actions to create and approve pull requests"**
4. Click **Save**

### Manual Trigger

You can manually trigger the scraper:

1. Go to the **Actions** tab in your repository
2. Select **"Daily SGX Scraper"** workflow
3. Click **"Run workflow"** button
4. Select branch and click **"Run workflow"**

### Schedule

The workflow runs on this schedule:
- **Cron**: `0 8 * * *`
- **Time**: 8:00 AM UTC / 4:00 PM Singapore Time
- **Frequency**: Daily

## Technical Details

- **Target URL**: https://www.sgx.com/securities/company-announcements?ANNC=ANNC14
- **Table Selector**: `.widget-filter-listing-content-table`
- **PDF Conversion**: Uses Jina.ai (https://r.jina.ai/) to convert PDFs to markdown
- **Results per run**: 5 announcements (configurable)
- **Headless Browser**: Chromium via Puppeteer

## Dependencies

- **puppeteer**: ^23.11.1 - Headless browser automation
- **https**: Built-in Node.js module for fetching PDF markdown

## Data Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `dateTime` | string | Announcement date and time |
| `issuerName` | string | Company issuing the announcement |
| `securityName` | string | Security name |
| `title` | string | Announcement title |
| `link` | string | URL to announcement detail page |
| `attachment` | string | Direct PDF download link |
| `formType` | string | "Form 1" or "Form 3" |
| `transactionDate` | string | Date of transaction (DD-Mon-YYYY) |
| `numberOfShares` | number/null | Quantity acquired/disposed |
| `securitiesType` | string/null | Type of securities (lowercase) |
| `consideration` | string/null | Amount paid/received or "Nil" |
| `totalBeforeShares` | number/null | Holdings before transaction |
| `totalBeforePercent` | number | Percentage before (0 if null) |
| `totalAfterShares` | number/null | Holdings after transaction |
| `totalAfterPercent` | number | Percentage after (0 if null) |

## Notes

- All percentage fields default to 0 if data is unavailable
- Securities types are normalized to lowercase
- The scraper respectfully waits between requests to avoid overwhelming the server
- GitHub Actions provides free unlimited minutes for public repositories
