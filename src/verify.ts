/**
 * Putting the questions in order.
 *
 * The order matters more than it looks. Reading the diff comes first, because
 * a deleted test is a fact that costs nothing to establish. The alibi run
 * comes next, because it is the only check whose answer is produced by the
 * machine rather than inferred from text. The static reading comes last and is
 * never allowed to outrank either of them.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAlibiCheck, keyOf } from './checks/alibi.js';
import { checkRemovals, type RemovalInput } from './checks/removals.js';
import { checkMockedSubject, checkVacuity } from './checks/vacuity.js';
import { planMutants, runMutants } from './checks/mutation.js';
import { judge, readClaims } from './claims.js';
import { isIgnored, languageOf, roleOf } from './classify.js';
import {
  allLines,
  changedPaths,
  copyInto,
  createWorktree,
  fileAtRev,
  linkInto,
  repoRoot,
  resolveRev,
  touchedLines,
} from './git.js';
import { findTests } from './parse.js';
import { findingsFrom } from './report.js';
import { detectRunner, run, runnerById, templateRunner, type Runner } from './runner.js';
import type { ChangedFile, Finding, Report, TestCase } from './types.js';

export const VERSION = '0.1.2';

export interface VerifyOptions {
  cwd: string;
  /** Revision the change is measured against. Defaults to HEAD. */
  base?: string;
  /** Force a runner instead of detecting one. */
  runner?: string;
  /** A shell command template, for runners this tool does not know. */
  command?: string;
  /** Directories to link into the throwaway worktree. */
  link?: string[];
  /** Per-test timeout in milliseconds. */
  timeoutMs?: number;
  /** Run the whole suite once, so that "the suite passes" can be answered. */
  suite?: boolean;
  /** Damage the changed lines and see whether anything objects. */
  mutate?: boolean;
  /** Upper bound on mutants, so a large diff cannot run for an hour. */
  mutants?: number;
  /** Claims given on the command line instead of read from the ledger. */
  claims?: string[];
  onEvent?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { type: 'phase'; name: string }
  | { type: 'test'; name: string; index: number; total: number }
  | { type: 'mutant'; name: string; index: number; total: number };

export class VerifyError extends Error {}

export function verify(options: VerifyOptions): Report {
  const started = Date.now();
  const root = repoRoot(options.cwd);
  const base = resolveRev(options.base ?? 'HEAD', root);
  const emit = options.onEvent ?? (() => {});
  const timeoutMs = options.timeoutMs ?? 120_000;

  const runner = pickRunner(options, root);
  if (!runner) {
    throw new VerifyError(
      'no test runner found. Pass --runner, or put a command in alibi.json — see the README.',
    );
  }

  emit({ type: 'phase', name: 'reading the diff' });
  const changed = describeChanges(base, root);
  const testFiles = changed.filter((f) => f.role === 'test');
  const sourceFiles = changed.filter((f) => f.role === 'source');

  const removalInputs: RemovalInput[] = testFiles.map((file) => ({
    file,
    before: file.status === 'A' ? null : fileAtRev(base, file.from ?? file.path, root),
    after: file.status === 'D' ? null : readIfExists(join(root, file.path)),
  }));
  const findings: Finding[] = checkRemovals(removalInputs);

  const targets = newOrChangedTests(removalInputs);

  emit({ type: 'phase', name: 'checking alibis' });
  const alibi = runAlibiCheck(targets, changed, {
    root,
    base,
    runner,
    link: options.link ?? [],
    timeoutMs,
    onProgress: (test, index, total) =>
      emit({ type: 'test', name: [...test.suite, test.name].join(' › '), index, total }),
  });

  findings.push(...findingsFrom(alibi.results));
  findings.push(...checkVacuity(targets));
  findings.push(
    ...checkMockedSubject(
      removalInputs
        .filter((input) => input.after !== null)
        .map((input) => ({ path: input.file.path, content: input.after as string })),
      changed,
    ),
  );

  let suiteExitCode: number | null = null;
  if (options.suite !== false && targets.length >= 0) {
    emit({ type: 'phase', name: 'running the suite' });
    const outcome = run(runner.all(), root, timeoutMs * 10);
    suiteExitCode = outcome.exitCode;
    if (suiteExitCode !== 0) {
      findings.push({
        kind: 'suite-failing',
        severity: 'lie',
        title: `the suite does not pass — it exits ${suiteExitCode}`,
        file: '.',
        line: 0,
        evidence: outcome.stdout.split('\n').slice(-3).join(' ').trim().slice(0, 200),
      });
    }
  }

  if (options.mutate) {
    emit({ type: 'phase', name: 'mutating the change' });
    findings.push(
      ...mutationPass(sourceFiles, targets, {
        root,
        base,
        changed,
        runner,
        timeoutMs,
        limit: options.mutants ?? 8,
        link: options.link ?? [],
        emit,
      }),
    );
  }

  const claims = readClaims(root, options.claims);
  const claimResults = judge(claims, {
    results: alibi.results,
    findings,
    suiteExitCode,
    hadSourceChange: alibi.hadSourceChange,
  });

  return {
    version: VERSION,
    base,
    runner: runner.label,
    testsExamined: alibi.results.filter((r) => r.verdict !== 'skipped').length,
    results: alibi.results,
    findings,
    claims: claimResults,
    durationMs: Date.now() - started,
    suiteExitCode,
  };
}

