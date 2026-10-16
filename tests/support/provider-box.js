/* Test helper: loads the browser's provider rules (js/aiprovider-logic.js) and the Course Builder's provider
   choice (js/ai-provider-ui.js) into a vm sandbox, in the order app.html loads them, so the real
   js/pages-coursecontent.js and js/pages-coursegen.js can run there. Call it after vm.createContext(box)
   and before running the page script. Sandboxes without Domain.aiCapRoute get Settings' defaults. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', '..', 'js', f), 'utf8');
module.exports = function loadProviderUi(box) {
  box.Domain = box.Domain || {};
  if (!box.Domain.aiCapRoute) box.Domain.aiCapRoute = () => ({ provider: 'openai' });
  if (!box.Domain.integrations) box.Domain.integrations = () => ({});
  if (!box.sessionStorage) box.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  if (!box.sessionStorage.removeItem) box.sessionStorage.removeItem = () => {};
  vm.runInContext(read('aiprovider-logic.js'), box, { filename: 'aiprovider-logic.js' });
  vm.runInContext(read('ai-provider-ui.js') + '\n;this.AIRoute = AIRoute; this.AIProviderLogic = AIProviderLogic;', box, { filename: 'ai-provider-ui.js' });
};
