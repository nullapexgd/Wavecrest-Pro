// Turns the `vite build --mode artifact` output into ONE html file: CSS, JS and the font are
// inlined, so it can be hosted anywhere (it is what the hosted preview page uses).
//   npm run build:single   ->   dist-single/wavecrest.html
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-single');
let html = readFileSync(join(out, 'index.html'), 'utf8');
const asset = f => readFileSync(join(out, f.replace(/^\//, '')), 'utf8');
const font = readFileSync(join(root, 'static/fonts/bricolage-latin-wght.woff2')).toString('base64');

html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => {
  const css = asset(href).replace(/url\(\/?fonts\/bricolage-latin-wght\.woff2\)/g, `url(data:font/woff2;base64,${font})`);
  return `<style>${css}</style>`;
});
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) =>
  `<script type="module">${asset(src).replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace(/<link rel="preload"[^>]*fonts[^>]*>/g, '');
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');

if (/(src|href)="\/(assets|fonts)\//.test(html)) throw new Error('an external asset reference was left in the single file');
writeFileSync(join(out, 'wavecrest.html'), html);
console.log(`dist-single/wavecrest.html  ${(html.length / 1024).toFixed(0)} KB`);
