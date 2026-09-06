/**
 * Assertions that cannot fail.
 *
 * Everything in this file is read, not run, and that limits what it is allowed
 * to conclude. A static reading can be wrong about intent in a way an executed
 * revert cannot, so nothing here ever reports a lie: the strongest verdict a
 * pattern match can produce is `unproven`. The line between "the machine saw
 * it" and "a regex thought so" is the reason anyone should trust the other
 * half of this tool.
 */

import type { ChangedFile, Finding, TestCase } from '../types.js';

interface Pattern {
  re: RegExp;
  title: string;
}

/** Assertions whose truth is independent of the code under test. */
const ALWAYS_TRUE: Pattern[] = [
  { re: /\bexpect\(\s*(true|1|!!1)\s*\)\s*\.\s*(toBe|toEqual|toBeTruthy)/, title: 'asserts a literal' },
  { re: /\bassert(\.ok)?\(\s*true\s*\)/, title: 'asserts a literal' },
  { re: /\bassert\s+True\s*$/m, title: 'asserts a literal' },
  { re: /\bassertTrue\(\s*True\s*\)/, title: 'asserts a literal' },
  { re: /\bexpect\(\s*([\w.]+)\s*\)\s*\.\s*toBe\(\s*\1\s*\)/, title: 'compares a value with itself' },
  { re: /\bassert\s+([\w.]+)\s*==\s*\1\s*$/m, title: 'compares a value with itself' },
  { re: /\bassert!\(\s*true\s*\)/, title: 'asserts a literal' },
  { re: /\bexpect\(\s*\)\s*\.\s*pass\b/, title: 'asserts nothing' },
];

/**
 * Assertions that are real but say almost nothing on their own. Flagged only
 * when they are the entire evidence of a test.
 */