function pickRunner(options: VerifyOptions, root: string): Runner | null {
  if (options.command) return templateRunner(options.command, options.link ?? []);
  if (options.runner) {
    const runner = runnerById(options.runner, root);
    if (!runner) throw new VerifyError(`unknown runner "${options.runner}"`);
    return runner;
  }
  return detectRunner(root);
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function describeChanges(base: string, root: string): ChangedFile[] {
  return changedPaths(base, root)
    .filter((entry) => !isIgnored(entry.path))
    .map((entry) => ({
      ...entry,
      role: roleOf(entry.path),
      language: languageOf(entry.path),
    }))
    .filter((file) => file.role !== 'other');
}

/**
 * Tests worth asking about: the ones this change introduced, and the ones it
 * rewrote. A test that the diff did not touch already had whatever alibi it
 * was going to have, and re-litigating it would bury the new evidence.
 */
function newOrChangedTests(inputs: RemovalInput[]): TestCase[] {
  const out: TestCase[] = [];

  for (const input of inputs) {
    if (input.after === null) continue;
    const after = findTests(input.file.path, input.after, input.file.language);
    if (after.length === 0) continue;

    if (input.before === null) {
      out.push(...after);
      continue;
    }

    const before = new Map(
      findTests(input.file.path, input.before, input.file.language).map((t) => [keyOf(t), normalise(t.body)]),
    );
    for (const test of after) {
      const previous = before.get(keyOf(test));
      if (previous === undefined || previous !== normalise(test.body)) out.push(test);
    }
  }

  return out;
}

/** Whitespace is not a change worth re-running a test for. */
function normalise(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

interface MutationPassOptions {
  root: string;
  base: string;
  changed: ChangedFile[];
  runner: Runner;
  timeoutMs: number;
  limit: number;
  link: string[];
  emit: (event: ProgressEvent) => void;
}

/**
 * The mutation pass needs the world as it is after the change, not before, so
 * it builds a second worktree and copies the whole diff into it. Mutating the
 * user's own files would be faster and is not worth the class of accident it
 * invites.
 */
function mutationPass(
  sourceFiles: ChangedFile[],
  tests: TestCase[],
  options: MutationPassOptions,
): Finding[] {
  if (sourceFiles.length === 0) return [];

  const worktree = createWorktree(options.base, options.root);
  try {
    for (const path of [...options.runner.linkPaths, ...options.link]) {
      linkInto(worktree.dir, options.root, path);
    }
    for (const file of options.changed) {
      if (file.status === 'D') continue;
      copyInto(worktree.dir, options.root, file.path);
    }

    const mutants = [];
    let budget = options.limit;
    for (const file of sourceFiles) {
      if (budget <= 0) break;
      const content = readIfExists(join(options.root, file.path));
      if (content === null) continue;
      const lines =
        file.status === 'A' ? allLines(content) : touchedLines(options.base, file.path, options.root);
      const planned = planMutants(file.path, content, lines, budget);
      mutants.push(...planned);
      budget -= planned.length;
    }

    return runMutants(mutants, tests, {
      dir: worktree.dir,
      runner: options.runner,
      timeoutMs: options.timeoutMs,
      onProgress: (mutant, index, total) =>
        options.emit({ type: 'mutant', name: `${mutant.file}:${mutant.line}`, index, total }),
    });
  } finally {
    worktree.dispose();
  }
}
