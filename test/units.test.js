import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleOf, languageOf, isIgnored } from '../dist/classify.js';
import { checkVacuity, checkMockedSubject } from '../dist/checks/vacuity.js';
import { checkRemovals } from '../dist/checks/removals.js';
import { judge, readClaims } from '../dist/claims.js';
import { exitCodeFor, toJson, toMarkdown, render } from '../dist/report.js';
import { parseArgs } from '../dist/cli.js';
import { planMutants } from '../dist/checks/mutation.js';
import { firstEvidence, neverRan, detectRunner } from '../dist/runner.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a file under a test directory is a test wherever it is', () => {
  assert.equal(roleOf('test/lib.test.js'), 'test');
  assert.equal(roleOf('packages/core/__tests__/a.js'), 'test');
  assert.equal(roleOf('app/tests/deep/nested/thing.py'), 'test');
  assert.equal(roleOf('src/lib.js'), 'source');
  assert.equal(roleOf('src/store_test.go'), 'test');
  assert.equal(roleOf('README.md'), 'other');
  assert.equal(roleOf('package-lock.json'), 'other');
});

test('generated and vendored paths are ignored outright', () => {
  assert.ok(isIgnored('node_modules/x/index.js'));
  assert.ok(isIgnored('dist/main.js'));
  assert.ok(isIgnored('docs/guide.md'));
  assert.ok(!isIgnored('src/main.js'));
});

test('languages come from the extension', () => {
  assert.equal(languageOf('a/b.tsx'), 'ts');
  assert.equal(languageOf('a/b.py'), 'python');
  assert.equal(languageOf('a/b.unknown'), 'unknown');
});

function testCase(name, body, file = 'test/a.test.js') {
  return { name, file, line: 1, language: 'js', suite: [], skipped: false, exempt: false, body };
}

test('an assertion that cannot fail is reported, and never as a lie', () => {
  const findings = checkVacuity([testCase('x', 'expect(true).toBe(true);')]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'vacuous-assertion');
  assert.equal(findings[0].severity, 'unproven');
});

test('a test with no assertion at all is reported', () => {
  const findings = checkVacuity([testCase('x', 'const result = build();')]);
  assert.equal(findings[0].kind, 'no-assertion');
});

test('a lone existence check is reported, several assertions are not', () => {
  const shallow = checkVacuity([testCase('x', 'expect(result).toBeDefined();')]);
  assert.equal(shallow[0].kind, 'vacuous-assertion');

  const real = checkVacuity([
    testCase('x', 'expect(result).toBeDefined();\nexpect(result.id).toBe("a");'),
  ]);
  assert.equal(real.length, 0);
});

test('an assertion in a comment does not count as an assertion', () => {
  const findings = checkVacuity([testCase('x', '// expect(a).toBe(b)\nconst r = run();')]);
  assert.equal(findings[0].kind, 'no-assertion');
});

test('mocking the file that changed is reported, from anywhere in the file', () => {
  const findings = checkMockedSubject(
    [
      {
        path: 'test/a.test.js',
        content: "import { vi } from 'vitest';\nvi.mock('../src/sessions.js');\n\nit('x', () => {});",
      },
    ],
    [{ path: 'src/sessions.js', status: 'M', role: 'source', language: 'js' }],
  );
  assert.equal(findings[0].kind, 'subject-mocked');
  assert.equal(findings[0].line, 2);
});

test('a removed assertion is noticed even when the test still exists', () => {
  const before = `it('checks', () => {
  expect(a).toBe(1);
  expect(b).toBe(2);
});`;
  const after = `it('checks', () => {
  expect(a).toBe(1);
});`;
  const findings = checkRemovals([
    {
      file: { path: 'test/a.test.js', status: 'M', role: 'test', language: 'js' },
      before,
      after,
    },
  ]);
  assert.equal(findings[0].kind, 'assertion-weakened');
  assert.match(findings[0].title, /lost 1 of its 2/);
});

test('deleting the whole file accuses every test in it', () => {
  const before = `it('one', () => { expect(1).toBe(1); });\nit('two', () => { expect(2).toBe(2); });`;
  const findings = checkRemovals([
    { file: { path: 'test/a.test.js', status: 'D', role: 'test', language: 'js' }, before, after: null },
  ]);
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.severity === 'lie'));
});

