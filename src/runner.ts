/**
 * Asking a test runner one question at a time.
 *
 * This module never parses test output to decide what passed. Output formats
 * differ per runner, per version and per reporter, and a misread line here
 * would turn into a false accusation in the report. Instead every test is run
 * on its own, filtered by name, and the only thing read is the exit code —
 * the one signal every runner in the world agrees on.
 *
 * The cost is real: one process per test. `--fast` trades this precision for
 * a single run per file, and says so in the report.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestCase } from './types.js';

export interface Invocation {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
}

export interface Runner {
  id: string;
  label: string;
  /** Directories to link into the throwaway worktree so the suite can start. */
  linkPaths: string[];
  /** Runs exactly one test. */
  one(test: TestCase): Invocation;
  /** Runs every test in one file. */
  file(path: string): Invocation;
  /** Runs the whole suite. */
  all(): Invocation;
}

const NODE_LINKS = ['node_modules'];
const PY_LINKS = ['.venv', 'venv', '.tox'];

function fullName(test: TestCase): string {
  return [...test.suite, test.name].join(' ');
}

function pytestId(test: TestCase): string {
  return [test.file, ...test.suite, test.name].join('::');
}

/** Regexes are the wrong tool for names; runners take them literally. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const RUNNERS: Record<string, (root: string) => Runner> = {
  vitest: () => ({
    id: 'vitest',
    label: 'vitest',
    linkPaths: NODE_LINKS,
    one: (t) => ({ cmd: 'npx', args: ['--no-install', 'vitest', 'run', t.file, '-t', fullName(t)] }),
    file: (p) => ({ cmd: 'npx', args: ['--no-install', 'vitest', 'run', p] }),
    all: () => ({ cmd: 'npx', args: ['--no-install', 'vitest', 'run'] }),
  }),
  jest: () => ({
    id: 'jest',
    label: 'jest',
    linkPaths: NODE_LINKS,
    one: (t) => ({
      cmd: 'npx',
      args: ['--no-install', 'jest', '--ci', '--runTestsByPath', t.file, '-t', fullName(t)],
    }),
    file: (p) => ({ cmd: 'npx', args: ['--no-install', 'jest', '--ci', '--runTestsByPath', p] }),
    all: () => ({ cmd: 'npx', args: ['--no-install', 'jest', '--ci'] }),
  }),
  mocha: () => ({
    id: 'mocha',
    label: 'mocha',
    linkPaths: NODE_LINKS,
    one: (t) => ({ cmd: 'npx', args: ['--no-install', 'mocha', t.file, '--grep', fullName(t)] }),
    file: (p) => ({ cmd: 'npx', args: ['--no-install', 'mocha', p] }),
    all: () => ({ cmd: 'npx', args: ['--no-install', 'mocha'] }),
  }),
  node: () => ({
    id: 'node',
    label: 'node --test',
    linkPaths: NODE_LINKS,
    one: (t) => ({
      cmd: process.execPath,
      args: ['--test', `--test-name-pattern=${escapeRegex(t.name)}`, t.file],
    }),
    file: (p) => ({ cmd: process.execPath, args: ['--test', p] }),
    all: () => ({ cmd: process.execPath, args: ['--test'] }),
  }),
  pytest: () => ({
    id: 'pytest',
    label: 'pytest',
    linkPaths: PY_LINKS,
    one: (t) => ({
      cmd: 'python3',
      args: ['-m', 'pytest', '-q', '-p', 'no:randomly', pytestId(t)],
      env: { PYTHONDONTWRITEBYTECODE: '1' },
    }),
    file: (p) => ({ cmd: 'python3', args: ['-m', 'pytest', '-q', p] }),
    all: () => ({ cmd: 'python3', args: ['-m', 'pytest', '-q'] }),
  }),
  go: () => ({
    id: 'go',
    label: 'go test',
    linkPaths: [],
    one: (t) => ({
      cmd: 'go',
      args: ['test', `./${t.file.split('/').slice(0, -1).join('/') || '.'}`, '-run', `^${escapeRegex(t.name)}$`, '-count=1'],
    }),
    file: (p) => ({ cmd: 'go', args: ['test', `./${p.split('/').slice(0, -1).join('/') || '.'}`, '-count=1'] }),
    all: () => ({ cmd: 'go', args: ['test', './...', '-count=1'] }),
  }),
  cargo: () => ({
    id: 'cargo',
    label: 'cargo test',
    linkPaths: ['target'],
    one: (t) => ({ cmd: 'cargo', args: ['test', t.name, '--', '--exact', '--nocapture'] }),
    file: () => ({ cmd: 'cargo', args: ['test'] }),
    all: () => ({ cmd: 'cargo', args: ['test'] }),
  }),
  rspec: () => ({
    id: 'rspec',
    label: 'rspec',
    linkPaths: ['vendor'],
    one: (t) => ({ cmd: 'bundle', args: ['exec', 'rspec', t.file, '-e', t.name] }),
    file: (p) => ({ cmd: 'bundle', args: ['exec', 'rspec', p] }),
    all: () => ({ cmd: 'bundle', args: ['exec', 'rspec'] }),
  }),
  phpunit: () => ({
    id: 'phpunit',
    label: 'phpunit',
    linkPaths: ['vendor'],
    one: (t) => ({ cmd: 'vendor/bin/phpunit', args: [t.file, '--filter', t.name] }),
    file: (p) => ({ cmd: 'vendor/bin/phpunit', args: [p] }),
    all: () => ({ cmd: 'vendor/bin/phpunit', args: [] }),
  }),
};

function readPackageJson(root: string): Record<string, unknown> | null {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Picks a runner from what is on disk. Order is by how specific the evidence
 * is: a declared dependency beats a config file, a config file beats a
 * language guess.
 */
