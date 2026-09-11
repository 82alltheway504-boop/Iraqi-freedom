// Rasterises icon.svg into the PNG sizes the manifest and iOS need.
// Run after changing icon.svg: node tools/icons.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const svg = await readFile(ROOT + 'icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

const render = async (size, maskable) => {
  await page.setViewportSize({ width: size, height: size });
  // A maskable icon must survive an aggressive circular crop, so the artwork
  // is inset into a safe zone with the background bled to the edges.
  await page.setContent(`<!doctype html><style>
    html,body{margin:0;width:${size}px;height:${size}px;background:#12160f;overflow:hidden}
    .w{width:100%;height:100%;display:grid;place-items:center}
    /* Non-maskable icons are scaled slightly past the frame so the artwork's
       own rounded corners are cropped — iOS and Android apply their own mask. */
    svg{width:${maskable ? 76 : 104}%;height:${maskable ? 76 : 104}%;display:block}
  </style><div class="w">${svg}</div>`);
  return page.screenshot({ omitBackground: false });
};

await writeFile(ROOT + 'icon-180.png', await render(180, false));
await writeFile(ROOT + 'icon-512.png', await render(512, false));
await writeFile(ROOT + 'icon-maskable.png', await render(512, true));
await browser.close();
console.log('icon-180.png, icon-512.png, icon-maskable.png');
