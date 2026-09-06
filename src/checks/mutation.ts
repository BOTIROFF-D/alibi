/**
 * The second question, asked the other way round.
 *
 * The alibi check asks whether a new test would have failed before the change.
 * This one asks whether any test would notice if the change were wrong: the
 * changed lines are damaged, one small edit at a time, and the suite is given
 * a chance to object. A mutant that survives is a line nothing is watching.
 *
 * It is off by default because it costs one test run per mutant, and because
 * the alibi check answers the more important question first. Turn it on when
 * the change is one you would not want to be wrong about.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, type Runner } from '../runner.js';
import type { Finding, TestCase } from '../types.js';

interface Operator {
  name: string;
  find: RegExp;
  replace: string;
}

/*
 * Every operator here changes meaning without changing shape: the mutant still
 * parses, so a surviving mutant is evidence about the tests rather than about
 * the compiler.
 */
const OPERATORS: Operator[] = [
  { name: 'strict equality flipped', find: /===/, replace: '!==' },
  { name: 'inequality flipped', find: /!==/, replace: '===' },
  { name: 'equality flipped', find: /([^=!<>])==([^=])/, replace: '$1!=$2' },
  { name: 'comparison relaxed', find: /([^<>=!])<([^<=])/, replace: '$1<=$2' },
  { name: 'comparison relaxed', find: /([^<>=!])>([^>=])/, replace: '$1>=$2' },
  { name: 'conjunction weakened', find: /&&/, replace: '||' },
  { name: 'disjunction strengthened', find: /\|\|/, replace: '&&' },
  { name: 'conjunction weakened', find: /\band\b/, replace: 'or' },
  { name: 'boolean inverted', find: /\btrue\b/, replace: 'false' },
  { name: 'boolean inverted', find: /\bTrue\b/, replace: 'False' },
  { name: 'guard removed', find: /\bif\s*\(\s*!/, replace: 'if (' },
];

export interface Mutant {
  file: string;
  line: number;
  operator: string;
  before: string;
  after: string;
}

/** Builds at most `limit` mutants from the lines the change added or touched. */
export function planMutants(
  file: string,
  content: string,
  touchedLines: number[],
  limit: number,
): Mutant[] {
  const lines = content.split(/\r?\n/);
  const mutants: Mutant[] = [];

  for (const lineNumber of touchedLines) {
    const text = lines[lineNumber - 1];
    if (text === undefined) continue;
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
      continue;
    }

    for (const operator of OPERATORS) {
      if (!operator.find.test(text)) continue;
      mutants.push({
        file,
        line: lineNumber,
        operator: operator.name,
        before: trimmed.slice(0, 120),
        after: text.replace(operator.find, operator.replace).trim().slice(0, 120),
      });
      break;
    }
    if (mutants.length >= limit) break;
  }

  return mutants;
}

export interface MutationOptions {
  /** A worktree already holding the post-change state. */
  dir: string;
  runner: Runner;
  timeoutMs: number;
  onProgress?: (mutant: Mutant, index: number, total: number) => void;
}

/**
 * Applies each mutant in turn and runs the tests that ought to catch it. The
 * file is restored after every attempt, so one surviving mutant cannot hide
 * the next.
 */
export function runMutants(
  mutants: Mutant[],
  tests: TestCase[],
  options: MutationOptions,
): Finding[] {
  const findings: Finding[] = [];
  let index = 0;

  for (const mutant of mutants) {
    index++;
    options.onProgress?.(mutant, index, mutants.length);

    const path = join(options.dir, mutant.file);
    const original = readFileSync(path, 'utf8');
    const lines = original.split(/\r?\n/);
    const operator = OPERATORS.find((o) => o.name === mutant.operator);
    if (!operator) continue;

    const target = lines[mutant.line - 1];
    if (target === undefined) continue;
    lines[mutant.line - 1] = target.replace(operator.find, operator.replace);

    let caught = false;
    try {
      writeFileSync(path, lines.join('\n'));
      const candidates = tests.length > 0 ? tests : [];
      if (candidates.length === 0) {
        const outcome = run(options.runner.all(), options.dir, options.timeoutMs * 4);
        caught = outcome.exitCode !== 0;
      } else {
        for (const test of candidates) {
          if (test.skipped) continue;
          const outcome = run(options.runner.one(test), options.dir, options.timeoutMs);
          if (outcome.exitCode !== 0) {
            caught = true;
            break;
          }
        }
      }
    } finally {
      writeFileSync(path, original);
    }

    if (!caught) {
      findings.push({
        kind: 'mutant-survived',
        severity: 'unproven',
        title: `nothing fails when ${mutant.file}:${mutant.line} has its ${mutant.operator}`,
        file: mutant.file,
        line: mutant.line,
        evidence: `${mutant.before}  →  ${mutant.after}`,
      });
    }
  }

  return findings;
}
