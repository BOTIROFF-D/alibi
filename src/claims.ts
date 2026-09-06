/**
 * The ledger.
 *
 * An agent finishes by claiming things. The claims are written down in a file
 * before the work is handed over, in a shape narrow enough that each one maps
 * to a check that has already run. Nothing here reads English: the tag decides
 * which evidence applies, and the sentence after it is only there for the
 * human reading the report.
 *
 * Claims with no machine check behind them are marked unproven and stay that
 * way. Refusing to grade what cannot be measured is the point of the file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AlibiResult, Claim, ClaimResult, ClaimTag, Finding } from './types.js';

const TAGGED = /^\s*[-*]\s*\[(tests|fix|pass|safe|perf|other)\]\s*(.+?)\s*$/i;
const UNTAGGED = /^\s*[-*]\s+(?!\[)(.+?)\s*$/;

export const CLAIMS_PATH = '.alibi/claims.md';

export function readClaims(root: string, override?: string[]): Claim[] {
  if (override && override.length > 0) {
    return override.map((text, index) => parseLine(`- ${text}`, index + 1)).filter((c): c is Claim => c !== null);
  }

  const path = join(root, CLAIMS_PATH);
  if (!existsSync(path)) return [];

  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line, index) => parseLine(line, index + 1))
    .filter((claim): claim is Claim => claim !== null);
}

function parseLine(line: string, lineNumber: number): Claim | null {
  const tagged = TAGGED.exec(line);
  if (tagged) {
    return {
      tag: (tagged[1] as string).toLowerCase() as ClaimTag,
      text: tagged[2] as string,
      line: lineNumber,
    };
  }
  const untagged = UNTAGGED.exec(line);
  if (untagged) return { tag: 'other', text: untagged[1] as string, line: lineNumber };
  return null;
}

export interface Evidence {
  results: AlibiResult[];
  findings: Finding[];
  /** Exit code of the whole suite, or null when it was not run. */
  suiteExitCode: number | null;
  hadSourceChange: boolean;
}

export function judge(claims: Claim[], evidence: Evidence): ClaimResult[] {
  const withAlibi = evidence.results.filter((r) => r.verdict === 'alibi');
  const withoutAlibi = evidence.results.filter((r) => r.verdict === 'none' && !r.test.exempt);
  const provisional = evidence.results.filter((r) => r.verdict === 'provisional');
  const examined = evidence.results.filter((r) => r.verdict !== 'skipped');

  const removals = evidence.findings.filter(
    (f) => f.kind === 'test-deleted' || f.kind === 'test-skipped',
  );
  const weakened = evidence.findings.filter((f) => f.kind === 'assertion-weakened');
  const vacuous = evidence.findings.filter(
    (f) => f.kind === 'vacuous-assertion' || f.kind === 'no-assertion' || f.kind === 'subject-mocked',
  );

  return claims.map((claim) => {
    const decide = (): Omit<ClaimResult, 'claim'> => {
      switch (claim.tag) {
        case 'tests': {
          if (examined.length === 0) {
            return { status: 'unproven', reason: 'no new or changed test was found in this diff', findings: [] };
          }
          if (withAlibi.length === 0 && withoutAlibi.length > 0) {
            return {
              status: 'false',
              reason: `${withoutAlibi.length} of ${examined.length} pass against the source from before the change`,
              findings: findingsFor(withoutAlibi, evidence.findings),
            };
          }
          if (withoutAlibi.length > 0) {
            return {
              status: 'unproven',
              reason: `${withAlibi.length} went red without the change, ${withoutAlibi.length} did not`,
              findings: findingsFor(withoutAlibi, evidence.findings),
            };
          }
          if (vacuous.length > 0) {
            return { status: 'unproven', reason: 'every test went red, but some assert very little', findings: vacuous };
          }
          if (withAlibi.length === 0) {
            return {
              status: 'unproven',
              reason: `${provisional.length} could not run against the old source at all`,
              findings: [],
            };
          }
          return { status: 'proven', reason: `${withAlibi.length} of ${examined.length} went red without the change`, findings: [] };
        }

        case 'fix': {
          if (!evidence.hadSourceChange) {
            return { status: 'false', reason: 'the diff changes no source file', findings: [] };
          }
          if (withAlibi.length === 0) {
            return {
              status: 'unproven',
              reason: 'no test in this diff fails when the change is taken away',
              findings: findingsFor(withoutAlibi, evidence.findings),
            };
          }
          return { status: 'proven', reason: `${withAlibi.length} test(s) fail without it`, findings: [] };
        }

        case 'pass': {
          if (evidence.suiteExitCode === null) {
            return { status: 'unproven', reason: 'the suite was not run', findings: [] };
          }
          if (evidence.suiteExitCode !== 0) {
            return { status: 'false', reason: `the suite exits ${evidence.suiteExitCode}`, findings: [] };
          }
          if (removals.length > 0) {
            return {
              status: 'false',
              reason: `it is green, and ${removals.length} test(s) stopped existing to make it so`,
              findings: removals,
            };
          }
          return { status: 'proven', reason: 'the suite exits 0', findings: [] };
        }

        case 'safe': {
          if (removals.length > 0) {
            return { status: 'false', reason: `${removals.length} test(s) were deleted or switched off`, findings: removals };
          }
          if (weakened.length > 0) {
            return { status: 'unproven', reason: `${weakened.length} test(s) lost assertions`, findings: weakened };
          }
          if (evidence.suiteExitCode === null) {
            return { status: 'unproven', reason: 'nothing was removed, and the suite was not run', findings: [] };
          }
          if (evidence.suiteExitCode !== 0) {
            return { status: 'false', reason: `the suite exits ${evidence.suiteExitCode}`, findings: [] };
          }
          return { status: 'proven', reason: 'no test was removed, weakened or switched off, and the suite is green', findings: [] };
        }

        case 'perf':
          return {
            status: 'unproven',
            reason: 'this tool measures test evidence, not speed — attach a benchmark',
            findings: [],
          };

        default:
          return { status: 'unproven', reason: 'no machine check maps to this claim', findings: [] };
      }
    };

    return { claim, ...decide() };
  });
}

function findingsFor(results: AlibiResult[], findings: Finding[]): Finding[] {
  const files = new Set(results.map((r) => r.test.file));
  const lines = new Set(results.map((r) => `${r.test.file}:${r.test.line}`));
  return findings.filter((f) => lines.has(`${f.file}:${f.line}`) || (f.kind === 'no-alibi' && files.has(f.file)));
}
