/**
 * The museum, made to keep its word.
 *
 * Every exhibit in `examples/museum` claims that a particular way of buying a
 * green suite is caught. A claim like that rots quietly: a refactor moves a
 * pattern, the exhibit still reads convincingly, and the tool stops catching
 * the thing its own documentation says it catches.
 *
 * So each exhibit is built into a real repository here and the finding has to
 * appear. An exhibit that stops being caught fails the build, which is the
 * only way a museum stays honest.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify } from '../dist/verify.js';

const MUSEUM = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'museum');

function git(args, cwd) {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'museum',
      GIT_AUTHOR_EMAIL: 'museum@example.invalid',
      GIT_COMMITTER_NAME: 'museum',
      GIT_COMMITTER_EMAIL: 'museum@example.invalid',
    },
  });
}

for (const id of readdirSync(MUSEUM).sort()) {
  const exhibit = join(MUSEUM, id);
  const spec = JSON.parse(readFileSync(join(exhibit, 'case.json'), 'utf8'));

  test(`museum: ${id} — ${spec.title}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'alibi-museum-'));
    try {
      cpSync(join(exhibit, 'base'), dir, { recursive: true });
      git(['init', '-q'], dir);
      git(['add', '-A'], dir);
      git(['commit', '-qm', 'before'], dir);

      rmSync(join(dir, 'test'), { recursive: true, force: true });
      cpSync(join(exhibit, 'after'), dir, { recursive: true });

      const report = verify({ cwd: dir, suite: false });
      const kinds = report.findings.map((f) => f.kind);

      assert.ok(
        kinds.includes(spec.expect),
        `expected a ${spec.expect} finding, got: ${kinds.join(', ') || 'nothing'}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
