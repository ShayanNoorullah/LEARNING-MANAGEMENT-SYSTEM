// Tests use fixed /tmp paths; isolate those stores so tests never read or remove another run's profiles.
const fs = require('fs'), path = require('path'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdc-audit-tests-'));
const redirect = file => typeof file === 'string' && /^(?:[A-Za-z]:)?\/tmp\/sdc-ai-(secrets|usage)\.json$/.test(file.replace(/\\/g, '/')) ? path.join(dir, path.basename(file)) : file;
for (const key of ['readFileSync', 'writeFileSync', 'existsSync', 'unlinkSync', 'rmSync']) {
  const original = fs[key];
  fs[key] = function(file, ...args) { return original.call(this, redirect(file), ...args); };
}
