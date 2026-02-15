const puppeteer = require('puppeteer');
const fs = require('fs');
const http = require('http');
const https = require('https');
const pdfParse = require('pdf-parse');

// Function to download PDF and extract text using pdf-parse
async function fetchPdfText(pdfUrl) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(pdfUrl);
    const client = parsedUrl.protocol === 'http:' ? http : https;
    client.get(pdfUrl, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, pdfUrl).href;
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

// Function to parse transaction data from raw PDF text
function parseTransactionData(text) {
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
    // Identify form type - look for "FORM 1", "FORM 3", or "FORM 6"
    if (text.match(/FORM\s*1/i)) {
      data.formType = 'Form 1';
    } else if (text.match(/FORM\s*3/i)) {
      data.formType = 'Form 3';
    } else if (text.match(/FORM\s*6/i)) {
      data.formType = 'Form 6';
    }

    // Transaction date - look for date patterns (DD-Mon-YYYY or DD Mon YYYY)
    const dateMatch = text.match(/(\d{1,2}[-\s][A-Za-z]{3,9}[-\s]\d{4})/);
    if (dateMatch) {
      // Normalize to DD-Mon-YYYY format
      const normalized = dateMatch[1].replace(/\s+/g, '-');
      // Abbreviate month if full name
      const parts = normalized.split('-');
      if (parts[1] && parts[1].length > 3) {
        parts[1] = parts[1].substring(0, 3);
      }
      data.transactionDate = parts.join('-');
    }

    // Number of shares - multiple patterns for raw PDF text
    // Pattern 1: "No. of shares/units" followed by a number (common in table rows)
    // Pattern 2: NUMBER shares acquired/disposed
    // Pattern 3: Look for numbers near "acquired", "disposed", "vested"
    const sharesPatterns = [
      /(?:No\.?\s*of\s+(?:ordinary\s+)?(?:shares|units))\s*[:\-]?\s*(\d+(?:[,\s]\d{3})*)/i,
      /(\d+(?:[,\s]\d{3})*)\s+(?:ordinary\s+)?(?:shares?|units?)\s+(?:acquired|disposed|vested|bought|sold)/i,
      /(?:acquired|disposed|vested|bought|sold)\s+(\d+(?:[,\s]\d{3})*)\s+(?:ordinary\s+)?(?:shares?|units?)/i,
      /(?:Number|No\.?)\s+of\s+(?:securities|shares|units)\s+(?:acquired|disposed|changed)[\s\S]{0,100}?(\d+(?:[,\s]\d{3})*)/i,
    ];
    for (const pattern of sharesPatterns) {
      const match = text.match(pattern);
      if (match) {
        const num = parseInt(match[1].replace(/[,\s]/g, ''));
        if (num > 0) {
          data.numberOfShares = num;
          break;
        }
      }
    }

    // Type of securities - lowercase for standardization
    const typeMatch = text.match(/(ordinary\s+)?(?:voting\s+)?(?:shares?|units?)/i);
    if (typeMatch) data.securitiesType = typeMatch[0].toLowerCase().trim();

    // Consideration amount
    // Look for patterns like "$2,198,895.03", "S$653,608.97", or "Nil"
    const considerationPatterns = [
      /(?:consideration|amount)[^]*?(?:S\$|USD\s*\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/i,
      /(?:consideration|amount)[^]*?:\s*([\d,]+(?:\.\d{1,2})?)/i,
      /(?:S\$|USD\s*\$|\$)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:received|paid)/i,
    ];
    const nilMatch = text.match(/consideration[^]*?nil/i);
    if (nilMatch) {
      data.consideration = 'Nil';
    } else {
      for (const pattern of considerationPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          data.consideration = match[1].replace(/,/g, '');
          break;
        }
      }
    }

    // Before transaction - look for "Immediately before" section
    const beforeSection = text.match(/[Ii]mmediately\s+before[\s\S]*?(?=[Ii]mmediately\s+after|$)/);
    if (beforeSection) {
      const beforeText = beforeSection[0];
      // Look for total shares/units number
      const beforeSharesMatch = beforeText.match(/[Tt]otal[\s\S]{0,200}?(\d+(?:[,\s]\d{3})*)\s/);
      const beforePercentMatch = beforeText.match(/(\d+(?:\.\d+)?)\s*%/);
      if (beforeSharesMatch) {
        data.totalBeforeShares = parseInt(beforeSharesMatch[1].replace(/[,\s]/g, ''));
      }
      if (beforePercentMatch) {
        data.totalBeforePercent = parseFloat(beforePercentMatch[1]);
      }
    }

    // After transaction - look for "Immediately after" section
    const afterSection = text.match(/[Ii]mmediately\s+after[\s\S]*/);
    if (afterSection) {
      const afterText = afterSection[0];
      const afterSharesMatch = afterText.match(/[Tt]otal[\s\S]{0,200}?(\d+(?:[,\s]\d{3})*)\s/);
      const afterPercentMatch = afterText.match(/(\d+(?:\.\d+)?)\s*%/);
      if (afterSharesMatch) {
        data.totalAfterShares = parseInt(afterSharesMatch[1].replace(/[,\s]/g, ''));
      }
      if (afterPercentMatch) {
        data.totalAfterPercent = parseFloat(afterPercentMatch[1]);
      }
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
            console.log(`    URL: ${attachment}`);

            // Validate URL before fetching
            let pdfUrl;
            try {
              pdfUrl = new URL(attachment);
            } catch {
              // If relative URL, resolve against SGX base
              try {
                pdfUrl = new URL(attachment, 'https://links.sgx.com');
              } catch {
                console.log(`  ✗ Invalid attachment URL: ${attachment}`);
                continue;
              }
            }

            // Fetch and parse PDF text
            try {
              console.log(`    Fetching PDF text...`);
              const pdfText = await fetchPdfText(pdfUrl.href);
              const transactionData = parseTransactionData(pdfText);

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
    const mdTableHeader = '| Transaction Date | Security Name | Number of Shares | Consideration | Attachment |\n';
    const mdTableSeparator = '|-----------------|---------------|------------------|---------------|------------|\n';

    const mdRows = data.map(row => {
      const transactionDate = row.transactionDate || 'N/A';
      const securityName = row.securityName || 'N/A';
      const numberOfShares = row.numberOfShares ? row.numberOfShares.toLocaleString() : 'N/A';
      const consideration = row.consideration === 'Nil' ? 'Nil' :
        row.consideration ? parseFloat(row.consideration).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A';
      const attachment = row.attachment ? `[PDF](${row.attachment})` : 'N/A';

      return `| ${transactionDate} | ${securityName} | ${numberOfShares} | ${consideration} | ${attachment} |`;
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
