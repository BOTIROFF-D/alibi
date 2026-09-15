/**
 * Does the reverted tree actually get used?
 *
 * `pip install -e .` writes an absolute path to the original working tree into
 * site-packages. Putting the worktree first on `PYTHONPATH` reorders the
 * search, but it cannot stop it: a module that the base commit never had is
 * simply not found in the worktree, so Python keeps walking and finds the new
 * one through the editable install. The test then passes against code that was
 * supposed to be reverted, and this tool reports a perfectly good test as
 * having no alibi.
 *
 * A false accusation is the most expensive mistake available here, so the
 * question is settled by asking rather than by assuming: import the package
 * inside the worktree and print where it came from. A path outside the
 * worktree means the verdicts for that project cannot be trusted, and saying
 * so is the only honest move left.
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ChangedFile } from '../types.js';

export interface Leak {
  /** The import that resolved outside the reverted tree. */
  module: string;
  /** Where it actually came from. */
  resolvedTo: string;
}

/** Top-level package names the change touched, e.g. `newsbot/judge.py` → `newsbot`. */
function packagesOf(changed: ChangedFile[]): string[] {
  const names = new Set<string>();
  for (const file of changed) {
    if (file.language !== 'python' || file.role !== 'source') continue;
    const head = file.path.split('/')[0];
    if (head && !head.endsWith('.py')) names.add(head);
  }
  return [...names];
}

export function findLeaks(worktreeDir: string, changed: ChangedFile[], env: NodeJS.ProcessEnv): Leak[] {
  const packages = packagesOf(changed);
  if (packages.length === 0) return [];

  const probe = `
import importlib, sys, json
out = []
for name in ${JSON.stringify(packages)}:
    try:
        m = importlib.import_module(name)
    except Exception:
        continue
    path = getattr(m, "__file__", None) or (list(getattr(m, "__path__", [])) or [None])[0]
    if path:
        out.append([name, path])
print(json.dumps(out))
`;

  const run = spawnSync('python3', ['-c', probe], {
    cwd: worktreeDir,
    encoding: 'utf8',
    timeout: 60_000,
    env,
  });
  if (run.status !== 0) return [];

  let rows: [string, string][];
  try {
    rows = JSON.parse((run.stdout ?? '[]').trim());
  } catch {
    return [];
  }

  const inside = resolve(worktreeDir);
  return rows
    .filter(([, path]) => !resolve(path).startsWith(inside))
    .map(([module, path]) => ({ module, resolvedTo: path }));
}
