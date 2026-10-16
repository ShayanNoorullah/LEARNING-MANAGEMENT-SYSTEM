/* Code safety (js/codecheck-logic.js): language-aware checks must pass valid teaching code in Python and
   JavaScript untouched, flag only what cannot be valid or may have lost its brackets, and never judge an
   incomplete snippet as broken. Fences are only added around unfenced code. Run: npm test */
const assert = require('assert');
const C = require('../js/codecheck-logic.js');
const rules = (code, lang) => C.analyze(code, lang).map(f => f.rule + ':' + f.level);
const clean = (code, lang, why) => assert.deepEqual(C.analyze(code, lang), [], why || 'valid code gets no findings: ' + code.slice(0, 50));

/* ------------------------------------------------ valid Python is left alone */
const PY_OK = [
  'import pandas as pd\n\ndef clean(df):\n    if df.empty:\n        return df\n    df = df.drop_duplicates()\n    return df.fillna(df.mean()).reset_index()\n\nprint(clean(pd.DataFrame()).isnull().sum().sum())\nplt.tight_layout()\nplt.show()',
  'class Student:\n    def __init__(self, name, marks=None):\n        self.name = name\n        self.marks = marks or []\n\n    @property\n    def average(self):\n        return sum(self.marks) / len(self.marks) if self.marks else 0',
  'try:\n    value = int(text)\nexcept ValueError as e:\n    print(f"bad number: {e}")\nelse:\n    print(value)\nfinally:\n    print("done")',
  'result = (df[df["age"] > 30]\n          .groupby("city")["salary"]\n          .mean()\n          .reset_index())',
  'data = {\n    "a": [1, 2, 3],\n    "b": ["x", "y", "z"],\n}\ndf = pd.DataFrame(data)',
  'def total(items):\n    """Add up the prices.\n\n    Works on a list.\n    """\n    return sum(i.price for i in items)',
  'squares = [x * x for x in range(10) if x % 2 == 0]\nwords = {w: len(w) for w in ["a", "bb"]}\nf = lambda x: x + 1',
  'with open("a.csv") as f:\n    for line in f:\n        if not line.strip():\n            continue\n        print(line)',
  'total = 1 + \\n    2 + \\n    3',
  'if __name__ == "__main__":\n    main()',
  '>>> df.head()\n   a  b\n0  1  2',
  '    x = 1\n    if x:\n        y = 2',
  'print(df.shape)\ndf.columns\ndf.dtypes\nprint(df.index)',
  '# load the data\ndf = pd.read_csv("sales.csv")  # a comment with ( bracket\ns = "text with ) and # inside"',
  'for i in range(3):\n    for j in range(3):\n        print(i * j)\nprint("end")',
  'import os, sys\nfrom math import sqrt as root\nprint(root(16))'
];
PY_OK.forEach((c, i) => clean(c, 'python', 'valid Python #' + i));

/* -------------------------------------------- valid JavaScript is left alone */
const JS_OK = [
  "const add = (a, b) => a + b;\nconst names = users.map(u => u.name).filter(Boolean).sort();\nconsole.log(add(1, 2));",
  "async function load(id) {\n  try {\n    const res = await fetch(`/api/users/${id}`);\n    if (!res.ok) throw new Error(`HTTP ${res.status}`);\n    return await res.json();\n  } catch (err) {\n    console.error(err.message);\n  }\n}",
  "fetch(url)\n  .then(r => r.json())\n  .then(data => console.log(data))\n  .catch(err => console.error(err));",
  "const re = /^[a-z0-9._-]+@[a-z]+\\.[a-z]{2,}$/i;\nconst ok = re.test(email) && x / 2 > 1;",
  "const { name, age = 18 } = person;\nconst [first, ...rest] = list;\nconst o = { ...a, b: [1, 2, { c: 3 }] };",
  "class Cart {\n  #items = [];\n  add(item) { this.#items.push(item); return this; }\n  get total() { return this.#items.reduce((n, i) => n + i.price, 0); }\n}",
  "document.querySelector('#btn').addEventListener('click', () => {\n  console.log(`clicked ${count++} times`);\n});",
  "switch (day) {\n  case 1: return 'Mon';\n  default: return '?';\n}",
  "function f() {\n  // ...\n}\n\nconst x = [\n  1,\n  2,\n];"
];
JS_OK.forEach((c, i) => clean(c, 'javascript', 'valid JavaScript #' + i));
JS_OK.push('// a comment with ( and {\n/* block ) comment */\nconst s = "text";\nconst t = "a } b";');
JS_OK.push("app.get('/users/:id', (req, res) => {\n  const user = users.find(u => u.id === Number(req.params.id));\n  if (!user) return res.status(404).json({ error: 'Not found' });\n  res.json(user);\n});");
JS_OK.slice(-2).forEach(c => clean(c, 'javascript'));
clean('{"name": "Ali", "marks": [1, 2, 3], "ok": true}', 'json');
clean('SELECT name, COUNT(*) FROM students WHERE age > 18 GROUP BY name;', 'sql');
clean('.card { color: red; } @media (max-width: 600px) { .card { color: blue; } }', 'css');
clean('this is not code at all (really', 'text', 'an unknown language is never judged');
assert.deepEqual(C.analyze('def f(:', 'bash'), [], 'only known languages are checked');

