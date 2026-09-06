/**
 * Deciding what a file is.
 *
 * The classification is deliberately conservative in one direction: a file
 * that is not clearly a test is treated as source. Mistaking a test for source
 * would put it on the wrong side of the revert and quietly invalidate the run,
 * which is the one failure mode this tool cannot afford.
 */

import { basename, extname } from 'node:path';
import type { FileRole, Language } from './types.js';

const BY_EXTENSION: Record<string, Language> = {
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.ts': 'ts',
  '.tsx': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.java': 'java',
  '.kt': 'java',
  '.php': 'php',
};

export function languageOf(path: string): Language {
  return BY_EXTENSION[extname(path).toLowerCase()] ?? 'unknown';
}

/** Directory names that mean "everything below here is a test". */
const TEST_DIRS = new Set([
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  'e2e',
  'integration-tests',
  'testing',
]);

const TEST_FILENAME = [
  /\.test\.[cm]?[jt]sx?$/i,
  /\.spec\.[cm]?[jt]sx?$/i,
  /^test_.+\.py$/i,
  /_test\.py$/i,
  /_test\.go$/i,
  /_test\.rb$/i,
  /_spec\.rb$/i,
  /Test\.java$/,
  /Tests\.java$/,
  /Test\.php$/,
  /_test\.rs$/i,
];

/** Paths that change constantly and prove nothing either way. */
const IGNORED = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)target\//,
  /(^|\/)vendor\//,
  /(^|\/)\.venv\//,
  /(^|\/)__pycache__\//,
  /(^|\/)\.git\//,
  /\.lock$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)poetry\.lock$/,
  /\.(md|markdown|rst|txt|png|jpe?g|gif|svg|ico|pdf|woff2?)$/i,
];

export function isIgnored(path: string): boolean {
  return IGNORED.some((re) => re.test(path));
}

export function roleOf(path: string): FileRole {
  if (isIgnored(path)) return 'other';

  const segments = path.split('/');
  const name = basename(path);

  if (segments.slice(0, -1).some((s) => TEST_DIRS.has(s.toLowerCase()))) return 'test';
  if (TEST_FILENAME.some((re) => re.test(name))) return 'test';

  const language = languageOf(path);
  if (language === 'unknown') return 'other';
  return 'source';
}

/**
 * Rust puts unit tests inside the file they test, behind `#[cfg(test)]`. Such
 * a file is source and test at once, and reverting it would revert the test
 * with the fix. The check that follows treats these as unverifiable rather
 * than pretending otherwise; see the Limits section of the README.
 */
export function hasInlineTests(path: string, content: string): boolean {
  return languageOf(path) === 'rust' && /#\[cfg\(test\)\]/.test(content);
}
