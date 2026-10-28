// Fails the build if a token pair drops below its WCAG threshold, in BOTH themes.
// Reads src/styles/tokens.css, so the numbers can never drift from the real values.
//   node tools/check-contrast.mjs        (npm run check:contrast)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src/styles/tokens.css'), 'utf8');

function block(marker) {
  const i = css.indexOf(marker);
  if (i < 0) throw new Error(`tokens.css has no ${marker}`);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
}
function vars(text) {
  const out = {};
  for (const m of text.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
}

const themes = {
  light: vars(block(':root {')),
  dark: vars(block(':root[data-theme="dark"]'))
};

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground, background, minimum, why]
const PAIRS = [
  ['ink', 'paper', 7, 'body and headings (AAA)'],
  ['ink', 'paper-2', 7, 'text on raised surfaces (AAA)'],
  ['ink-soft', 'paper', 4.5, 'secondary text (AA)'],
  ['ink-soft', 'paper-2', 4.5, 'secondary text on raised (AA)'],
  ['tide', 'paper', 4.5, 'data labels in the tide colour (AA)'],
  ['on-signal', 'signal', 4.5, 'text on a signal button (AA)'],
  ['signal', 'paper', 3, 'signal as a mark or line (non-text, 3:1)'],
  ['ink', 'paper-2', 7, 'focus ring against raised surfaces'],
  ['line', 'paper', 1.4, 'hairlines are decoration, never the only carrier of meaning']
];

let failed = 0;
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n${name}`);
  for (const [fg, bg, min, why] of PAIRS) {
    if (!t[fg] || !t[bg]) { console.log(`  ?? missing --${fg} or --${bg}`); failed++; continue; }
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1  need ${String(min).padEnd(3)}  ${fg} on ${bg}  (${why})`);
  }
}
if (failed) { console.error(`\n${failed} pair(s) fail`); process.exit(1); }
console.log('\nall pairs pass');
