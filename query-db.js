const sqlite3 = require('sqlite3').verbose();

// Open the database
const db = new sqlite3.Database('scrape.db', sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// Query all announcements
db.all('SELECT * FROM announcements ORDER BY dateTime DESC', [], (err, rows) => {
  if (err) {
    console.error('Error querying database:', err.message);
    process.exit(1);
  }

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
