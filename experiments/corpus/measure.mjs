/**
 * Asks the corpus the one question.
 *
 * For each merged pull request: check the repository out at the base commit —
 * the world before the agent's change — install what the suite needs, copy the
 * pull request's *test* files over the old source, and run each new test on its
 * own. A test that passes there did not test the change it shipped with.
 *
 * The accounting is deliberately unkind to the result being measured. A pull
 * request that cannot be installed, whose suite is already red at base, or
 * whose tests cannot be selected one at a time is dropped and counted as
 * dropped, never quietly folded into a percentage. The published number has to
 * be one a stranger can reproduce, and that means the denominator has to be a
 * number and not a shrug.
 *
 *   node measure.mjs [--in candidates.json] [--out results.json] [--take 60]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { verify } from '../../dist/verify.js';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};

const IN = flag('in', 'candidates.json');
const OUT = flag('out', 'results.json');
const TAKE = Number(flag('take', 60));
const KEEP = argv.includes('--keep');

const CLONE_TIMEOUT = 180_000;
const INSTALL_TIMEOUT = 420_000;
const SUITE_TIMEOUT = 300_000;
const TEST_TIMEOUT = 90_000;

function shell(cmd, args, cwd, timeout) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1', NO_COLOR: '1', HUSKY: '0', npm_config_audit: 'false', npm_config_fund: 'false' },
  });
}

/**
 * Dependencies, or the honest admission that there are none to be had.
 *
 * Anything clever here — guessing a package manager from a lockfile that is not
 * there, retrying with different flags — buys a handful of extra repositories
 * at the cost of not knowing what was actually installed. A drop is cheaper
 * than a result nobody can account for.
 */
function install(dir, language) {
  if (language === 'python') {
    if (existsSync(join(dir, 'requirements.txt'))) {
      const run = shell('python3', ['-m', 'pip', 'install', '-q', '-r', 'requirements.txt'], dir, INSTALL_TIMEOUT);
      return run.status === 0 ? { ok: true, how: 'pip -r requirements.txt' } : { ok: false, why: 'pip install failed' };
    }
    if (existsSync(join(dir, 'pyproject.toml'))) {
      const run = shell('python3', ['-m', 'pip', 'install', '-q', '-e', '.'], dir, INSTALL_TIMEOUT);
      return run.status === 0 ? { ok: true, how: 'pip -e .' } : { ok: false, why: 'pip install failed' };
    }
    return { ok: true, how: 'nothing to install' };
  }

  if (language === 'go') {
    const run = shell('go', ['mod', 'download'], dir, INSTALL_TIMEOUT);
    return run.status === 0 ? { ok: true, how: 'go mod download' } : { ok: false, why: 'go mod download failed' };
  }

  if (!existsSync(join(dir, 'package.json'))) return { ok: false, why: 'no package.json' };

  const lock = existsSync(join(dir, 'package-lock.json'));
  const first = lock
    ? shell('npm', ['ci', '--silent', '--no-audit', '--no-fund', '--ignore-scripts'], dir, INSTALL_TIMEOUT)
    : { status: 1 };
  if (first.status === 0) return { ok: true, how: 'npm ci' };

  const second = shell(
    'npm',
    ['install', '--silent', '--no-audit', '--no-fund', '--ignore-scripts', '--legacy-peer-deps'],
    dir,
    INSTALL_TIMEOUT,
  );
  return second.status === 0
    ? { ok: true, how: 'npm install --legacy-peer-deps' }
    : { ok: false, why: 'npm install failed' };
}

const candidates = JSON.parse(readFileSync(IN, 'utf8')).candidates.slice(0, TAKE);
const results = [];
let index = 0;