export function detectRunner(root: string): Runner | null {
  const pkg = readPackageJson(root);
  if (pkg) {
    const deps = {
      ...(pkg['dependencies'] as Record<string, string> | undefined),
      ...(pkg['devDependencies'] as Record<string, string> | undefined),
    };
    const script = String((pkg['scripts'] as Record<string, string> | undefined)?.['test'] ?? '');
    for (const id of ['vitest', 'jest', 'mocha'] as const) {
      if (deps[id] || script.includes(id)) return (RUNNERS[id] as (r: string) => Runner)(root);
    }
    if (script.includes('node --test') || script.includes('node:test')) {
      return (RUNNERS['node'] as (r: string) => Runner)(root);
    }
  }

  const has = (...files: string[]): boolean => files.some((f) => existsSync(join(root, f)));
  if (has('pytest.ini', 'conftest.py', 'tox.ini', 'setup.cfg', 'pyproject.toml')) {
    return (RUNNERS['pytest'] as (r: string) => Runner)(root);
  }
  if (has('go.mod')) return (RUNNERS['go'] as (r: string) => Runner)(root);
  if (has('Cargo.toml')) return (RUNNERS['cargo'] as (r: string) => Runner)(root);
  if (has('.rspec', 'spec/spec_helper.rb')) return (RUNNERS['rspec'] as (r: string) => Runner)(root);
  if (has('phpunit.xml', 'phpunit.xml.dist')) return (RUNNERS['phpunit'] as (r: string) => Runner)(root);
  if (pkg) return (RUNNERS['node'] as (r: string) => Runner)(root);
  return null;
}

export function runnerById(id: string, root: string): Runner | null {
  const make = RUNNERS[id];
  return make ? make(root) : null;
}

export const RUNNER_IDS = Object.keys(RUNNERS);

/**
 * A runner built from a command template in the config file, for projects
 * whose entry point this tool has never heard of. `{file}`, `{name}` and
 * `{fullName}` are substituted; nothing else is interpreted.
 */
export function templateRunner(template: string, linkPaths: string[]): Runner {
  const build = (values: Record<string, string>): Invocation => {
    const filled = template.replace(/\{(file|name|fullName)\}/g, (_, key: string) => values[key] ?? '');
    return { cmd: 'sh', args: ['-c', filled] };
  };
  return {
    id: 'custom',
    label: template,
    linkPaths,
    one: (t) => build({ file: t.file, name: t.name, fullName: fullName(t) }),
    file: (p) => build({ file: p, name: '', fullName: '' }),
    all: () => build({ file: '', name: '', fullName: '' }),
  };
}

export interface RunOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Variables that tell a test runner it is already inside another one.
 *
 * Inherited, they change the exit code of the run this tool is about to
 * measure: a nested `node --test` that finds NODE_TEST_CONTEXT reports to its
 * parent instead of failing, and a pytest that finds PYTEST_CURRENT_TEST
 * believes it is a subprocess of a running test. Either way the alibi run
 * would come back green and a real test would be accused of proving nothing.
 * This is the one place where inheriting the ambient environment is wrong.
 */
const INHERITED_TEST_STATE = [
  'NODE_TEST_CONTEXT',
  'NODE_OPTIONS',
  'NODE_V8_COVERAGE',
  'JEST_WORKER_ID',
  'VITEST',
  'VITEST_POOL_ID',
  'VITEST_WORKER_ID',
  'PYTEST_CURRENT_TEST',
  'PYTEST_XDIST_WORKER',
  'GO_TEST_TIMEOUT',
];

function cleanEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
  for (const key of INHERITED_TEST_STATE) delete env[key];
  return env;
}

export function run(invocation: Invocation, cwd: string, timeoutMs: number): RunOutcome {
  const started = Date.now();
  const result = spawnSync(invocation.cmd, invocation.args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: cleanEnv(invocation.env),
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs: Date.now() - started,
    timedOut: result.signal === 'SIGTERM' && Date.now() - started >= timeoutMs,
  };
}

/**
 * Did the test fail, or did it never get to run?
 *
 * The difference decides between an alibi and a provisional one. A new test
 * for a module that does not exist yet cannot import it, and the runner exits
 * non-zero without ever evaluating an assertion. Counting that as proof would
 * hand an alibi to every test written against new code, which is most of them.
 */
const NEVER_RAN = [
  /ModuleNotFoundError/,
  /ImportError/,
  /ERROR collecting/,
  /Cannot find module/,
  /Failed to resolve import/,
  /Could not resolve/,
  /SyntaxError/,
  /ReferenceError: \w+ is not defined/,
  /is not a function/,
  /undefined: /,
  /error\[E0(425|432|433|412)\]/,
  /cannot find (function|value|type|crate)/,
  /NameError/,
  /AttributeError: module/,
  /no test files/i,
  /No tests found/i,
  /Unknown at rule/,
  /class .* not found/i,
];

export function neverRan(outcome: RunOutcome): boolean {
  const text = `${outcome.stdout}\n${outcome.stderr}`;
  return NEVER_RAN.some((re) => re.test(text));
}

/** The most useful single line of a failing run, for the report. */
export function firstEvidence(outcome: RunOutcome): string {
  const lines = `${outcome.stdout}\n${outcome.stderr}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const interesting = lines.find((l) =>
    /(AssertionError|assert|Expected|expected|FAILED|FAIL|panic:|Error:|error\[|--- FAIL)/.test(l),
  );
  return (interesting ?? lines[lines.length - 1] ?? '').slice(0, 200);
}
