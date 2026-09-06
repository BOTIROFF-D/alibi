/**
 * Git, spoken to through plumbing only.
 *
 * Two rules hold this module together. First, nothing here writes to the
 * user's working tree: the pre-change state is materialised in a throwaway
 * worktree, so an agent that is still running in the original directory
 * cannot collide with a verification. Second, every command is asked a
 * question it can answer with machine-readable output — no parsing of
 * human-facing git prose, which changes between versions and locales.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, copyFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export class GitError extends Error {}

function git(args: string[], cwd: string): string {
  const run = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (run.error) throw new GitError(`git ${args[0]} could not be started: ${run.error.message}`);
  if (run.status !== 0) {
    throw new GitError(`git ${args.join(' ')} failed (${run.status}): ${(run.stderr || '').trim()}`);
  }
  return run.stdout;
}

function gitQuiet(args: string[], cwd: string): { ok: boolean; out: string } {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: run.status === 0, out: run.stdout ?? '' };
}

export function repoRoot(from: string): string {
  const out = git(['rev-parse', '--show-toplevel'], from).trim();
  if (!out) throw new GitError('not inside a git repository');
  return resolve(out);
}

export function isGitRepo(from: string): boolean {
  return gitQuiet(['rev-parse', '--git-dir'], from).ok;
}

export function resolveRev(rev: string, root: string): string {
  return git(['rev-parse', '--verify', `${rev}^{commit}`], root).trim();
}

export function headExists(root: string): boolean {
  return gitQuiet(['rev-parse', '--verify', 'HEAD'], root).ok;
}

/**
 * Files that differ between `base` and the working tree, including files git
 * has never seen. Untracked files matter more here than anywhere else: a new
 * test file written by an agent is untracked until someone stages it, and it
 * is exactly the file whose alibi we came to check.
 */
export function changedPaths(base: string, root: string): { path: string; status: 'A' | 'M' | 'D' | 'R'; from?: string }[] {
  const out: { path: string; status: 'A' | 'M' | 'D' | 'R'; from?: string }[] = [];
  const seen = new Set<string>();

  const diff = git(['diff', '--name-status', '-M', '-z', base, '--'], root);
  const fields = diff.split('\0').filter((f) => f.length > 0);
  for (let i = 0; i < fields.length; ) {
    const code = fields[i] as string;
    if (code.startsWith('R')) {
      const from = fields[i + 1] as string;
      const to = fields[i + 2] as string;
      out.push({ path: to, status: 'R', from });
      seen.add(to);
      i += 3;
      continue;
    }
    const path = fields[i + 1] as string;
    const status = code.startsWith('A') ? 'A' : code.startsWith('D') ? 'D' : 'M';
    out.push({ path, status });
    seen.add(path);
    i += 2;
  }

  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], root)
    .split('\0')
    .filter((p) => p.length > 0);
  for (const path of untracked) {
    if (!seen.has(path)) out.push({ path, status: 'A' });
  }

  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Contents of a path at a revision, or null when it did not exist there. */
export function fileAtRev(rev: string, path: string, root: string): string | null {
  const run = spawnSync('git', ['show', `${rev}:${path}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) return null;
  return run.stdout;
}

export interface Worktree {
  /** Absolute path of the checkout. */
  dir: string;
  /** Removes the worktree and its registration. Safe to call twice. */
  dispose(): void;
}

/**
 * A detached checkout of `rev` in a temporary directory.
 *
 * `--no-checkout` first, then a checkout of the whole tree, would save nothing
 * here: the alibi run needs the real files. What it does need is isolation,
 * and that is the entire reason for spending the disk.
 */
export function createWorktree(rev: string, root: string): Worktree {
  const dir = mkdtempSync(join(tmpdir(), 'alibi-'));
  const target = join(dir, 'tree');
  git(['worktree', 'add', '--detach', '--force', target, rev], root);

  let disposed = false;
  return {
    dir: target,
    dispose() {
      if (disposed) return;
      disposed = true;
      gitQuiet(['worktree', 'remove', '--force', target], root);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* the directory is in the OS temp area; leaving it is not worth an error */
      }
      gitQuiet(['worktree', 'prune'], root);
    },
  };
}

/**
 * Copies a file from the working tree into the worktree, creating parents.
 * Used to carry the agent's new tests back over the old source.
 */
export function copyInto(worktreeDir: string, root: string, relPath: string): void {
  const src = join(root, relPath);
  if (!existsSync(src)) return;
  const dst = join(worktreeDir, relPath);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

/**
 * Points a path inside the worktree at the original, so that installed
 * dependencies do not have to be installed twice. Symlinks, not copies:
 * node_modules of a mid-sized project is gigabytes and minutes.
 */
export function linkInto(worktreeDir: string, root: string, relPath: string): boolean {
  const src = join(root, relPath);
  if (!existsSync(src)) return false;
  const dst = join(worktreeDir, relPath);
  if (existsSync(dst)) return true;
  try {
    mkdirSync(dirname(dst), { recursive: true });
    symlinkSync(src, dst, 'junction');
    return true;
  } catch {
    return false;
  }
}

/** True when the working tree has changes git knows about. */
export function isDirty(root: string): boolean {
  return git(['status', '--porcelain'], root).trim().length > 0;
}

/**
 * Line numbers a change added or rewrote in `path`, in the working-tree
 * version. Read from a zero-context diff, which states them directly and
 * spares this file a diff algorithm of its own.
 */
export function touchedLines(base: string, path: string, root: string): number[] {
  const result = spawnSync('git', ['diff', '-U0', base, '--', path], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) return [];

  const lines: number[] = [];
  for (const line of (result.stdout ?? '').split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let i = 0; i < count; i++) lines.push(start + i);
  }
  return lines;
}

/** Every line of a file that git has never seen counts as touched. */
export function allLines(content: string): number[] {
  return content.split(/\r?\n/).map((_, index) => index + 1);
}