/* ----------------------------------------- code that cannot be valid is flagged */
assert.ok(rules('def f(x):\nreturn x', 'python').includes('indent:error'), 'no body under a colon');
assert.ok(rules('for i in range(3):\n if i:\n print(i)', 'python').includes('indent:error'), 'flattened indentation (the old link-cleaner damage)');
assert.ok(rules('x = 1\n    y = 2', 'python').includes('indent:error'), 'unexpected indent');
assert.ok(rules('if a:\n        b = 1\n    c = 2', 'python').includes('indent:error'), 'a dedent that matches no block');
assert.ok(rules('if a:\n\tb = 1\n        c = 2', 'python').includes('indent:error'), 'tabs mixed with spaces');
assert.ok(rules('print(df.head()', 'python').includes('brackets:error'), 'an unclosed bracket');
assert.ok(rules('x = (1 + 2))', 'python').includes('brackets:error'), 'a stray closing bracket');
assert.ok(rules('s = "never closed\nprint(s)', 'python').includes('string:error'), 'an unclosed string');
assert.ok(rules('doc = """never closed\nx = 1', 'python').includes('string:error'), 'an unclosed triple-quoted string');
assert.ok(rules('print "hello"', 'python').includes('syntax:error'), 'print without brackets');
assert.ok(rules('function f() {\n  return [1, 2;\n}', 'javascript').includes('brackets:error'), 'mismatched brackets');
assert.ok(rules('const s = "abc;\nfoo();', 'javascript').includes('string:error'), 'an unclosed JavaScript string');
assert.ok(rules('const t = `abc', 'javascript').includes('brackets:error'), 'an unclosed template string');
assert.ok(rules('{"a": 1,}', 'json').includes('json:error'), 'invalid JSON');
assert.ok(rules('.a { color: red;', 'css').includes('brackets:error'), 'unbalanced CSS');
assert.ok(rules('SELECT (a FROM t', 'sql').includes('brackets:error'), 'unbalanced SQL');
C.analyze('def f(x):\nreturn x', 'python').forEach(f => assert.ok(Number.isInteger(f.line) && f.line >= 1 && f.message.length > 10));

/* --------------------------- an incomplete teaching snippet is not an error */
assert.deepEqual(C.analyze('def f(x):\n    ...\nresult = compute(', 'python').map(f => f.level), ['review'], 'an elided snippet is only to be confirmed');
assert.deepEqual(C.analyze('items.map(x => {\n  // ...', 'javascript').map(f => f.level), ['review']);
assert.deepEqual(C.analyze('    if x:\n        y = 2\n    z = 3', 'python'), [], 'an indented excerpt is judged by its own structure');
assert.deepEqual(C.analyze('def main():', 'python'), [], 'a snippet that ends at a block header is fine');

/* -------------------------------------- brackets that went missing are found */
const miss = (code, lang, names) => C.analyze(code, lang, { names: names && new Set(names) }).filter(f => f.rule === 'missing-call').map(f => f.line);
assert.deepEqual(miss('df = pd.read_csv("a.csv")\ndf.info\nplt.show', 'python'), [2, 3]);
assert.deepEqual(miss('df = df.dropna\nclean = df.drop_duplicates.reset_index', 'python'), [1, 2]);
assert.deepEqual(miss('summary = df.groupby("city")["pay"].sum.reset_index', 'python'), [1]);
assert.deepEqual(miss('print(df.shape)\ndf.columns\nx = df.index', 'python'), [], 'real attributes are not calls');
assert.deepEqual(miss('fetch(u).then(res => res.json).then(d => d)', 'javascript'), [1]);
assert.deepEqual(miss('event.preventDefault\nconsole.log', 'javascript'), [1, 2]);
assert.deepEqual(miss('response.json', 'javascript', ['json']), [1], 'a name called elsewhere in the content counts as evidence');
assert.deepEqual(miss('return self.title', 'python', ['title']), [], 'evidence is not trusted for a return of an attribute');
assert.deepEqual(miss('book.title', 'python', ['title']), [1], 'but a bare expression is');
assert.deepEqual(miss('df.shape', 'python', ['shape']), [], 'known attributes are never flagged');