const noEvidence = { results: [], findings: [], suiteExitCode: null, hadSourceChange: true };

test('a claim about speed is never graded here', () => {
  const [result] = judge([{ tag: 'perf', text: 'twice as fast', line: 1 }], noEvidence);
  assert.equal(result.status, 'unproven');
  assert.match(result.reason, /benchmark/);
});

test('a claim that the suite passes is false when the suite fails', () => {
  const [result] = judge([{ tag: 'pass', text: 'all green', line: 1 }], {
    ...noEvidence,
    suiteExitCode: 1,
  });
  assert.equal(result.status, 'false');
});

test('a green suite bought by deleting a test is still false', () => {
  const [result] = judge([{ tag: 'pass', text: 'all green', line: 1 }], {
    ...noEvidence,
    suiteExitCode: 0,
    findings: [
      { kind: 'test-deleted', severity: 'lie', title: 'x was deleted', file: 'test/a.js', line: 3, evidence: '' },
    ],
  });
  assert.equal(result.status, 'false');
  assert.match(result.reason, /stopped existing/);
});

test('a fix claim needs a test that fails without the fix', () => {
  const [unproven] = judge([{ tag: 'fix', text: 'fixed it', line: 1 }], noEvidence);
  assert.equal(unproven.status, 'unproven');

  const [proven] = judge([{ tag: 'fix', text: 'fixed it', line: 1 }], {
    ...noEvidence,
    results: [
      {
        test: testCase('x', ''),
        verdict: 'alibi',
        exitCode: 1,
        durationMs: 1,
        evidence: 'AssertionError',
      },
    ],
  });
  assert.equal(proven.status, 'proven');
});

test('a fix claim is false when the diff changes no source', () => {
  const [result] = judge([{ tag: 'fix', text: 'fixed it', line: 1 }], {
    ...noEvidence,
    hadSourceChange: false,
  });
  assert.equal(result.status, 'false');
});

test('claims are read from a markdown list, tagged or not', () => {
  const claims = readClaims('/nonexistent', ['[tests] added a case', 'something untagged']);
  assert.deepEqual(
    claims.map((c) => c.tag),
    ['tests', 'other'],
  );
});

const report = {
  version: '0.1.0',
  base: 'abcdef1234',
  runner: 'node --test',
  testsExamined: 2,
  results: [
    {
      test: testCase('returns a list', ''),
      verdict: 'none',
      exitCode: 0,
      durationMs: 10,
      evidence: 'passes against the source from before the change',
    },
  ],
  findings: [
    {
      kind: 'no-alibi',
      severity: 'lie',
      title: '"returns a list" passes without the change it was written for',
      file: 'test/a.test.js',
      line: 14,
      evidence: '',
    },
  ],
  claims: [],
  durationMs: 400,
  suiteExitCode: 0,
};

test('a green lie makes the command fail', () => {
  assert.equal(exitCodeFor(report, false), 1);
});

test('strict mode separates unproven from false', () => {
  const soft = {
    ...report,
    findings: [{ ...report.findings[0], kind: 'vacuous-assertion', severity: 'unproven' }],
  };
  assert.equal(exitCodeFor(soft, false), 0);
  assert.equal(exitCodeFor(soft, true), 2);
});

test('the json report keeps its summary shape', () => {
  const parsed = JSON.parse(toJson(report));
  assert.equal(parsed.tool, 'alibi');
  assert.equal(parsed.summary.withoutAlibi, 1);
  assert.equal(parsed.summary.greenLies, 1);
  assert.equal(parsed.tests[0].verdict, 'none');
});

test('the markdown report names the file and line', () => {
  assert.match(toMarkdown(report), /test\/a\.test\.js:14/);
});