for (const candidate of candidates) {
  index++;
  const label = `${candidate.repo}#${candidate.number}`;
  process.stderr.write(`\n[${index}/${candidates.length}] ${label}\n`);

  const workspace = mkdtempSync(join(tmpdir(), 'alibi-corpus-'));
  const dir = join(workspace, 'repo');
  const record = { ...candidate, tests: candidate.tests.length, sources: candidate.sources.length };

  try {
    /*
     * A shallow fetch of exactly the two commits involved. Cloning the whole
     * history of a busy repository is minutes of nothing useful.
     */
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['remote', 'add', 'origin', candidate.cloneUrl], { cwd: dir });

    const fetch = shell(
      'git',
      ['fetch', '-q', '--depth', '1', 'origin', candidate.base, candidate.head],
      dir,
      CLONE_TIMEOUT,
    );
    if (fetch.status !== 0) {
      record.outcome = 'dropped';
      record.why = 'commits no longer fetchable';
      results.push(record);
      continue;
    }

    execFileSync('git', ['checkout', '-q', candidate.base], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'corpus@example.invalid'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'corpus'], { cwd: dir });

    process.stderr.write('      installing… ');
    const installed = install(dir, candidate.language);
    if (!installed.ok) {
      process.stderr.write(`${installed.why}\n`);
      record.outcome = 'dropped';
      record.why = installed.why;
      results.push(record);
      continue;
    }
    process.stderr.write(`${installed.how}\n`);
    record.install = installed.how;

    /*
     * The suite has to be green at base before anything it says afterwards
     * means anything. A repository that is already red there would hand every
     * test an alibi it did not earn.
     */
    process.stderr.write('      suite at base… ');
    const suiteCommand =
      candidate.language === 'python'
        ? ['python3', ['-m', 'pytest', '-q']]
        : candidate.language === 'go'
          ? ['go', ['test', './...']]
          : ['npm', ['test']];
    const baselineRun = shell(suiteCommand[0], suiteCommand[1], dir, SUITE_TIMEOUT);

    if (baselineRun.status !== 0) {
      /*
       * Two very different things exit non-zero here, and merging them would
       * hide the shape of the corpus: a suite that genuinely fails at base,
       * and a suite that never started — no test script, no tests collected,
       * a database that is not there. Only the first is a statement about the
       * repository; the second is a statement about this harness.
       */
      const text = `${baselineRun.stdout ?? ''}\n${baselineRun.stderr ?? ''}`;
      const couldNotStart =
        baselineRun.signal === 'SIGTERM' ||
        /no test specified|Missing script: .?test|No tests found|no test files|collected 0 items|ERR_MODULE_NOT_FOUND|Cannot find module|command not found/i.test(
          text,
        );
      const needsInfrastructure =
        /ECONNREFUSED|ENOTFOUND|getaddrinfo|connect ETIMEDOUT|database .*does not exist|Access denied for user|DATABASE_URL|MONGO|redis/i.test(
          text,
        );

      record.outcome = 'dropped';
      record.why = couldNotStart
        ? 'the suite could not be started here'
        : needsInfrastructure
          ? 'the suite needs infrastructure this harness does not provide'
          : 'suite already failing at the base commit';
      record.baselineExcerpt = text
        .split(/\r?\n/)
        .map((line) => line.replace(/\u001b\[[\d;]*m/g, '').trim())
        .filter((line) => line.length > 0)
        .slice(-4)
        .join(' | ')
        .slice(0, 300);

      process.stderr.write(`${record.why}\n`);
      results.push(record);
      continue;
    }
    process.stderr.write('green\n');

    /*
     * Bring in the pull request's test files, and only those. This is the same
     * move the tool makes internally; done here so that the corpus run reaches
     * the tool through its ordinary path rather than a special one.
     */
    const headDir = join(workspace, 'head');
    mkdirSync(headDir, { recursive: true });
    execFileSync('git', ['worktree', 'add', '--detach', '-f', headDir, candidate.head], { cwd: dir });

    let copied = 0;
    for (const path of candidate.tests) {
      const from = join(headDir, path);
      if (!existsSync(from)) continue;
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      cpSync(from, join(dir, path));
      copied++;
    }
    for (const path of candidate.sources) {
      const from = join(headDir, path);
      if (!existsSync(from)) continue;
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      cpSync(from, join(dir, path));
    }
    execFileSync('git', ['worktree', 'remove', '--force', headDir], { cwd: dir });

    if (copied === 0) {
      record.outcome = 'dropped';
      record.why = 'no test file survived into the merge commit';
      results.push(record);
      continue;
    }

    process.stderr.write('      alibi… ');
    const report = verify({
      cwd: dir,
      base: candidate.base,
      timeoutMs: TEST_TIMEOUT,
      suite: false,
      link: ['node_modules', '.venv', 'vendor'],
    });

    const examined = report.results.filter((r) => r.verdict === 'alibi' || r.verdict === 'none');
    const without = report.results.filter((r) => r.verdict === 'none' && !r.test.exempt);
    const provisional = report.results.filter((r) => r.verdict === 'provisional');
    const errored = report.results.filter((r) => r.verdict === 'error');

    if (examined.length === 0) {
      process.stderr.write(`no test answered (${provisional.length} provisional, ${errored.length} errored)\n`);
      record.outcome = 'dropped';
      record.why = 'no test produced a definitive answer against the base source';
      record.provisional = provisional.length;
      record.errored = errored.length;
      results.push(record);
      continue;
    }

    record.outcome = 'measured';
    record.examined = examined.length;
    record.withAlibi = examined.length - without.length;
    record.withoutAlibi = without.length;
    record.provisional = provisional.length;
    record.errored = errored.length;
    record.removals = report.findings.filter(
      (f) => f.kind === 'test-deleted' || f.kind === 'test-skipped',
    ).length;
    record.vacuous = report.findings.filter(
      (f) => f.kind === 'vacuous-assertion' || f.kind === 'no-assertion',
    ).length;
    record.names = without.map((r) => ({
      test: [...r.test.suite, r.test.name].join(' › '),
      file: r.test.file,
      line: r.test.line,
    }));

    process.stderr.write(
      `${record.withAlibi}/${examined.length} with an alibi, ${without.length} without\n`,
    );
    results.push(record);
  } catch (error) {
    record.outcome = 'dropped';
    record.why = `harness error: ${String(error.message ?? error).slice(0, 160)}`;
    results.push(record);
    process.stderr.write(`      dropped: ${record.why}\n`);
  } finally {
    if (!KEEP) rmSync(workspace, { recursive: true, force: true });
    writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  }
}

const measured = results.filter((r) => r.outcome === 'measured');
const tests = measured.reduce((n, r) => n + r.examined, 0);
const without = measured.reduce((n, r) => n + r.withoutAlibi, 0);

console.log(
  `\nattempted ${results.length} · measured ${measured.length} · ` +
    `${tests} tests answered · ${without} without an alibi ` +
    `(${tests === 0 ? 0 : ((without / tests) * 100).toFixed(1)}%)`,
);
