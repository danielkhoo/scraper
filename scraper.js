const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');
const pdfParse = require('pdf-parse');
const sqlite3 = require('sqlite3').verbose();

// Function to download PDF and extract text using pdf-parse
async function fetchPdfText(pdfUrl) {
  return new Promise((resolve, reject) => {
    // Parse the URL properly
    const urlObject = new URL(pdfUrl);

    const options = {
      hostname: urlObject.hostname,
      path: urlObject.pathname + urlObject.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      }
    };

    https.get(options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${urlObject.protocol}//${urlObject.hostname}${res.headers.location}`;
        return fetchPdfText(redirectUrl).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const data = await pdfParse(buffer);
          resolve(data.text);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

// Field mapping configuration
// Maps output field names to their question patterns in the PDF
const FIELD_MAPPINGS = {
  transactionDate: {
    pattern: /Date\s+of\s+acquisition\s+of\s+or\s+change\s+in\s+interest:.*?\n\s*(\d{1,2}[-\s\/][A-Za-z]{3,9}[-\s\/]\d{4})/is,
    transform: (match) => {
      // Normalize to DD-Mon-YYYY format
      const normalized = match.replace(/[\s\/]+/g, '-');
      const parts = normalized.split('-');
      // Abbreviate month if full name
      if (parts[1] && parts[1].length > 3) {
        parts[1] = parts[1].substring(0, 3);
      }
      return parts.join('-');
    }
  },
  numberOfShares: {
    // Pattern matches both Form 1 and Form 3 formats
    // Form 1: "5. Number of shares...:\n81,099 awards..."
    // Form 3: "Number of shares...:\n6.\n685,100"
    pattern: /Number\s+of\s+shares[^:]*:\s*\n\s*(?:\d+\.\s*\n\s*)?([^\n]+)/is,
    transform: (match) => match.trim()
  },
  consideration: {
    pattern: /Amount\s+of\s+consideration[^:]*:.*?\n\s*([^\n]+)/is,
    transform: (match) => match.trim()
  }
};

// Entity extraction patterns - different for each form type
const ENTITY_PATTERNS = {
  // Form 1: Name appears after "Name of Director/CEO:" then question number, then name
  form1: /Name\s+of\s+Director\/CEO:.*?\n\s*([^\n]+)/is,
  // Form 3: Has two possible layouts:
  // Layout A: Entity name BEFORE label - "Entity Name\nName of Substantial Shareholder/Unitholder:1."
  // Can be company name (with Ltd, Inc, etc) or individual name (capitalized words)
  // Layout B: Entity name AFTER label - "Name of Substantial Shareholder/Unitholder:1.\nEntity Name"
  form3Before: /FORM\s*3.*?\n([A-Z][^\n]{2,80})\s*\n\s*Name\s+of\s+Substantial\s+Shareholder\/Unitholder:\s*1\./is,
  form3After: /Name\s+of\s+Substantial\s+Shareholder\/Unitholder:\s*1\.\s*\n\s*([A-Z][^\n]+?)(?=\n\s*2\.)/is
};

// Function to parse transaction data from raw PDF text
function parseTransactionData(text) {
  // Initialize all fields to null
  const data = {
    formType: null,
    entity: null,
    transactionDate: null,
    numberOfShares: null,
    consideration: null
  };

  try {
    // Identify form type - look for "FORM 1", "FORM 3", or "FORM 6"
    if (text.match(/FORM\s*1/i)) {
      data.formType = 'Form 1';
    } else if (text.match(/FORM\s*3/i)) {
      data.formType = 'Form 3';
    } else if (text.match(/FORM\s*6/i)) {
      data.formType = 'Form 6';
    }

    // Extract entity based on form type
    if (data.formType === 'Form 1') {
      const match = text.match(ENTITY_PATTERNS.form1);
      if (match && match[1]) {
        data.entity = match[1].trim();
      }
    } else if (data.formType === 'Form 3') {
      // Form 3 can have multiple shareholders - extract all and join with "/"
      const entities = [];

      // Try "after" pattern first (can match multiple)
      const afterMatches = [...text.matchAll(/Name\s+of\s+Substantial\s+Shareholder\/Unitholder:\s*1\.\s*\n\s*([A-Z][^\n]+?)(?=\n\s*2\.)/gis)];
      if (afterMatches.length > 0) {
        afterMatches.forEach(match => {
          if (match[1]) {
            entities.push(match[1].trim());
          }
        });
      }

      // If no matches from "after" pattern, try "before" pattern
      if (entities.length === 0) {
        const beforeMatches = [...text.matchAll(/FORM\s*3.*?\n([A-Z][^\n]{2,80})\s*\n\s*Name\s+of\s+Substantial\s+Shareholder\/Unitholder:\s*1\./gis)];
        if (beforeMatches.length > 0) {
          beforeMatches.forEach(match => {
            if (match[1]) {
              entities.push(match[1].trim());
            }
          });
        }
      }

      // Deduplicate and join all entities with " / "
      if (entities.length > 0) {
        const uniqueEntities = [...new Set(entities)];
        data.entity = uniqueEntities.join(' / ');
      }
    }

    // Extract fields using the mapping configuration
    for (const [fieldName, config] of Object.entries(FIELD_MAPPINGS)) {
      const match = text.match(config.pattern);
      if (match && match[1]) {
        data[fieldName] = config.transform(match[1]);
      }
    }

  } catch (error) {
    console.log(`    Warning: Error parsing some fields: ${error.message}`);
  }

  return data;
}

// Initialize SQLite database
function initDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database('scrape.db', (err) => {
      if (err) {
        reject(err);
        return;
      }

      // Create table if it doesn't exist
      db.run(`
        CREATE TABLE IF NOT EXISTS announcements (
          link TEXT PRIMARY KEY,
          dateTime TEXT,
          issuerName TEXT,
          securityName TEXT,
          title TEXT,
          attachment TEXT,
          formType TEXT,
          entity TEXT,
          transactionDate TEXT,
          numberOfShares TEXT,
          consideration TEXT
        )
      `, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(db);
      });
    });
  });
}