const SHALLOW: Pattern[] = [
  { re: /\.\s*(toBeDefined|toBeTruthy|toBeFalsy|not\s*\.\s*toBeNull|not\s*\.\s*toBeUndefined)\s*\(/, title: 'only checks that something exists' },
  { re: /\bassert\s+[\w.()\[\]]+\s+is\s+not\s+None\s*$/m, title: 'only checks that something exists' },
  { re: /\bassertIsNotNone\(/, title: 'only checks that something exists' },
  { re: /\.\s*toMatchSnapshot\s*\(/, title: 'only compares against a snapshot it just wrote' },
  { re: /\bexpect\([\w.]+\)\s*\.\s*toBeInstanceOf\(/, title: 'only checks a type' },
  { re: /\bassert\s+isinstance\(/, title: 'only checks a type' },
  { re: /\bexpect\(\s*typeof\s+[\w.]+\s*\)/, title: 'only checks a type' },
];

/** Anything that looks like a check being made. */
const ASSERTION = [
  /\bexpect\s*\(/,
  /\bassert\b/,
  /\bassert[A-Z]\w*\s*\(/,
  /\bshould\b/,
  /\bt\.(Error|Fatal|Errorf|Fatalf)\b/,
  /\brequire\.\w+\(/,
  /\bassert\.\w+\(/,
  /\bverify\s*\(/,
  /\.to\s*\.\s*(equal|eql|be)\b/,
  /\bassert_[a-z]+\b/,
];

/** Swallowing the failure the test was written to catch. */
const SWALLOWED: Pattern[] = [
  { re: /except[^\n:]*:\s*(\n\s+)?(pass|\.\.\.)\s*$/m, title: 'swallows the exception it provokes' },
  { re: /catch\s*(\([^)]*\))?\s*\{\s*\}/, title: 'swallows the exception it provokes' },
  { re: /\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/, title: 'swallows a rejected promise' },
];

function firstMatch(body: string, patterns: Pattern[]): Pattern | null {
  for (const pattern of patterns) {
    if (pattern.re.test(body)) return pattern;
  }
  return null;
}

function hasAssertion(body: string): boolean {
  return ASSERTION.some((re) => re.test(body));
}

/** Strips comments and string literals so a pattern cannot match prose. */
function stripNoise(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/.*$/gm, ' ')
    .replace(/(^|\s)#.*$/gm, ' ')
    .replace(/"""[\s\S]*?"""/g, ' ');
}

/**
 * Names the change touched, so that a test which mocks the very thing that was
 * changed can be pointed out. Mocking the subject is how a test keeps passing
 * no matter what the subject does.
 */
function subjectNames(changed: ChangedFile[]): string[] {
  return changed
    .filter((f) => f.role === 'source')
    .map((f) => {
      const base = f.path.split('/').pop() ?? '';
      return base.replace(/\.[^.]+$/, '');
    })
    .filter((name) => name.length > 2 && name !== 'index' && name !== 'main' && name !== 'mod');
}

export function checkVacuity(tests: TestCase[]): Finding[] {
  const findings: Finding[] = [];

  for (const test of tests) {
    const body = stripNoise(test.body);

    const alwaysTrue = firstMatch(body, ALWAYS_TRUE);
    if (alwaysTrue) {
      findings.push({
        kind: 'vacuous-assertion',
        severity: 'unproven',
        title: `"${test.name}" ${alwaysTrue.title}`,
        file: test.file,
        line: test.line,
        evidence: excerpt(body, alwaysTrue.re),
      });
      continue;
    }

    if (!hasAssertion(body)) {
      findings.push({
        kind: 'no-assertion',
        severity: 'unproven',
        title: `"${test.name}" makes no assertion`,
        file: test.file,
        line: test.line,
        evidence: 'the test can only fail by throwing',
      });
      continue;
    }

    const swallowed = firstMatch(body, SWALLOWED);
    if (swallowed) {
      findings.push({
        kind: 'vacuous-assertion',
        severity: 'unproven',
        title: `"${test.name}" ${swallowed.title}`,
        file: test.file,
        line: test.line,
        evidence: excerpt(body, swallowed.re),
      });
    }

    const shallow = firstMatch(body, SHALLOW);
    if (shallow && countAssertions(body) === 1) {
      findings.push({
        kind: 'vacuous-assertion',
        severity: 'unproven',
        title: `"${test.name}" ${shallow.title}`,
        file: test.file,
        line: test.line,
        evidence: excerpt(body, shallow.re),
      });
    }

  }

  return findings;
}

function countAssertions(body: string): number {
  let count = 0;
  for (const re of ASSERTION) {
    const global = new RegExp(re.source, 'g');
    count += (body.match(global) ?? []).length;
  }
  return count;
}

function excerpt(body: string, re: RegExp): string {
  const match = re.exec(body);
  if (!match) return '';
  const line = body.slice(0, match.index).split('\n').length;
  const text = (body.split('\n')[line - 1] ?? match[0]).trim();
  return text.slice(0, 160);
}

/**
 * A mock of the thing that changed.
 *
 * This one is looked for in the whole file rather than inside a test body,
 * because that is where mocks are declared: one `jest.mock` at the top of a
 * file governs every test below it. Reading only the bodies would miss the
 * common case entirely, which it did until an exhibit in the museum said so.
 */
export function checkMockedSubject(
  files: { path: string; content: string }[],
  changed: ChangedFile[],
): Finding[] {
  const subjects = subjectNames(changed);
  if (subjects.length === 0) return [];

  const findings: Finding[] = [];
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const subject of subjects) {
      const mocked = new RegExp(
        `(jest|vi)\\.mock\\(\\s*['"\`][^'"\`]*${subject}` +
          `|(mock\\.)?patch\\(\\s*['"][^'"]*${subject}` +
          `|mock\\.module\\(\\s*['"\`][^'"\`]*${subject}`,
      );
      const index = lines.findIndex((line) => mocked.test(line));
      if (index === -1) continue;

      findings.push({
        kind: 'subject-mocked',
        severity: 'unproven',
        title: `${file.path} mocks ${subject}, which is what this change touched`,
        file: file.path,
        line: index + 1,
        evidence: (lines[index] ?? '').trim().slice(0, 160),
      });
      break;
    }
  }
  return findings;
}
