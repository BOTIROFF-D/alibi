/**
 * The integration test builds a real repository, commits a real bug, and lets
 * a scripted "agent" change it in the four ways this tool exists to tell
 * apart: a test that goes red without the fix, a test that does not, a test
 * that was deleted, and a fix with no test at all.
 *
 * Mocking git or the runner here would test the mocks. The whole claim of the
 * tool is that it asks the machine, so the test asks the machine too.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verify } from '../dist/verify.js';

function git(args, cwd) {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  });
}

const BUGGY = `export function dedupe(items) {
  const out = [];
  for (const item of items) {
    out.push(item);
  }
  return out;
}
`;

const FIXED = `export function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
`;

const BASE_TESTS = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../src/lib.js';

test('keeps distinct items', () => {
  assert.equal(dedupe([{ id: 'a' }, { id: 'b' }]).length, 2);
});

test('handles an empty list', () => {
  assert.equal(dedupe([]).length, 0);
});
`;

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'alibi-test-'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'test'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2),
  );
  writeFileSync(join(dir, 'src/lib.js'), BUGGY);
  writeFileSync(join(dir, 'test/lib.test.js'), BASE_TESTS);
  git(['init', '-q'], dir);
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'base'], dir);
  return dir;
}

test('a test that goes red without the fix has an alibi', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'src/lib.js'), FIXED);
    writeFileSync(
      join(dir, 'test/lib.test.js'),
      `${BASE_TESTS}
test('drops repeated ids', () => {
  assert.equal(dedupe([{ id: 'a' }, { id: 'a' }]).length, 1);
});
`,
    );

    const report = verify({ cwd: dir, suite: false });
    const results = report.results.filter((r) => r.test.name === 'drops repeated ids');
    assert.equal(results.length, 1);
    assert.equal(results[0].verdict, 'alibi');
    assert.equal(report.findings.filter((f) => f.kind === 'no-alibi').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a test that passes without the fix is reported as a green lie', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'src/lib.js'), FIXED);
    writeFileSync(
      join(dir, 'test/lib.test.js'),
      `${BASE_TESTS}
test('returns an array', () => {
  assert.ok(Array.isArray(dedupe([{ id: 'a' }, { id: 'a' }])));
});
`,
    );

    const report = verify({ cwd: dir, suite: false });
    const [result] = report.results.filter((r) => r.test.name === 'returns an array');
    assert.equal(result.verdict, 'none');

    const finding = report.findings.find((f) => f.kind === 'no-alibi');
    assert.ok(finding, 'expected a no-alibi finding');
    assert.equal(finding.severity, 'lie');
    assert.equal(finding.file, 'test/lib.test.js');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the characterization marker keeps a deliberate test out of the verdict', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'src/lib.js'), FIXED);
    writeFileSync(
      join(dir, 'test/lib.test.js'),
      `${BASE_TESTS}
// alibi: characterization
test('returns an array', () => {
  assert.ok(Array.isArray(dedupe([{ id: 'a' }, { id: 'a' }])));
});
`,
    );

    const report = verify({ cwd: dir, suite: false });
    assert.equal(report.findings.filter((f) => f.kind === 'no-alibi').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a test written for a module that does not exist yet is provisional, not proof', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'src/cache.js'), 'export const get = (k) => k;\n');
    writeFileSync(
      join(dir, 'test/cache.test.js'),
      `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from '../src/cache.js';

test('returns the key', () => {
  assert.equal(get('a'), 'a');
});
`,
    );

    const report = verify({ cwd: dir, suite: false });
    const [result] = report.results.filter((r) => r.test.name === 'returns the key');
    assert.equal(result.verdict, 'provisional');
    assert.equal(report.findings.filter((f) => f.kind === 'no-alibi').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a deleted test is read straight out of the diff', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'src/lib.js'), FIXED);
    writeFileSync(
      join(dir, 'test/lib.test.js'),
      `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../src/lib.js';

test('keeps distinct items', () => {
  assert.equal(dedupe([{ id: 'a' }, { id: 'b' }]).length, 2);
});
`,
    );

    const report = verify({ cwd: dir, suite: false });
    const deleted = report.findings.find((f) => f.kind === 'test-deleted');
    assert.ok(deleted, 'expected the deletion to be found');
    assert.equal(deleted.severity, 'lie');
    assert.match(deleted.title, /handles an empty list/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('switching a test off is found even when the suite is green', () => {
  const dir = makeRepo();
  try {
    writeFileSync(
      join(dir, 'test/lib.test.js'),
      BASE_TESTS.replace("test('handles an empty list'", "test.skip('handles an empty list'"),
    );

    const report = verify({ cwd: dir, suite: false });
    const skipped = report.findings.find((f) => f.kind === 'test-skipped');
    assert.ok(skipped, 'expected the skip to be found');
    assert.equal(skipped.severity, 'lie');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claims are judged against evidence, not against their wording', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'src/lib.js'), FIXED);
    writeFileSync(
      join(dir, 'test/lib.test.js'),
      `${BASE_TESTS}
test('returns an array', () => {
  assert.ok(Array.isArray(dedupe([{ id: 'a' }, { id: 'a' }])));
});
`,
    );

    const report = verify({
      cwd: dir,
      suite: false,
      claims: ['[fix] fixed the duplicate bug', '[tests] added a test for it'],
    });

    const fix = report.claims.find((c) => c.claim.tag === 'fix');
    const tests = report.claims.find((c) => c.claim.tag === 'tests');
    assert.equal(fix.status, 'unproven');
    assert.equal(tests.status, 'false');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the working tree is left exactly as it was found', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'src/lib.js'), FIXED);
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });

    verify({ cwd: dir, suite: false, mutate: true });

    const after = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    assert.equal(after, before);
    assert.equal(
      execFileSync('git', ['worktree', 'list'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').length,
      1,
      'the throwaway worktree should be gone',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a mutant nothing objects to is reported', () => {
  const dir = makeRepo();
  try {
    writeFileSync(
      join(dir, 'src/lib.js'),
      `${FIXED}
export function isReady(state) {
  return state.loaded === true && state.warm === true;
}
`,
    );

    const report = verify({ cwd: dir, suite: false, mutate: true, mutants: 3 });
    assert.ok(
      report.findings.some((f) => f.kind === 'mutant-survived'),
      'nothing tests isReady, so a mutant should survive',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
