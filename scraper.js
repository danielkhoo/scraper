const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');

// Function to fetch PDF as markdown from Jina.ai
async function fetchPdfMarkdown(pdfUrl) {
  const jinaUrl = `https://r.jina.ai/${pdfUrl}`;
  return new Promise((resolve, reject) => {
    https.get(jinaUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Function to parse transaction data from markdown
function parseTransactionData(markdown) {
  // Initialize all fields to null
  const data = {
    formType: null,
    transactionDate: null,
    numberOfShares: null,
    securitiesType: null,
    consideration: null,
    totalBeforeShares: null,
    totalBeforePercent: null,
    totalAfterShares: null,
    totalAfterPercent: null
  };

  try {
    // Identify form type - look for "FORM 1" or "FORM 3" in the markdown
    if (markdown.match(/FORM\s*1/i)) {
      data.formType = 'Form 1';
    } else if (markdown.match(/FORM\s*3/i)) {
      data.formType = 'Form 3';
    }

    // Transaction date - look for date patterns (DD-Mon-YYYY)
    const dateMatch = markdown.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/);
    if (dateMatch) data.transactionDate = dateMatch[1];

    // Number of shares acquired/disposed
    const sharesMatch = markdown.match(/(\d+(?:,\d{3})*)\s+(?:ordinary\s+)?shares?\s+(?:acquired|disposed|vested)/i);
    if (sharesMatch) {
      data.numberOfShares = parseInt(sharesMatch[1].replace(/,/g, ''));
    }

    // Type of securities - lowercase for standardization
    const typeMatch = markdown.match(/(ordinary|voting|share awards?|units?)\s+(?:voting\s+)?(?:shares?|units?)/i);
    if (typeMatch) data.securitiesType = typeMatch[0].toLowerCase();

    // Consideration amount - improved regex to handle $ or S$ and "received by" patterns
    // Look for patterns like "$2,198,895.03", "S$653,608.97 received", or "Nil"
    const considerationPattern = /(?:consideration|received|paid)[^:]*?:\s*(?:S\$|USD\s*\$|\$)?\s*([\d,]+(?:\.\d{2})?)|Nil/i;
    const considerationMatch = markdown.match(considerationPattern);
    if (considerationMatch) {
      if (considerationMatch[0].includes('Nil')) {
        data.consideration = 'Nil';
      } else if (considerationMatch[1]) {
        data.consideration = considerationMatch[1].replace(/,/g, '');
      }
    }

    // Before transaction - look for "Immediately before" section with Total line
    // Match pattern: Total > shares/units: NUMBER > percentage: PERCENT
    const beforePattern = /Immediately before.*?Total[^>]*>.*?(?:shares|units)[^:]*:\s*(\d+(?:,\d{3})*)[^>]*>.*?percentage[^:]*:\s*(\d+(?:\.\d+)?)/is;
    const beforeMatch = markdown.match(beforePattern);
    if (beforeMatch) {
      data.totalBeforeShares = parseInt(beforeMatch[1].replace(/,/g, ''));
      data.totalBeforePercent = parseFloat(beforeMatch[2]);
    }

    // After transaction - look for "Immediately after" section with Total line
    const afterPattern = /Immediately after.*?Total[^>]*>.*?(?:shares|units)[^:]*:\s*(\d+(?:,\d{3})*)[^>]*>.*?percentage[^:]*:\s*(\d+(?:\.\d+)?)/is;
    const afterMatch = markdown.match(afterPattern);
    if (afterMatch) {
      data.totalAfterShares = parseInt(afterMatch[1].replace(/,/g, ''));
      data.totalAfterPercent = parseFloat(afterMatch[2]);
    }

  } catch (error) {
    console.log(`    Warning: Error parsing some fields: ${error.message}`);
  }

  // Standardize null percentage values to 0
  if (data.totalBeforePercent === null) data.totalBeforePercent = 0;
  if (data.totalAfterPercent === null) data.totalAfterPercent = 0;

  return data;
}

async function scrapeSGXAnnouncements(options = {}) {
  // Configuration variables
  const pageNumber = options.page || 1;
  const pageSize = options.pageSize || 5;
  const baseUrl = 'https://www.sgx.com/securities/company-announcements';
  const fullUrl = `${baseUrl}?ANNC=ANNC14&page=${pageNumber}&pagesize=${pageSize}`;

  console.log('Starting SGX scraper...');
  console.log(`Page: ${pageNumber}, Page Size: ${pageSize}`);

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

            // Fetch and parse PDF markdown
            try {
              console.log(`    Fetching PDF markdown...`);
              const markdown = await fetchPdfMarkdown(attachment);
              const transactionData = parseTransactionData(markdown);

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
    }

    // Save to JSON file
    fs.writeFileSync('scrape.json', JSON.stringify(data, null, 2));
    console.log('Data saved to scrape.json');

    // Generate markdown table
    const mdHeader = '# SGX Announcements - Transaction Summary\n\n';
    const mdTableHeader = '| Transaction Date | Security Name | Number of Shares | Consideration | Link |\n';
    const mdTableSeparator = '|-----------------|---------------|------------------|---------------|------|\n';

    const mdRows = data.map(row => {
      const transactionDate = row.transactionDate || 'N/A';
      const securityName = row.securityName || 'N/A';
      const numberOfShares = row.numberOfShares ? row.numberOfShares.toLocaleString() : 'N/A';
      const consideration = row.consideration === 'Nil' ? 'Nil' :
        row.consideration ? parseFloat(row.consideration).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A';
      const link = row.link ? `[View](${row.link})` : 'N/A';

      return `| ${transactionDate} | ${securityName} | ${numberOfShares} | ${consideration} | ${link} |`;
    }).join('\n');

    const markdown = mdHeader + mdTableHeader + mdTableSeparator + mdRows + '\n';
    fs.writeFileSync('scrape.md', markdown);
    console.log('Data saved to scrape.md');

  } catch (error) {
    console.error('Error during scraping:', error);
    throw error;
  } finally {
    await browser.close();
    console.log('Browser closed');
  }
}

// Run the scraper with configuration
scrapeSGXAnnouncements({
  page: 1,
  pageSize: 20  // Daily scraping - captures recent announcements
})
  .then(() => console.log('Scraping completed successfully!'))
  .catch(error => {
    console.error('Scraping failed:', error);
    process.exit(1);
  });