/* -------------------------------------------- code in a text field (fences) */
const withFence = 'Run this:\n\n```python\ndef f(x):\nreturn x\n```\n\nThen look at the output.';
const tf = C.textFindings(withFence);
assert.equal(tf.length, 1); assert.equal(tf[0].line, 5, 'the line number is the line of the text field');
assert.deepEqual(C.textFindings('```python\nx = 1\n```'), []);
assert.ok(C.textFindings('def f(x):\nreturn x\nprint(f(1))').length, 'code left outside a fence is checked too');
assert.deepEqual(C.textFindings('Call plt.show() to draw the chart, then df.info() for a summary.'), [], 'prose that mentions code is not code');

/* ---------------------------------------------------------- fenceCode */
const fz = t => C.fenceCode(t).text;
assert.equal(fz('import pandas as pd\ndf = pd.read_csv("a.csv")\nprint(df.head())'), '```python\nimport pandas as pd\ndf = pd.read_csv("a.csv")\nprint(df.head())\n```');
assert.equal(fz('Here is the solution:\n  let t = 28;\n  function f(x) {\n    return x;\n  }\nDone.'), 'Here is the solution:\n\n```javascript\nlet t = 28;\nfunction f(x) {\n  return x;\n}\n```\n\nDone.', 'a common indent is removed, relative indentation kept');
assert.equal(fz('Use plt.show() to display the chart.\nThen close the window.'), 'Use plt.show() to display the chart.\nThen close the window.', 'prose is never fenced');
assert.equal(fz('- run df.head()\n- run df.info()'), '- run df.head()\n- run df.info()', 'list items are never fenced');
assert.equal(fz('1. Import pandas\n2. Call df.head()'), '1. Import pandas\n2. Call df.head()');
assert.equal(fz('The call df.head() shows the first rows.'), 'The call df.head() shows the first rows.');
assert.equal(fz('x = 1'), 'x = 1', 'one line of code inside text is not fenced');
assert.equal(C.fenceCode('x = 1', { whole: true }).text, '```\nx = 1\n```', 'unless the whole field is code (a solution)');
assert.equal(fz('```python\nx = 1\ny = 2\n```'), '```python\nx = 1\ny = 2\n```', 'a fenced block is untouched');
assert.equal(C.fenceCode('a = 1\nb = 2', { fallback: 'python' }).text.split('\n')[0], '```python', 'the course language is only a fallback');
assert.equal(C.fenceCode('def f():\n    return 1', { fallback: 'javascript' }).text.split('\n')[0], '```python', 'the code itself wins over the fallback');
assert.equal(fz('pip install pandas\npip install numpy'), '```bash\npip install pandas\npip install numpy\n```');
const BODY = 'def a():\n    return 1\n\n\ndef b():\n    if True:\n        return 2';
const fb = fz('Two functions:\n' + BODY).split('\n');
assert.equal(fb[2], '```python'); assert.equal(fb.slice(3, -1).join('\n'), BODY, 'blank lines and indentation stay');
// fencing twice changes nothing, and taking the fences off gives back the code
[...PY_OK, ...JS_OK].forEach(code => {
  const once = fz(code), twice = fz(once);
  assert.equal(twice, once, 'fencing is idempotent');
  const inner = once.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '');
  assert.equal(inner.replace(/\s+$/, ''), C.dedent(code.split('\n')).join('\n').replace(/\s+$/, ''), 'the code is unchanged inside the fence (apart from a common indent)');
});
PY_OK.filter(c => !/^>>>/.test(c) && !/^ /.test(c)).forEach(c => assert.deepEqual(C.textFindings(fz(c)), [], 'fencing does not create findings'));

console.log('codecheck.test.js: all checks passed');
