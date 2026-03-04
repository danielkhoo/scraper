const sqlite3 = require('sqlite3').verbose();

// Open the database
const db = new sqlite3.Database('scrape.db', sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// Parse "DD-Mon-YYYY" transaction date strings into Date objects for sorting
function parseTransactionDate(dateStr) {
  if (!dateStr) return new Date(0);
  const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  const [day, mon, year] = dateStr.split('-');
  const m = months[mon];
  if (!day || m === undefined || !year) return new Date(0);
  return new Date(parseInt(year), m, parseInt(day));
}

// Query all announcements
db.all('SELECT * FROM announcements', [], (err, rows) => {
  if (err) {
    console.error('Error querying database:', err.message);
    process.exit(1);
  }

  rows.sort((a, b) => {
    const dateDiff = parseTransactionDate(b.transactionDate) - parseTransactionDate(a.transactionDate);
    if (dateDiff !== 0) return dateDiff;
    return (b.dateTime || '').localeCompare(a.dateTime || '');
  });

  console.log(`\nTotal records: ${rows.length}\n`);

  rows.forEach((row, index) => {
    console.log(`Record ${index + 1}:`);
    console.log(`  Date/Time: ${row.dateTime}`);
    console.log(`  Security: ${row.securityName}`);
    console.log(`  Transaction Date: ${row.transactionDate || 'N/A'}`);
    console.log(`  Shares: ${row.numberOfShares || 'N/A'}`);
    console.log(`  Consideration: ${row.consideration || 'N/A'}`);
    console.log(`  Form Type: ${row.formType || 'N/A'}`);
    console.log(`  Link: ${row.link}`);
    console.log('');
  });

  db.close();
});
