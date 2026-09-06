/**
 * Renders a terminal card as SVG from real output.
 *
 * The image in the README is not a mock-up: this script takes whatever the
 * tool actually printed and draws it. If the report changes, the picture
 * changes with it, and a screenshot can never claim something the tool has
 * stopped doing.
 *
 *   alibi verify --claim "..." > card.txt
 *   node scripts/card.mjs card.txt docs/card.svg
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node scripts/card.mjs <text-file> <out.svg>');
  process.exit(2);
}

const ESC = '\u001b';
const CODE = new RegExp(`${ESC}\\[(\\d+)m`, 'g');
const ANY_CODE = new RegExp(`${ESC}\\[\\d+m`, 'g');

const PALETTE = {
  1: '#e6edf3',
  2: '#7d8590',
  31: '#f85149',
  32: '#3fb950',
  33: '#d29922',
  34: '#58a6ff',
};

const CHAR = 8.4;
const LINE = 22;
const PAD = 24;
const TOP = 56;

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Splits a line into runs of one colour, following the escape codes. */
function runs(line) {
  const out = [];
  let colour = null;
  let index = 0;

  for (const match of line.matchAll(CODE)) {
    if (match.index > index) out.push({ text: line.slice(index, match.index), colour });
    const code = Number(match[1]);
    colour = code === 0 ? null : (PALETTE[code] ?? colour);
    index = match.index + match[0].length;
  }
  if (index < line.length) out.push({ text: line.slice(index), colour });
  return out;
}

const lines = readFileSync(input, 'utf8').replace(/\n+$/, '').split('\n');
const columns = Math.max(64, ...lines.map((line) => [...line.replace(ANY_CODE, '')].length));
const width = Math.round((columns + 2) * CHAR + PAD * 2);
const height = Math.round(lines.length * LINE + TOP + PAD);

const body = lines
  .map((line, row) => {
    const y = TOP + row * LINE;
    let x = PAD;
    const spans = runs(line)
      .map(({ text, colour }) => {
        const span = `<tspan x="${x.toFixed(1)}" fill="${colour ?? '#e6edf3'}">${escape(text)}</tspan>`;
        x += text.length * CHAR;
        return span;
      })
      .join('');
    return `<text y="${y}" xml:space="preserve">${spans}</text>`;
  })
  .join('\n    ');

writeFileSync(
  output,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="alibi report">
  <rect width="100%" height="100%" rx="10" fill="#0d1117"/>
  <rect width="100%" height="34" fill="#161b22"/>
  <circle cx="20" cy="17" r="5" fill="#f85149"/>
  <circle cx="38" cy="17" r="5" fill="#d29922"/>
  <circle cx="56" cy="17" r="5" fill="#3fb950"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14">
    ${body}
  </g>
</svg>
`,
);

console.log(`${output}  ${width}x${height}`);
