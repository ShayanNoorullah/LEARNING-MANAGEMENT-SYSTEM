// Stage 2 safe-write scenarios through the real server code, on the in-memory database stand-in
// (no PostgreSQL needed). The same scenarios run on local PostgreSQL in tests/db.test.js. Run: npm test
const { fakeBackend } = require('./support/fake-db.js');
require('./support/scenarios.js').run(fakeBackend())
  .then(steps => { console.log(`safewrite.test.js: ${steps.length} scenarios passed (in-memory database)`); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
