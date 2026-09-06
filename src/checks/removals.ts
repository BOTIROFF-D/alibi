/**
 * Tests that stopped existing.
 *
 * The cheapest way to make a suite green is to make the red part go away, and
 * it happens more often than anyone likes to admit: a deleted case, a `skip`
 * added on the line above, an assertion softened until it stops disagreeing.
 * None of this is inference. It is read straight out of the diff, which is why
 * these findings carry the same weight as an executed one.
 */

import { findTests } from '../parse.js';
import type { ChangedFile, Finding, TestCase } from '../types.js';

const ASSERTION_COUNTERS = [
  /\bexpect\s*\(/g,
  /\bassert\b/g,
  /\bassert[A-Z]\w*\s*\(/g,
  /\bt\.(Error|Fatal|Errorf|Fatalf)\b/g,
  /\brequire\.\w+\(/g,
  /\bassert\.\w+\(/g,
];

function countAssertions(body: string): number {
  return ASSERTION_COUNTERS.reduce((total, re) => total + (body.match(re) ?? []).length, 0);
}

function identity(test: TestCase): string {
  return [...test.suite, test.name].join(' › ');
}

export interface RemovalInput {
  file: ChangedFile;
  /** Content at the base revision, or null when the file is new. */
  before: string | null;
  /** Content in the working tree, or null when the file was deleted. */
  after: string | null;
}

export function checkRemovals(inputs: RemovalInput[]): Finding[] {
  const findings: Finding[] = [];

  for (const input of inputs) {
    if (input.before === null) continue;

    const before = findTests(input.file.from ?? input.file.path, input.before, input.file.language);
    if (before.length === 0) continue;

    if (input.after === null) {
      for (const test of before) {
        findings.push({
          kind: 'test-deleted',
          severity: 'lie',
          title: `"${identity(test)}" was deleted with its file`,
          file: input.file.path,
          line: test.line,
          evidence: `${input.file.path} existed at the base revision and no longer does`,
        });
      }
      continue;
    }

    const after = findTests(input.file.path, input.after, input.file.language);
    const afterByName = new Map(after.map((t) => [identity(t), t]));

    for (const old of before) {
      const now = afterByName.get(identity(old));

      if (!now) {
        findings.push({
          kind: 'test-deleted',
          severity: 'lie',
          title: `"${identity(old)}" was deleted`,
          file: input.file.path,
          line: old.line,
          evidence: 'present at the base revision, absent in the working tree',
        });
        continue;
      }

      if (!old.skipped && now.skipped) {
        findings.push({
          kind: 'test-skipped',
          severity: 'lie',
          title: `"${identity(now)}" was switched off`,
          file: input.file.path,
          line: now.line,
          evidence: 'the test ran at the base revision and is now declared skipped',
        });
        continue;
      }

      const wasAsserting = countAssertions(old.body);
      const isAsserting = countAssertions(now.body);
      if (wasAsserting > 0 && isAsserting < wasAsserting) {
        findings.push({
          kind: 'assertion-weakened',
          severity: 'unproven',
          title: `"${identity(now)}" lost ${wasAsserting - isAsserting} of its ${wasAsserting} assertions`,
          file: input.file.path,
          line: now.line,
          evidence: `${wasAsserting} assertions at the base revision, ${isAsserting} now`,
        });
      }
    }
  }

  return findings;
}
