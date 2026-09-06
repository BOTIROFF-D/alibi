/**
 * The alibi check.
 *
 * One question, asked of the machine rather than of a model: put the source
 * back the way it was, keep the tests exactly as they were written, and see
 * which of them still pass. A test that passes against the code from before
 * the change has not tested the change. It may be a fine test of something
 * else — that is what the characterization marker is for — but it is not
 * evidence for the sentence "I fixed it".
 *
 * Nothing about this needs a language model, an API key or a network. It
 * needs a revision and a test runner, and it gives the same answer every time.
 */

import { copyInto, createWorktree, linkInto } from '../git.js';
import { firstEvidence, neverRan, run, type Runner } from '../runner.js';
import type { AlibiResult, ChangedFile, TestCase } from '../types.js';

export interface AlibiOptions {
  root: string;
  base: string;
  runner: Runner;
  /** Extra directories to link into the throwaway worktree. */
  link: string[];
  /** Per-test timeout. A test that hangs against old code is not an alibi. */
  timeoutMs: number;
  /** Called before each test so the caller can draw progress. */
  onProgress?: (test: TestCase, index: number, total: number) => void;
}

export interface AlibiRun {
  results: AlibiResult[];
  /** False when the change touched no source at all, which makes the run moot. */
  hadSourceChange: boolean;
  /** Paths the run could not put back, e.g. Rust files with inline tests. */
  unverifiable: string[];
}

export function runAlibiCheck(
  tests: TestCase[],
  changed: ChangedFile[],
  options: AlibiOptions,
): AlibiRun {
  const sourceChanges = changed.filter((f) => f.role === 'source');
  const testChanges = changed.filter((f) => f.role === 'test');
  const unverifiable: string[] = [];

  if (tests.length === 0) {
    return { results: [], hadSourceChange: sourceChanges.length > 0, unverifiable };
  }

  const worktree = createWorktree(options.base, options.root);
  const results: AlibiResult[] = [];

  try {
    for (const path of [...options.runner.linkPaths, ...options.link]) {
      linkInto(worktree.dir, options.root, path);
    }

    /*
     * The worktree starts as the world before the change. Copying the new
     * tests over it is the whole trick: new tests, old source, nothing else
     * moved.
     */
    for (const file of testChanges) {
      if (file.status === 'D') continue;
      copyInto(worktree.dir, options.root, file.path);
    }

    let index = 0;
    for (const test of tests) {
      index++;
      options.onProgress?.(test, index, tests.length);

      if (test.skipped) {
        results.push({ test, verdict: 'skipped', exitCode: null, durationMs: 0, evidence: 'declared skipped' });
        continue;
      }

      const outcome = run(options.runner.one(test), worktree.dir, options.timeoutMs);

      if (outcome.timedOut) {
        results.push({
          test,
          verdict: 'error',
          exitCode: outcome.exitCode,
          durationMs: outcome.durationMs,
          evidence: `timed out after ${Math.round(options.timeoutMs / 1000)}s against the old source`,
        });
        continue;
      }

      if (outcome.exitCode === 0) {
        results.push({
          test,
          verdict: 'none',
          exitCode: 0,
          durationMs: outcome.durationMs,
          evidence: 'passes against the source from before the change',
        });
        continue;
      }

      results.push({
        test,
        verdict: neverRan(outcome) ? 'provisional' : 'alibi',
        exitCode: outcome.exitCode,
        durationMs: outcome.durationMs,
        evidence: firstEvidence(outcome),
      });
    }
  } finally {
    worktree.dispose();
  }

  return { results, hadSourceChange: sourceChanges.length > 0, unverifiable };
}

/**
 * Runs the same tests where they live, to find out whether they pass at all.
 *
 * Without this the report could accuse a test of having no alibi when in fact
 * it is failing right now, which is a different and louder problem.
 */
export function runCurrent(
  tests: TestCase[],
  options: Pick<AlibiOptions, 'root' | 'runner' | 'timeoutMs' | 'onProgress'>,
): Map<string, { passes: boolean; evidence: string }> {
  const out = new Map<string, { passes: boolean; evidence: string }>();
  let index = 0;
  for (const test of tests) {
    index++;
    options.onProgress?.(test, index, tests.length);
    if (test.skipped) continue;
    const outcome = run(options.runner.one(test), options.root, options.timeoutMs);
    out.set(keyOf(test), {
      passes: outcome.exitCode === 0,
      evidence: outcome.exitCode === 0 ? '' : firstEvidence(outcome),
    });
  }
  return out;
}

export function keyOf(test: TestCase): string {
  return `${test.file}::${[...test.suite, test.name].join('::')}`;
}
