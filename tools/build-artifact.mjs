// Builds the Artifact entry page from index.html + styles.css.
//
// An Artifact supplies its own <!doctype>, <head> and <body>, so the page has
// to be authored as body content with the stylesheet inlined. Generating it
// from the real index.html means the hosted build can never drift from the
// one served over HTTP.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const html = await readFile(ROOT + 'index.html', 'utf8');
const css = await readFile(ROOT + 'styles.css', 'utf8');

// Everything between <body> and </body>, minus the module script (re-added
// below so it is unambiguous which entry point ships).
const body = html
  .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();

const page = `<title>Task Force Talon</title>
<style>
/* The game commits to a single visual world — desert ground under an olive and
   gold command interface — so it does not follow the viewer's light/dark
   setting. Every colour is painted explicitly and the body sets its own
   background, so the page holds on any host ground. */
:root { color-scheme: dark; }
${css}
</style>

${body}

<script type="module" src="src/main.js"></script>
`;

await mkdir(ROOT + 'dist', { recursive: true });
await writeFile(ROOT + 'dist/artifact.html', page);

// A local harness that mimics the Artifact skeleton, so the wrapped build can
// be checked with the same browser tests as the served build.
await writeFile(ROOT + 'dist/preview.html',
`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light}body{margin:0;font:14px system-ui;background:#faf9f7}
img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
${page.replace('src="src/main.js"', 'src="../src/main.js"')}
</body></html>`);

console.log(`dist/artifact.html  ${(page.length / 1024).toFixed(0)} KB`);
console.log('dist/preview.html   (local harness mimicking the Artifact skeleton)');
