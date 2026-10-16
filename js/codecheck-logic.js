/* SDC Learn — code safety for course content: pure logic, loaded by the browser (before
   js/coursecontent-logic.js) and by the tests. Nothing here touches the page or the network.
   - fenceCode: text that holds code outside a code block gets one, so the viewer shows the code with
     its indentation. Only fences are added (and a common indent removed); the code itself is not edited.
   - analyze: language-aware checks of one code block (Python, JavaScript, JSON, SQL, CSS). A finding
     is "error" (cannot be valid as written) or "review" (may be damaged, a person has to look).
     Incomplete teaching snippets are fine: a block with an elision marker ("...") is never an error,
     and an indented excerpt is judged by its own structure, not by its first line.
   - Nothing here rewrites code to "fix" it: judgment is left to a person. */
const CodeCheckLogic = (() => {
  /* ------------------------------------------------------- languages */
  const LANG = { python: 'python', py: 'python', python3: 'python', ipython: 'python', py3: 'python',
    javascript: 'javascript', js: 'javascript', node: 'javascript', nodejs: 'javascript', jsx: 'javascript', mjs: 'javascript', typescript: 'javascript', ts: 'javascript', tsx: 'javascript',
    json: 'json', sql: 'sql', css: 'css' };
  const label = l => String(l || '').trim().toLowerCase().replace(/^language-/, '');
  const canon = l => LANG[label(l)] || '';

  function guessLanguage(code) {
    const s = String(code || '');
    const n = re => (s.match(re) || []).length;
    const py = 2 * n(/^\s*(def \w+\(.*:|class \w+.*:|import \w[\w.]*(\s+as \w+)?(\s*,.*)?\s*$|from [\w.]+ import|elif .*:|else:\s*$)/gm) + n(/^\s*(print\(|(?:if|for|while|with|try|except|finally)\b.*:\s*$)/gm) + n(/\b(None|True|False|self)\b/g) + n(/^\s*#/gm);
    const js = n(/\b(const|let|var|function)\b/g) + n(/=>|===|!==|console\.|document\.|require\(|\bawait\b/g) + n(/;\s*$/gm) + n(/\{\s*$/gm);
    const ls = s.split('\n').filter(l => l.trim());
    if (ls.length && ls.every(l => /^(\$\s+)?(pip3?|npm|npx|node|python3?|git|cd|ls|mkdir|conda|yarn)\s/.test(l.trim()))) return 'bash';
    if (/^\s*[{[]/.test(s) && /"\s*:/.test(s) && !js && !py) return 'json';
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/i.test(s) && /\b(FROM|INTO|SET|TABLE|VALUES)\b/i.test(s)) return 'sql';
    if (py >= 2 && py > js) return 'python';
    if (js >= 2 && js > py) return 'javascript';
    return '';
  }

  /* ------------------------------------------- code blocks in a text */
  // Alternating segments: even = prose, odd = a fenced block (the same split the viewer uses).
  const FENCE = /(```[^\n]*\n[\s\S]*?(?:```|$))/;
  function splitFences(text) { return String(text || '').split(FENCE); }
  function fencedBlocks(text) {
    const out = [], parts = splitFences(text);
    let line = 0;
    parts.forEach((seg, i) => {
      if (i % 2) {
        const m = /^```([^\n]*)\n([\s\S]*?)(?:\n?```)?$/.exec(seg);
        out.push({ fenced: true, lang: m ? m[1].trim() : '', code: m ? m[2] : seg, line: line + 2, closed: /\n```\s*$/.test(seg) });
      }
      line += (seg.match(/\n/g) || []).length;
    });
    return out;
  }

  /* -------------------------------------------------- unfenced code */
  // A line that is code on its own (anchored, so a sentence that merely mentions code is not).
  const STRONG = [
    /^(def|class)\s+\w+/, /^(async\s+def|@\w[\w.]*)(\s|\(|$)/,
    /^(import|from)\s+[\w.]+(\s+import\s+\S.*|\s+as\s+\w+)?(\s*,\s*[\w.]+(\s+as\s+\w+)?)*\s*;?$/,
    /^(if|elif|while)\s+[^\s].*[()=<>!].*:\s*$/, /^(if|elif|while)\s+(not \s*)?[\w.]+:\s*$/, /^for\s+[\w, ()]+\s+in\s+.+:\s*$/, /^with\s+.+\s+as\s+\w+:\s*$/, /^(else|try|finally):\s*$/, /^except\b[^.]*:\s*$/, /^(return|raise|assert|yield|pass|break|continue|del)\b(?!\s+(the|a|an|to|is|are)\b)/,
    /^[A-Za-z_$][\w$.]*(\[[^\]\n]*\])?\s*(=|\+=|-=|\*=|\/=|:=)[^=].*$/, /^[A-Za-z_$][\w$.]*(\[[^\]\n]*\])?\s*=\s*$/,
    /^[A-Za-z_$][\w$.]*\(.*\)\s*;?$/, /^\.[A-Za-z_$][\w$]*\(.*\)\s*;?$/, /^(await|new|throw|export|module\.exports)\b/,
    /^(const|let|var|function|class)\b\s*[\w$({[*]/, /^(print|console\.\w+)\b.*$/, /^.*(=>\s*\{|\)\s*\{|\{)\s*$/,
    /^(\$|>>>)\s+\S/, /^(pip|pip3|npm|npx|node|python|python3|git|cd|ls|mkdir)\s+[\w.@/-]+/
  ];
  const strong = l => STRONG.some(r => r.test(l)) && !(l.split(/\s+/).length > 12 && !/[=(){};]/.test(l));
  const weak = l => /^\s{2,}\S/.test(l) || /^\t+\S/.test(l) || /^\s*(#|\/\/|\/\*|\*\/)/.test(l) || /^\s*[)}\]]/.test(l);
  const listy = l => /^\s*[-*•]\s/.test(l) || /^\s*\d+[.)]\s/.test(l);
  // Finds runs of code lines in text that is not inside a fence: [{from, to}] line ranges (inclusive).
  function codeRuns(lines) {
    const runs = [];
    let i = 0;
    while (i < lines.length) {
      if (!strong(lines[i].trim()) || listy(lines[i])) { i++; continue; }
      let j = i, last = i, strongs = 0;
      while (j < lines.length) {
        const l = lines[j], t = l.trim();
        if (t === '') {
          let k = j + 1;
          while (k < lines.length && lines[k].trim() === '') k++;
          if (k < lines.length && (strong(lines[k].trim()) || weak(lines[k])) && !listy(lines[k])) { j = k; continue; }
          break;
        }
        if (strong(t) && !listy(l)) { strongs++; last = j; j++; continue; }
        if (weak(l)) { if (!/^\s*(#|\/\/|\/\*|\*\/)/.test(l)) last = j; j++; continue; }
        break;
      }
      if (/^(>>>|\$)\s/.test(lines[i].trim())) { let k = last + 1; while (k < lines.length && lines[k].trim()) k++; last = k - 1; strongs = Math.max(strongs, 2); } // a session: the output goes with it
      if (strongs >= 2 || (strongs === 1 && last > i && lines.slice(i + 1, last + 1).some(l => /^\s{2,}\S|^\t/.test(l)))) {
        let from = i; // comment lines right above the code belong to it
        while (from > 0 && /^\s*(#|\/\/|\/\*|\*\/)/.test(lines[from - 1]) && from - 1 > (runs.length ? runs[runs.length - 1].to : -1)) from--;
        runs.push({ from, to: last });
      }
      i = Math.max(last, i) + 1;
    }
    return runs;
  }
  const dedent = lines => {
    const ind = lines.filter(l => l.trim()).map(l => /^[ \t]*/.exec(l)[0]);
    if (!ind.length) return lines;
    let p = ind[0];
    for (const s of ind) { while (p && !s.startsWith(p)) p = p.slice(0, -1); }
    return p ? lines.map(l => (l.startsWith(p) ? l.slice(p.length) : l)) : lines;
  };
  // Wraps unfenced code in a fence (language guessed, or `lang` when it is known). Idempotent.
  // `whole`: the text is a code field (a solution), so a single code line counts too.
  function fenceCode(text, { lang = '', fallback = '', whole = false } = {}) {
    const src = String(text ?? '');
    if (!src.trim()) return { text: src, fixes: [] };
    const fixes = [];
    const out = splitFences(src).map((seg, i) => {
      if (i % 2 || !seg.trim()) return seg;
      const lines = seg.split('\n');
      let runs = codeRuns(lines);
      if (!runs.length && whole && lines.filter(l => l.trim()).length === 1 && strong(lines.find(l => l.trim()).trim())) { const k = lines.findIndex(l => l.trim()); runs = [{ from: k, to: k }]; }
      if (!runs.length) return seg;
      const res = [];
      let at = 0;
      runs.forEach(r => {
        res.push(...lines.slice(at, r.from));
        const body = dedent(lines.slice(r.from, r.to + 1));
        const guess = guessLanguage(body.join('\n')), lg = canon(lang) ? label(lang) : guess || (canon(fallback) ? label(fallback) : '');
        if (res.length && res[res.length - 1].trim()) res.push(''); // a fence starts a paragraph of its own
        res.push('```' + lg, ...body, '```');
        fixes.push({ kind: 'fenced', lang: lg, lines: body.length });
        at = r.to + 1;
        if (at < lines.length && lines[at].trim()) res.push('');
      });
      res.push(...lines.slice(at));
      return res.join('\n');
    }).join('');
    return { text: out, fixes };
  }

  /* ------------------------------------------------------- analyzers */
  const find = (level, rule, line, message) => ({ level, rule, line, message });
  const ELISION = /^\s*(\.\.\.|…|#\s*\.\.\.|\/\/\s*\.\.\.|\/\*\s*\.\.\.\s*\*\/|#\s*(your|add|more)\b.*|\/\/\s*(your|add|more)\b.*|<\s*\.\.\.\s*>)\s*$/i;
  const elided = code => String(code).split('\n').some(l => ELISION.test(l));
  // Names that are (almost) never attributes: written without brackets at the end of a statement they
  // are a call that lost its "()".
  const PY_CALLS = new Set('show info describe head tail dropna drop_duplicates reset_index tight_layout copy fillna isnull isna notnull notna value_counts nunique unique sort_values sort_index to_csv to_excel to_json to_dict tolist savefig close clf groupby hist boxplot strip lower upper mean median std cumsum astype merge'.split(' '));
  const JS_CALLS = new Set('log json preventDefault stopPropagation forEach stringify then catch listen push pop toLowerCase toUpperCase trim querySelector getElementById addEventListener createElement appendChild reload'.split(' '));
  // Real attributes that look like methods in some libraries; evidence from the content never flags these.
  const ATTRS = new Set('shape columns index dtypes values T size ndim loc iloc at iat str dt empty name names axes nbytes real imag length status ok url body headers value text'.split(' '));
  // Evidence that a name is a call (it is called elsewhere in the content) is only trusted for a bare
  // expression or the end of a chain, never for "return self.title" or an assignment.
  const evidenceOk = t => !/^(return|yield|raise|assert|print|del)\b/.test(t) && (/^[\w.[\]]+$/.test(t) || /\)\.[A-Za-z_$][\w$]*$/.test(t));
  const callNamesOf = text => { const s = new Set(); for (const m of String(text).matchAll(/\.([A-Za-z_$][\w$]*)\(/g)) s.add(m[1]); return s; };

  // Strings, comments and brackets. mode: 'py' | 'js'. Returns { findings, logical }: the logical
  // lines (physical lines joined while a bracket, string or backslash continues) with strings blanked.
  function scan(code, mode) {
    const lines = String(code).replace(/\r\n?/g, '\n').split('\n');
    const findings = [], logical = [], stack = [];
    let tri = null, cont = false, inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], startDepth = stack.length, startTri = tri, startBlock = inBlock, startsCont = cont;
      let out = '', j = 0;
      cont = false;
      while (j < line.length) {
        const ch = line[j], two = line.substr(j, 2), top = stack[stack.length - 1];
        if (mode === 'py' && tri) { const e = line.indexOf(tri, j); if (e < 0) j = line.length; else { j = e + 3; tri = null; } continue; }
        if (mode === 'js' && inBlock) { const e = line.indexOf('*/', j); if (e < 0) j = line.length; else { j = e + 2; inBlock = false; } continue; }
        if (mode === 'js' && top && top.ch === '`') { // inside the text of a template literal
          let e = -1;
          for (let k = j; k < line.length; k++) { if (line[k] === '\\') { k++; continue; } if (line[k] === '`' || (line[k] === '$' && line[k + 1] === '{')) { e = k; break; } }
          if (e < 0) { j = line.length; continue; }
          if (line[e] === '`') { stack.pop(); out += '""'; j = e + 1; continue; }
          stack.push({ ch: '{', line: i + 1, tplExpr: true }); j = e + 2; continue;
        }
        if (mode === 'py' && ch === '#') break;
        if (mode === 'js' && two === '//') break;
        if (mode === 'js' && two === '/*') { inBlock = true; j += 2; continue; }
        if (ch === '"' || ch === "'" || (mode === 'js' && ch === '`')) {
          if (mode === 'py' && line.substr(j, 3) === ch.repeat(3)) { tri = ch.repeat(3); out += '""'; j += 3; continue; }
          if (mode === 'js' && ch === '`') { stack.push({ ch: '`', line: i + 1 }); j++; continue; }
          let k = j + 1, closed = false;
          while (k < line.length) { if (line[k] === '\\') { k += 2; continue; } if (line[k] === ch) { closed = true; break; } k++; }
          if (!closed) {
            if (/\\$/.test(line)) { cont = true; j = line.length; out += '""'; continue; }
            findings.push(find('error', 'string', i + 1, 'A string is opened but never closed on this line.'));
            j = line.length; out += '""'; continue;
          }
          out += '""'; j = k + 1; continue;
        }
        if (mode === 'js' && ch === '/' && /(^|[(,=:[!&|?{};]|\breturn|\btypeof)\s*$/.test(out)) { // a regular expression literal
          let k = j + 1, closed = false, cls = false;
          while (k < line.length) { if (line[k] === '\\') { k += 2; continue; } if (line[k] === '[') cls = true; else if (line[k] === ']') cls = false; else if (line[k] === '/' && !cls) { closed = true; break; } k++; }
          if (closed) { out += '""'; j = k + 1; while (/[a-z]/i.test(line[j] || '')) j++; continue; }
        }
        if ('([{'.includes(ch)) stack.push({ ch, line: i + 1 });
        else if (')]}'.includes(ch)) {
          if (mode === 'js' && ch === '}' && top?.tplExpr) { stack.pop(); out += ch; j++; continue; }
          if (!top) findings.push(find('error', 'brackets', i + 1, 'A closing bracket ' + ch + ' has no opening bracket.'));
          else if ('([{'.indexOf(top.ch) !== ')]}'.indexOf(ch)) { findings.push(find('error', 'brackets', i + 1, ch + ' closes ' + top.ch + ' opened on line ' + top.line + '.')); stack.pop(); }
          else stack.pop();
        }
        out += ch; j++;
      }
      if (mode === 'py' && /\\\s*$/.test(line) && !tri) cont = true;
      const text = out.replace(/\s+$/, '');
      if (!startsCont && startDepth === 0 && !startTri && !startBlock) {
        if (text.trim() !== '') logical.push({ n: i + 1, indent: /^[ \t]*/.exec(line)[0], text: text.trim(), end: i + 1 });
      } else if (logical.length && text.trim()) { const L = logical[logical.length - 1]; L.text += ' ' + text.trim(); L.end = i + 1; }
    }
    if (tri) findings.push(find('error', 'string', lines.length, 'A triple-quoted string is never closed.'));
    if (inBlock) findings.push(find('error', 'comment', lines.length, 'A /* comment is never closed.'));
    if (stack.length) { const o = stack[0]; findings.push(find('error', 'brackets', o.line, o.ch === '`' ? 'A template string is never closed.' : 'The bracket ' + o.ch + ' opened here is never closed.')); }
    return { findings, logical };
  }

  function pyCheck(code, names) {
    if (/^\s*>>>\s/m.test(code)) return []; // an interactive session, not a program
    const { findings, logical } = scan(code, 'py');
    // Indentation is judged by the block's own structure: a common indent is removed first.
    const real = logical.filter(L => !/^[%!]/.test(L.text));
    let p = real.length ? real[0].indent : '';
    for (const L of real) { while (p && !L.indent.startsWith(p)) p = p.slice(0, -1); }
    const stack = [''];
    let prevOpen = null;
    const seen = new Set();
    const add = x => { const k = x.rule + ':' + x.line; if (!seen.has(k)) { seen.add(k); findings.push(x); } };
    real.forEach(L => {
      const ind = L.indent.slice(p.length), top = stack[stack.length - 1];
      if (/\t/.test(ind) && / /.test(ind)) add(find('error', 'indent', L.n, 'The indentation mixes tabs and spaces.'));
      if (prevOpen) {
        if (ind.length > top.length && ind.startsWith(top)) stack.push(ind);
        else add(find('error', 'indent', L.n, 'Line ' + prevOpen.n + ' ends with a colon but this line is not indented under it.'));
      } else if (ind === top) { /* same block */ }
      else if (ind.length > top.length && ind.startsWith(top)) add(find('error', 'indent', L.n, 'This line is indented more than the line before it, with nothing opening a block.'));
      else {
        while (stack.length > 1 && stack[stack.length - 1].length > ind.length) stack.pop();
        if (stack[stack.length - 1] !== ind) add(find('error', 'indent', L.n, 'The indentation does not match any block above it.'));
      }
      prevOpen = /:\s*$/.test(L.text) && !/^lambda\b/.test(L.text) ? L : null;
      if (/^print\s+["'\w]/.test(L.text)) add(find('error', 'syntax', L.n, 'print needs brackets in Python 3: print(...).'));
      const m = /^(?!(?:import|from|del|global|nonlocal)\b)(.*[\w\])]\.)([A-Za-z_]\w*)$/.exec(L.text.replace(/;$/, ''));
      if (m && !ATTRS.has(m[2]) && (PY_CALLS.has(m[2]) || (names?.has(m[2]) && evidenceOk(L.text)))) add(find('review', 'missing-call', L.n, m[1] + m[2] + ' is not called: it may have lost its brackets, ' + m[2] + '().'));
    });
    return findings;
  }

  function jsCheck(code, names) {
    const { findings, logical } = scan(code, 'js');
    logical.forEach(L => {
      const t = L.text.replace(/[;,]$/, '');
      const m = /[\w$\])]\.([A-Za-z_$][\w$]*)$/.exec(t);
      if (m && !ATTRS.has(m[1]) && (JS_CALLS.has(m[1]) || (names?.has(m[1]) && evidenceOk(t))) && !/^(import|export)\b/.test(t)) findings.push(find('review', 'missing-call', L.n, m[0] + ' is not called: it may have lost its brackets, ' + m[1] + '().'));
      const a = /=>\s*[\w$.]+\.(json|text|blob)\s*[)\],]/.exec(L.text);
      if (a) findings.push(find('review', 'missing-call', L.n, a[1] + ' is not called in this arrow function: it may need ' + a[1] + '().'));
    });
    return findings;
  }
  function sqlCheck(code) { return scan(code.replace(/--.*$/gm, ''), 'js').findings.filter(x => x.rule === 'brackets' || x.rule === 'string'); }
  function cssCheck(code) {
    let d = 0, bad = false;
    (code.replace(/\/\*[\s\S]*?\*\//g, '').match(/[{}]/g) || []).forEach(c => { d += c === '{' ? 1 : -1; if (d < 0) bad = true; });
    return bad || d !== 0 ? [find('error', 'brackets', 1, 'The { } braces do not match.')] : [];
  }
  function jsonCheck(code) {
    if (/^\s*(\/\/|\/\*|#)/m.test(code)) return [];
    try { JSON.parse(code); return []; } catch (e) { return [find('error', 'json', 1, 'This is not valid JSON.')]; }
  }

  // One code block. lang: the fence label or a code example's language field ('' = guess).
  // Returns [{ level, rule, line, message }]. An elided snippet never gets an "error" level.
  function analyze(code, lang = '', { names } = {}) {
    const src = String(code ?? '');
    if (!src.trim()) return [];
    const l = canon(lang) || (label(lang) ? '' : guessLanguage(src));
    let res = [];
    if (l === 'python') res = pyCheck(src, names);
    else if (l === 'javascript') res = jsCheck(src, names);
    else if (l === 'json') res = jsonCheck(src);
    else if (l === 'sql') res = sqlCheck(src);
    else if (l === 'css') res = cssCheck(src);
    if (res.length && elided(src)) res = res.map(x => (x.level === 'error' ? { ...x, level: 'review' } : x));
    return res.slice(0, 6);
  }

  // Everything in one text field: fenced blocks (by their label) and code lines left outside a fence.
  function textFindings(text, { lang = '', names } = {}) {
    const out = [], src = String(text || '');
    fencedBlocks(src).forEach(b => analyze(b.code, b.lang || lang, { names }).forEach(x => out.push({ ...x, line: b.line + x.line - 1, fenced: true })));
    splitFences(src).forEach((seg, i) => {
      if (i % 2 || !seg.trim()) return;
      const lines = seg.split('\n');
      codeRuns(lines).forEach(r => analyze(dedent(lines.slice(r.from, r.to + 1)).join('\n'), lang, { names }).forEach(x => out.push({ ...x, line: r.from + x.line, fenced: false })));
    });
    return out;
  }

  const isCodeLine = l => strong(String(l).trim());

  return { isCodeLine, canon, guessLanguage, splitFences, fencedBlocks, codeRuns, fenceCode, analyze, textFindings, callNamesOf, elided, dedent };
})();
if (typeof module !== 'undefined') module.exports = CodeCheckLogic;