test('the terminal report prints without colour when asked', () => {
  const text = render(report, { color: false, verbose: false });
  assert.doesNotMatch(text, /\[/);
  assert.match(text, /NO ALIBI/);
});

test('the command line rejects an option it does not know', () => {
  assert.throws(() => parseArgs(['verify', '--nope']), /unknown option/);
});

test('the command line reads the flags it does know', () => {
  const flags = parseArgs(['verify', '--base', 'main', '--mutate', '--claim', '[fix] x', '--json']);
  assert.equal(flags.base, 'main');
  assert.equal(flags.mutate, true);
  assert.deepEqual(flags.claims, ['[fix] x']);
  assert.equal(flags.color, false);
});

test('mutants are planned only for the lines the change touched', () => {
  const source = ['const a = 1;', 'if (x === y) { run(); }', 'const b = 2;'].join('\n');
  const mutants = planMutants('src/a.js', source, [2], 5);
  assert.equal(mutants.length, 1);
  assert.equal(mutants[0].line, 2);
  assert.match(mutants[0].after, /!==/);
});

test('comments are never mutated', () => {
  const source = ['// if (a === b) matters', 'const x = 1;'].join('\n');
  assert.deepEqual(planMutants('src/a.js', source, [1, 2], 5), []);
});

test('the evidence line skips a runner\u2019s decoration and quotes the failure', () => {
  const outcome = {
    exitCode: 1,
    stdout: [
      '=================================== FAILURES ===================================',
      '________________________ test_drops_repeated_ids ________________________',
      '',
      'E       assert 2 == 1',
      '',
      '=========================== short test summary info ============================',
    ].join('\n'),
    stderr: '',
    durationMs: 1,
    timedOut: false,
  };
  assert.equal(firstEvidence(outcome), 'E       assert 2 == 1');
});

/*
 * The precedence between the two lists in `neverRan` is the load-bearing part.
 * A test that genuinely failed but whose message happens to contain a phrase
 * from the never-ran list would otherwise be dropped from every count it
 * belonged in — and silently, which is the worst way to be wrong here.
 */
const outcomeOf = (text) => ({ stdout: text, stderr: '', exitCode: 1, durationMs: 1, timedOut: false });

test('a test that reached an assertion is never called provisional', () => {
  assert.equal(neverRan(outcomeOf('AssertionError: expected 2 to equal 1')), false);
  assert.equal(neverRan(outcomeOf('E       assert 2 == 1')), false);
  assert.equal(neverRan(outcomeOf('--- FAIL: TestDedupe (0.00s)')), false);
});

test('a failure message may quote the words that mean "never ran"', () => {
  assert.equal(neverRan(outcomeOf("AssertionError: expected 'undefined: value' to equal 'ok'")), false);
  assert.equal(neverRan(outcomeOf('AssertionError: expected callback is not a function')), false);
});

test('a run that stopped before any check is provisional', () => {
  assert.equal(neverRan(outcomeOf("Error: Cannot find module '../src/cache.js'")), true);
  assert.equal(neverRan(outcomeOf('ModuleNotFoundError: No module named \'src.cache\'')), true);
  assert.equal(neverRan(outcomeOf('./store_test.go:9:12: undefined: Dedupe')), true);
  assert.equal(neverRan(outcomeOf('TypeError: dedupe is not a function')), true);
  assert.equal(neverRan(outcomeOf('collected 0 items')), true);
});

test('a python project with only a tests directory still gets a runner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alibi-detect-'));
  try {
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests', 'test_thing.py'), 'def test_x():\n    assert 1 == 1\n');
    writeFileSync(join(dir, 'README.md'), '# nothing else here\n');
    assert.equal(detectRunner(dir)?.id, 'pytest');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a declared dependency still beats a filename convention', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alibi-detect-'));
  try {
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests', 'test_thing.py'), 'def test_x():\n    assert 1 == 1\n');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'x', devDependencies: { vitest: '^2' } }),
    );
    assert.equal(detectRunner(dir)?.id, 'vitest');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a repository with nothing that looks like a test gets no runner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alibi-detect-'));
  try {
    writeFileSync(join(dir, 'main.c'), 'int main(void) { return 0; }\n');
    assert.equal(detectRunner(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('node_modules is not walked looking for tests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alibi-detect-'));
  try {
    mkdirSync(join(dir, 'node_modules', 'dep', 'tests'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'dep', 'tests', 'test_dep.py'), 'def test_x(): pass\n');
    writeFileSync(join(dir, 'main.c'), 'int main(void) { return 0; }\n');
    assert.equal(detectRunner(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