// Insert or update announcement in database
// Returns true if new record was inserted, false if record already existed
function saveAnnouncement(db, announcement) {
  return new Promise((resolve, reject) => {
    // First check if the record already exists
    db.get('SELECT link FROM announcements WHERE link = ?', [announcement.link], (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      const isNew = !row;

      // Insert or replace the record
      db.run(`
        INSERT OR REPLACE INTO announcements
        (link, dateTime, issuerName, securityName, title, attachment, formType, entity, transactionDate, numberOfShares, consideration)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        announcement.link,
        announcement.dateTime,
        announcement.issuerName,
        announcement.securityName,
        announcement.title,
        announcement.attachment || null,
        announcement.formType || null,
        announcement.entity || null,
        announcement.transactionDate || null,
        announcement.numberOfShares || null,
        announcement.consideration || null
      ], function (err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(isNew);
      });
    });
  });
}

// Get all announcements from database
function getAllAnnouncements(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM announcements ORDER BY dateTime DESC', [], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function scrapeSGXAnnouncements(options = {}) {
  // Configuration variables
  const pageNumber = options.page || 1;
  const pageSize = options.pageSize || 5;
  const baseUrl = 'https://www.sgx.com/securities/company-announcements';
  const fullUrl = `${baseUrl}?ANNC=ANNC14&page=${pageNumber}&pagesize=${pageSize}`;

  console.log('Starting SGX scraper...');
  console.log(`Page: ${pageNumber}, Page Size: ${pageSize}`);

  // Initialize database
  const db = await initDatabase();
  console.log('Database initialized');

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  try {
    const page = await browser.newPage();

    // Set viewport and user agent to appear more like a real browser
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    console.log('Navigating to SGX announcements page...');
    console.log(`URL: ${fullUrl}`);
    await page.goto(fullUrl, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    // Wait a bit for dynamic content
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('Waiting for table to load...');
    try {
      await page.waitForSelector('.widget-filter-listing-content-table', {
        timeout: 45000
      });
    } catch (error) {
      // Take a screenshot for debugging
      await page.screenshot({ path: 'debug.png' });
      console.log('Screenshot saved to debug.png');
      throw error;
    }

    console.log('Extracting table data...');
    const data = await page.evaluate(() => {
      const table = document.querySelector('.widget-filter-listing-content-table');
      const rows = table.querySelectorAll('tbody tr');

      return Array.from(rows).map(row => {
        const cells = Array.from(row.querySelectorAll('td'));

        const rowData = {
          dateTime: cells[0]?.textContent.trim() || '',
          issuerName: cells[1]?.textContent.trim() || '',
          securityName: cells[2]?.textContent.trim() || '',
          title: cells[3]?.textContent.trim() || ''
        };

        // Check for links.sgx.com in the title column
        const titleLink = cells[3]?.querySelector('a');
        if (titleLink && titleLink.href.includes('links.sgx.com')) {
          rowData.link = titleLink.href;
        }

        return rowData;
      });
    });

    console.log(`Extracted ${data.length} rows`);

    // Navigate to each announcement link and extract the attachment
    console.log(`Fetching attachments for ${data.length} announcements...`);
    let newRecords = 0;
    let existingRecords = 0;

    for (let i = 0; i < data.length; i++) {
      if (data[i].link) {
        try {
          console.log(`Processing announcement ${i + 1}/${data.length}: ${data[i].title.substring(0, 50)}...`);
          await page.goto(data[i].link, { waitUntil: 'networkidle0', timeout: 60000 });
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Extract the second announcement-attachment link
          const attachment = await page.evaluate(() => {
            const attachmentLinks = document.querySelectorAll('.announcement-attachment');
            if (attachmentLinks.length >= 2) {
              return attachmentLinks[1].href;
            }
            return null;
          });

          if (attachment) {
            data[i].attachment = attachment;
            console.log(`  ✓ Found attachment`);

            // Fetch and parse PDF text
            try {
              console.log(`    Fetching PDF text...`);
              const pdfText = await fetchPdfText(attachment);
              const transactionData = parseTransactionData(pdfText);

              // Debug Form 3 entity extraction
              if (transactionData.formType === 'Form 3' && i < 3) {
                const shareholderIndex = pdfText.indexOf('Name of Substantial Shareholder');
                if (shareholderIndex >= 0) {
                  console.log(`\n--- Form 3 Entity Debug for: ${data[i].title.substring(0, 50)} ---`);
                  console.log(pdfText.substring(shareholderIndex - 200, shareholderIndex + 100));
                  console.log(`Extracted entity: "${transactionData.entity}"`);
                  console.log('--- End Debug ---\n');
                }
              }

              // Add transaction fields to row
              Object.assign(data[i], transactionData);
              console.log(`  ✓ Parsed transaction data`);
            } catch (error) {
              console.log(`  ✗ Error parsing PDF: ${error.message}`);
            }
          } else {
            console.log(`  ✗ No attachment found`);
          }
        } catch (error) {
          console.log(`  ✗ Error fetching attachment: ${error.message}`);
        }
      }

      // Save each announcement to database
      try {
        const isNew = await saveAnnouncement(db, data[i]);
        if (isNew) {
          newRecords++;
          console.log(`  ✓ Saved to database (new record)`);
        } else {
          existingRecords++;
          console.log(`  ✓ Already in database (updated)`);
        }
      } catch (error) {
        console.log(`  ✗ Error saving to database: ${error.message}`);
      }
    }

    console.log(`\nDatabase summary: ${newRecords} new records, ${existingRecords} existing records`);

    // Get all announcements from database and save to JSON for compatibility
    const allAnnouncements = await getAllAnnouncements(db);
    fs.writeFileSync('scrape.json', JSON.stringify(allAnnouncements, null, 2));
    console.log('Data exported to scrape.json');

    // Generate markdown table from all database records
    const mdHeader = '# SGX Announcements - Transaction Summary\n\n';
    const mdTableHeader = '| Transaction Date | Entity | Security Name | Number of Shares | Consideration | Attachment |\n';
    const mdTableSeparator = '|-----------------|--------|---------------|------------------|---------------|------------|\n';

    const mdRows = allAnnouncements.map(row => {
      const transactionDate = row.transactionDate || 'N/A';
      const entity = row.entity || 'N/A';
      const securityName = row.securityName || 'N/A';
      const numberOfShares = row.numberOfShares || 'N/A';
      const consideration = row.consideration || 'N/A';
      const attachment = row.attachment ? `[PDF](${row.attachment})` : 'N/A';

      return `| ${transactionDate} | ${entity} | ${securityName} | ${numberOfShares} | ${consideration} | ${attachment} |`;
    }).join('\n');

    const markdown = mdHeader + mdTableHeader + mdTableSeparator + mdRows + '\n';
    fs.writeFileSync('scrape.md', markdown);
    console.log('Data exported to scrape.md');

  } catch (error) {
    console.error('Error during scraping:', error);
    throw error;
  } finally {
    // Close database connection
    if (db) {
      await new Promise((resolve, reject) => {
        db.close((err) => {
          if (err) reject(err);
          else {
            console.log('Database closed');
            resolve();
          }
        });
      });
    }
    await browser.close();
    console.log('Browser closed');
  }
}

// Run the scraper with configuration
scrapeSGXAnnouncements({
  page: 1,
  pageSize: 20  // Daily scraping - captures recent announcements
})
  .then(() => {
    console.log('Scraping completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Scraping failed:', error);
    process.exit(1);
  });
