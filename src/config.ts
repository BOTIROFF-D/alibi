/**
 * Configuration, kept small on purpose.
 *
 * Every option here exists because some project cannot be detected correctly
 * without it. Nothing here changes what a verdict means — a flag that could
 * turn a lie into a pass would make the whole report negotiable.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FileConfig {
  /** One of the known runner ids. */
  runner?: string;
  /** A shell template with {file}, {name} and {fullName}. */
  command?: string;
  /** Directories to link into the throwaway worktree, e.g. [".venv"]. */
  link?: string[];
  /** Per-test timeout in seconds. */
  timeout?: number;
  /** Run the whole suite as part of a verification. Default true. */
  suite?: boolean;
  /** Also damage the changed lines. Default false. */
  mutate?: boolean;
  /** Upper bound on mutants per run. Default 8. */
  mutants?: number;
}

const FILENAMES = ['alibi.json', '.alibi.json', '.alibi/config.json'];

export function loadConfig(root: string): FileConfig {
  for (const name of FILENAMES) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as FileConfig;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      throw new Error(`${name} is not valid JSON: ${(error as Error).message}`);
    }
  }
  return {};
}
