/**
 * Turns the run into something a stranger can argue with.
 *
 * The summary leads with the funnel rather than with the headline, because the
 * headline is only worth as much as the denominator underneath it. Every pull
 * request that was attempted and not measured is accounted for by name of
 * reason; a percentage whose denominator is unexplained is the kind of number
 * this whole project exists to object to.
 *
 *   node summarize.mjs [--in results.json] [--md findings.md]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};

const data = JSON.parse(readFileSync(flag('in', 'results.json'), 'utf8'));
const results = data.results ?? [];

const measured = results.filter((r) => r.outcome === 'measured');
const dropped = results.filter((r) => r.outcome !== 'measured');

const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);

const tests = sum(measured, 'examined');
const without = sum(measured, 'withoutAlibi');
const withAlibi = sum(measured, 'withAlibi');
const provisional = sum(measured, 'provisional');
const removals = sum(measured, 'removals');
const vacuous = sum(measured, 'vacuous');

const share = (part, whole) => (whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`);

const byReason = {};
for (const row of dropped) byReason[row.why ?? 'unknown'] = (byReason[row.why ?? 'unknown'] ?? 0) + 1;

function group(rows, key) {
  const out = new Map();
  for (const row of rows) {
    const name = String(row[key] ?? 'unknown').replace(/\[bot\]$/, '');
    const entry = out.get(name) ?? { pulls: 0, tests: 0, without: 0 };
    entry.pulls++;
    entry.tests += row.examined ?? 0;
    entry.without += row.withoutAlibi ?? 0;
    out.set(name, entry);
  }
  return [...out.entries()].sort((a, b) => b[1].tests - a[1].tests);
}

/** A pull request where not one added test would have failed without the change. */
const whollyUnevidenced = measured.filter((r) => r.withAlibi === 0 && r.examined > 0);

const lines = [];
lines.push('# Do the tests coding agents write actually test the change?');
lines.push('');
lines.push(
  `Measured with [alibi](https://github.com/BOTIROFF-D/alibi) over merged pull requests ` +
    `written by five coding agents. Generated ${data.generatedAt ?? 'unknown'}.`,
);
lines.push('');
lines.push('## The funnel');
lines.push('');
lines.push('| | |');
lines.push('| --- | --- |');
lines.push(`| pull requests attempted | ${results.length} |`);
lines.push(`| measured | ${measured.length} |`);
lines.push(`| dropped | ${dropped.length} |`);
lines.push('');
lines.push('Every drop, by reason:');
lines.push('');
lines.push('| reason | count |');
lines.push('| --- | --- |');
for (const [reason, count] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
  lines.push(`| ${reason} | ${count} |`);
}
lines.push('');
lines.push(
  '**This selection is not neutral, and it leans the friendly way.** A repository ' +
    'whose suite installs and passes unattended at the base commit is a better-kept ' +
    'repository than one that does not. If anything, the pull requests that survived ' +
    'the funnel come from projects with more test discipline than the ones that did not, ' +
    'which makes the number below a floor rather than an estimate.',
);
lines.push('');
lines.push('## The result');
lines.push('');
lines.push('| | count | share of answered |');
lines.push('| --- | --- | --- |');
lines.push(`| tests added and answered | ${tests} | 100% |`);
lines.push(`| **went red without the change** | **${withAlibi}** | **${share(withAlibi, tests)}** |`);
lines.push(`| **passed without the change** | **${without}** | **${share(without, tests)}** |`);
lines.push('');
lines.push(
  `A further ${provisional} added tests could not be answered at all: they never ran ` +
    'against the base source, because the code they import did not exist yet. That is ' +
    'expected for new modules and is evidence in neither direction, so they are outside ' +
    'the denominator rather than inside it on favourable terms.',
);
lines.push('');
lines.push(
  `${whollyUnevidenced.length} of the ${measured.length} measured pull requests ` +
    `(${share(whollyUnevidenced.length, measured.length)}) added tests of which **not one** ` +
    'would have failed without the change.',
);
lines.push('');
if (removals > 0 || vacuous > 0) {
  lines.push(
    `Alongside that: ${removals} existing tests were deleted or switched off in these ` +
      `diffs, and ${vacuous} added tests carry an assertion that cannot fail or no ` +
      'assertion at all.',
  );
  lines.push('');
}

lines.push('## By language');
lines.push('');
lines.push('| language | pull requests | tests answered | passed without the change |');
lines.push('| --- | --- | --- | --- |');
for (const [name, entry] of group(measured, 'language')) {
  lines.push(`| ${name} | ${entry.pulls} | ${entry.tests} | ${entry.without} (${share(entry.without, entry.tests)}) |`);
}
lines.push('');
lines.push('## By agent');
lines.push('');
lines.push(
  'These counts are too small to rank anything, and are here so that the corpus is not ' +
    'mistaken for one agent.',
);
lines.push('');
lines.push('| agent | pull requests | tests answered | passed without the change |');
lines.push('| --- | --- | --- | --- |');
for (const [name, entry] of group(measured, 'author')) {
  lines.push(`| ${name} | ${entry.pulls} | ${entry.tests} | ${entry.without} (${share(entry.without, entry.tests)}) |`);
}
lines.push('');

const examples = measured
  .filter((r) => r.withoutAlibi > 0)
  .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
  .slice(0, 25);

if (examples.length > 0) {
  lines.push('## Go and check');
  lines.push('');
  lines.push(
    'Each of these is a merged pull request whose added test passes against the commit ' +
      'it was merged on top of. Check out the base commit, copy the test file in, run it.',
  );
  lines.push('');
  lines.push('| pull request | test | file |');
  lines.push('| --- | --- | --- |');
  for (const row of examples) {
    for (const name of (row.names ?? []).slice(0, 2)) {
      lines.push(
        `| [${row.repo}#${row.number}](https://github.com/${row.repo}/pull/${row.number}) | ` +
          `${name.test} | \`${name.file}:${name.line}\` |`,
      );
    }
  }
  lines.push('');
}

lines.push('## How to reproduce this');
lines.push('');
lines.push('```');
lines.push('git clone https://github.com/BOTIROFF-D/alibi && cd alibi');
lines.push('npm install && npm run build');
lines.push('cd experiments/corpus');
lines.push('node collect.mjs --limit 200      # needs gh, authenticated');
lines.push('node measure.mjs --take 200       # hours, and it clones and installs 200 repositories');
lines.push('node summarize.mjs');
lines.push('```');
lines.push('');
lines.push(
  '`candidates.json` and `results.json` are committed, so the numbers above can be ' +
    'checked without re-running anything. The corpus will drift as repositories change; ' +
    'a rerun will not reproduce it exactly, and the committed files are what these ' +
    'numbers were computed from.',
);
lines.push('');
lines.push('## What this does not say');
lines.push('');
lines.push(
  '- It does not say the changes were wrong. Every one of these pull requests was ' +
    'merged, and most of the fixes are probably fine. It says the tests shipped with ' +
    'them are not the reason to believe so.',
);
lines.push(
  '- It does not compare agents with people. No human-authored control group was ' +
    'measured, and until one is, nobody should read this as a statement about agents ' +
    'specifically rather than about how tests get written next to a change.',
);
lines.push(
  '- It does not generalise past the funnel above. Small repositories with runnable ' +
    'suites are over-represented, because those are the ones that can be measured at all.',
);

const md = lines.join('\n');
writeFileSync(flag('md', 'findings.md'), `${md}\n`);

console.log(md);
