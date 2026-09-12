// Bundles the whole game into one self-contained HTML file that runs from
// anywhere — a local file, a USB stick, an email attachment — with no server,
// no network and no module loader.
//
// The module graph is small, acyclic and uses only named imports and exports,
// so each module can become an IIFE that returns its exports, emitted in
// dependency order. No transpiler, no bundler dependency.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ENTRY = 'src/main.js';

const key = (p) => normalize(p).replace(/^\.\//, '');
const source = new Map();

async function load(path) {
  if (source.has(path)) return;
  const code = await readFile(join(ROOT, path), 'utf8');
  source.set(path, code);
  for (const m of code.matchAll(/^import\s*\{[^}]*\}\s*from\s*'([^']+)'/gm)) {
    await load(key(join(dirname(path), m[1])));
  }
}
await load(ENTRY);

// --- dependency order, with a cycle check --------------------------------
const deps = (code, path) =>
  [...code.matchAll(/^import\s*\{[^}]*\}\s*from\s*'([^']+)'/gm)]
    .map((m) => key(join(dirname(path), m[1])));

const order = [];
const state = new Map();           // 0 = visiting, 1 = done
(function visit(path, stack = []) {
  if (state.get(path) === 1) return;
  if (state.get(path) === 0) {
    throw new Error('Import cycle: ' + [...stack, path].join(' -> '));
  }
  state.set(path, 0);
  for (const d of deps(source.get(path), path)) visit(d, [...stack, path]);
  state.set(path, 1);
  order.push(path);
})(ENTRY);


/**
 * Names declared by a `const`/`let`/`var` statement, given the text starting
 * just after the keyword. Walks to the end of the statement tracking bracket
 * depth, so initialisers containing commas, objects, arrays or arrow functions
 * do not confuse it.
 */
function declaredNames(text) {
  const names = [];
  let depth = 0, i = 0, expectName = true;
  while (i < text.length) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') { depth++; i++; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; i++; continue; }
    if (depth === 0) {
      if (c === ';' || c === '\n' && /^\s*$/.test(text.slice(i, text.indexOf('\n', i + 1)))) break;
      if (c === ',') { expectName = true; i++; continue; }
      if (c === '=') {
        // Skip the initialiser: advance to the next top-level comma or the end.
        expectName = false;
        i++;
        continue;
      }
      if (expectName && /[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < text.length && /[\w$]/.test(text[j])) j++;
        names.push(text.slice(i, j));
        expectName = false;
        i = j;
        continue;
      }
    }
    i++;
  }
  return names;
}

// --- rewrite each module --------------------------------------------------
function transform(path, code) {
  const exported = new Set();

  // `import { a, b as c } from './x.js'` -> destructure from the registry.
  code = code.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm, (_, names, spec) => {
    const dep = key(join(dirname(path), spec));
    const binding = names.split(',').map((n) => {
      const [orig, alias] = n.split(/\s+as\s+/).map((s) => s.trim());
      return alias ? `${orig}: ${alias}` : orig;
    }).filter(Boolean).join(', ');
    return `const { ${binding} } = __M[${JSON.stringify(dep)}];`;
  });

  // `export { A, B };` -> remember the names, drop the statement.
  code = code.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_, names) => {
    for (const n of names.split(',')) {
      const t = n.split(/\s+as\s+/).pop().trim();
      if (t) exported.add(t);
    }
    return '';
  });

  // `export function X` / `export class X` -> one name each.
  code = code.replace(/^export\s+(function|class)\s+([A-Za-z_$][\w$]*)/gm,
    (_, kind, name) => { exported.add(name); return `${kind} ${name}`; });

  // `export const a = 1, b = 2, c = 3;` declares three names, not one. Missing
  // the tail of that list is silent and vicious: the importing module gets
  // `undefined` for a constant, which only surfaces much later as arithmetic
  // on undefined. Walk the statement and collect every declarator.
  code = code.replace(/^export\s+(const|let|var)\s+/gm, (m, kind, offset) => {
    for (const name of declaredNames(code.slice(offset + m.length))) exported.add(name);
    return `${kind} `;
  });

  // `export const { a, b } = ...` is not used, but fail loudly if it appears.
  if (/^export\s/m.test(code)) {
    throw new Error(`Unhandled export form in ${path}:\n` +
      code.split('\n').filter((l) => /^export\s/.test(l)).join('\n'));
  }

  const returns = [...exported].join(', ');
  return {
    exported,
    code: `__M[${JSON.stringify(path)}] = (() => {\n${code}\nreturn { ${returns} };\n})();`,
  };
}

const exportsOf = new Map();
const modules = order.map((p) => {
  const { code, exported } = transform(p, source.get(p));
  exportsOf.set(p, exported);
  return code;
}).join('\n\n');

// Every imported name must actually be exported by the module it comes from.
// This is the guard that turns a silent `undefined` into a failed build.
const missing = [];
for (const path of order) {
  for (const m of source.get(path).matchAll(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)'/gm)) {
    const dep = key(join(dirname(path), m[2]));
    const have = exportsOf.get(dep);
    for (const raw of m[1].split(',')) {
      const name = raw.split(/\s+as\s+/)[0].trim();
      if (name && !have.has(name)) missing.push(`${path} imports { ${name} } from ${dep}, which does not export it`);
    }
  }
}
if (missing.length) {
  console.error('Bundle would be broken:\n  ' + missing.join('\n  '));
  process.exit(1);
}

const html = await readFile(ROOT + 'index.html', 'utf8');
const css = await readFile(ROOT + 'styles.css', 'utf8');
const icon = await readFile(ROOT + 'icon.svg', 'utf8');
const manifest = await readFile(ROOT + 'manifest.webmanifest', 'utf8');

const body = html
  .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();

// The manifest and icon are embedded as data URIs so a single saved file is
// still installable when it is served over HTTPS.
const iconUri = 'data:image/svg+xml;base64,' + Buffer.from(icon).toString('base64');
const manifestObj = JSON.parse(manifest);
manifestObj.icons = [{ src: iconUri, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }];
manifestObj.start_url = '.';
manifestObj.scope = './';
const manifestUri = 'data:application/manifest+json;base64,' +
  Buffer.from(JSON.stringify(manifestObj)).toString('base64');

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#12160f">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Task Force Talon">
<title>Operation Iraqi Freedom — Task Force Talon</title>
<link rel="manifest" href="${manifestUri}">
<link rel="icon" href="${iconUri}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${iconUri}">
<style>
${css}
</style>
</head>
<body>
${body}
<script type="module">
// The entire game, bundled. Every module below is the original source with its
// imports rewired through this registry; nothing else was changed.
const __M = {};

${modules}
</script>
</body>
</html>
`;

await mkdir(ROOT + 'dist', { recursive: true });
await writeFile(ROOT + 'dist/task-force-talon.html', out);
console.log(`dist/task-force-talon.html  ${(out.length / 1024).toFixed(0)} KB  (${order.length} modules)`);
console.log('order:', order.map((p) => p.replace('src/', '')).join(' → '));
