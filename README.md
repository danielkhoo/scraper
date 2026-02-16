# SGX Company Announcements Scraper

A Puppeteer-based web scraper that extracts company announcements from the Singapore Exchange (SGX) website with automated PDF transaction data extraction.

## Features

- Scrapes company announcements from SGX (ANNC14 category)
- Extracts PDF attachments and parses transaction details using direct PDF parsing
- **SQLite Database Storage**: Persistent storage with automatic duplicate detection
- Automatically runs daily via GitHub Actions
- Extracts the following data fields:
  - **Basic Info**: Date & Time, Issuer Name, Security Name, Title
  - **Links**: Announcement link, PDF attachment link
  - **Transaction Data**:
    - Form Type (Form 1, Form 3, or Form 6)
    - Transaction Date
    - Number of Shares
    - Consideration Amount
- Preserves historical data across multiple runs
- Exports data to JSON and Markdown formats

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

### Query the Database

View all stored announcements:

```bash
node query-db.js
```

Or use SQL directly:

```bash
sqlite3 scrape.db "SELECT * FROM announcements ORDER BY dateTime DESC LIMIT 10;"
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

## Database Schema

The scraper stores data in a SQLite database (`scrape.db`) with the following schema:

| Column | Type | Description |
|--------|------|-------------|
| **link** | TEXT | Primary key - unique announcement URL |
| dateTime | TEXT | Announcement date and time |
| issuerName | TEXT | Company issuing the announcement |
| securityName | TEXT | Security name |
| title | TEXT | Announcement title |
| attachment | TEXT | PDF attachment URL |
| formType | TEXT | Form type (Form 1, Form 3, Form 6) |
| transactionDate | TEXT | Transaction date (DD-Mon-YYYY) |
| numberOfShares | TEXT | Number of shares involved |
| consideration | TEXT | Transaction consideration amount |

### Duplicate Handling

The scraper uses the `link` field as the primary key:
- **New announcements** are inserted into the database
- **Existing announcements** are updated with the latest data
- **Historical records** are preserved across runs
- Each run shows a summary of new vs. existing records

## Output

The scraper generates multiple output files:

### 1. SQLite Database (`scrape.db`)
Primary data store with all historical announcements.

### 2. JSON Export (`scrape.json`)
Contains all data from the database in JSON format:

```json
[
  {
    "link": "https://links.sgx.com/1.0.0/corporate-announcements/...",
    "dateTime": "16 Feb 2026 03:42 PM",
    "issuerName": "DBS GROUP HOLDINGS LTD",
    "securityName": "DBS GROUP HOLDINGS LTD",
    "title": "Disclosure of Interest/ Changes in Interest...",
    "attachment": "https://links.sgx.com/.../FORM1_TSS_Feb2026.pdf",
    "formType": "Form 1",
    "transactionDate": "12-Feb-2026",
    "numberOfShares": "81,099 awards of fully-paid ordinary shares...",
    "consideration": "Nil"
  }
]
```

### 3. Markdown Export (`scrape.md`)
A formatted table view of all announcements for easy reading.

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
- **PDF Parsing**: Direct extraction using `pdf-parse` library
- **Database**: SQLite with automatic schema creation
- **Results per run**: 2 announcements (configurable)
- **Headless Browser**: Chromium via Puppeteer

## Dependencies

- **puppeteer**: ^23.11.1 - Headless browser automation
- **pdf-parse**: ^1.1.1 - Direct PDF text extraction
- **sqlite3**: ^5.1.7 - SQLite database driver

## Files

- `scraper.js` - Main scraper script with SQLite integration
- `query-db.js` - Database query helper for viewing stored data
- `scrape.db` - SQLite database (created on first run)
- `scrape.json` - JSON export of all database records
- `scrape.md` - Markdown table export
- `package.json` - Node.js dependencies

## Data Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `link` | TEXT | Primary key - unique announcement URL |
| `dateTime` | TEXT | Announcement date and time |
| `issuerName` | TEXT | Company issuing the announcement |
| `securityName` | TEXT | Security name |
| `title` | TEXT | Announcement title |
| `attachment` | TEXT | Direct PDF download link |
| `formType` | TEXT | "Form 1", "Form 3", or "Form 6" |
| `transactionDate` | TEXT | Date of transaction (DD-Mon-YYYY) |
| `numberOfShares` | TEXT | Quantity acquired/disposed |
| `consideration` | TEXT | Amount paid/received or "Nil" |

## How It Works

1. The scraper navigates to the SGX announcements page
2. Extracts announcement details from the table
3. For each announcement:
   - Visits the detail page
   - Downloads the PDF attachment
   - Extracts text using `pdf-parse`
   - Parses transaction data using regex patterns
4. Checks if the announcement already exists in the database (by link)
5. Inserts new records or updates existing ones
6. Exports all data to JSON and Markdown files

## Notes

- The database preserves all historical data across runs
- The `link` field serves as the unique identifier
- The scraper waits between requests to avoid overwhelming the server
- GitHub Actions provides free unlimited minutes for public repositories
- SQLite database is portable and can be easily queried or backed up
