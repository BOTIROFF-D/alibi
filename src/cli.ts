/**
 * The command line.
 *
 * Three verbs. `verify` answers the question, `init` writes the ledger the
 * agent fills in, `explain` prints what each verdict means so that nobody has
 * to take the report's word for its own vocabulary.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { CLAIMS_PATH } from './claims.js';
import { exitCodeFor, render, toJson, toMarkdown } from './report.js';
import { repoRoot } from './git.js';
import { RUNNER_IDS } from './runner.js';
import { verify, VerifyError, VERSION, type ProgressEvent } from './verify.js';

const USAGE = `
alibi ${VERSION} — every green test needs an alibi

  alibi                      verify the working tree against HEAD
  alibi verify [options]     the same, with options
  alibi init                 write .alibi/claims.md for an agent to fill in
  alibi explain              what each verdict means

Options
  --base <rev>               what to revert to (default: HEAD)
  --runner <id>              ${RUNNER_IDS.join(', ')}
  --command "<template>"     run tests with a shell command; {file} {name} {fullName}
  --link <dir>               link a directory into the throwaway worktree (repeatable)
  --claim "[tag] text"       claim to judge, instead of the ledger (repeatable)
  --timeout <seconds>        per-test timeout (default: 120)
  --mutate                   also damage the changed lines and see if anything objects
  --mutants <n>              upper bound on mutants (default: 8)
  --no-suite                 do not run the whole suite
  --strict                   exit 2 when anything is merely unproven
  --json                     machine-readable report on stdout
  --markdown                 a report shaped for a pull request comment
  --verbose                  also print the tests that did have an alibi
  --no-color                 plain text
  --version, --help

Exit codes
  0  nothing false                1  a green lie or a false claim
  2  unproven, with --strict      3  the tool could not answer
`;

interface Flags {
  command: string;
  base?: string;
  runner?: string;
  template?: string;
  link: string[];
  claims: string[];
  timeout?: number;
  mutate: boolean;
  mutants?: number;
  suite: boolean;
  strict: boolean;
  json: boolean;
  markdown: boolean;
  verbose: boolean;
  color: boolean;
  help: boolean;
  version: boolean;
}

/**
 * Colour follows the two conventions everyone already implements: NO_COLOR
 * turns it off wherever it is set, FORCE_COLOR turns it on when the output is
 * not a terminal — which is how the picture in the README is generated from a
 * real run rather than from a mock-up.
 */
function colourWanted(): boolean {
  if (process.env['NO_COLOR']) return false;
  if (process.env['FORCE_COLOR'] && process.env['FORCE_COLOR'] !== '0') return true;
  return process.stdout.isTTY === true;
}

export function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    command: 'verify',
    link: [],
    claims: [],
    mutate: false,
    suite: true,
    strict: false,
    json: false,
    markdown: false,
    verbose: false,
    color: colourWanted(),
    help: false,
    version: false,
  };

  const rest = [...argv];
  if (rest.length > 0 && !(rest[0] as string).startsWith('-')) {
    flags.command = rest.shift() as string;
  }

  while (rest.length > 0) {
    const arg = rest.shift() as string;
    switch (arg) {
      case '--base':
        flags.base = rest.shift();
        break;
      case '--runner':
        flags.runner = rest.shift();
        break;
      case '--command':
        flags.template = rest.shift();
        break;
      case '--link': {
        const value = rest.shift();
        if (value) flags.link.push(value);
        break;
      }
      case '--claim': {
        const value = rest.shift();
        if (value) flags.claims.push(value);
        break;
      }
      case '--timeout':
        flags.timeout = Number(rest.shift());
        break;
      case '--mutants':
        flags.mutants = Number(rest.shift());
        break;
      case '--mutate':
        flags.mutate = true;
        break;
      case '--no-suite':
        flags.suite = false;
        break;
      case '--strict':
        flags.strict = true;
        break;
      case '--json':
        flags.json = true;
        flags.color = false;
        break;
      case '--markdown':
        flags.markdown = true;
        flags.color = false;
        break;
      case '--verbose':
        flags.verbose = true;
        break;
      case '--no-color':
        flags.color = false;
        break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      case '--version':
      case '-v':
        flags.version = true;
        break;
      default:
        throw new VerifyError(`unknown option ${arg}`);
    }
  }

  return flags;
}

const LEDGER = `# Claims

Written by whoever did the work, before handing it over. One line per claim,
each tagged with the kind of evidence that would settle it. Delete the ones
that do not apply; do not delete the tags.

- [tests] <what the new tests cover>
- [fix] <what was broken and now is not>
- [pass] the suite passes
- [safe] no existing test was removed, skipped or weakened

Tags
  tests  a new test goes red when the change is taken away
  fix    something in this diff is what makes a test pass
  pass   the whole suite exits zero
  safe   nothing was deleted, skipped or softened to get there
  perf   not checkable here; attach a benchmark instead
`;

function writeLedger(root: string): string {
  const dir = join(root, '.alibi');
  mkdirSync(dir, { recursive: true });
  const path = join(root, CLAIMS_PATH);
  if (!existsSync(path)) writeFileSync(path, LEDGER);
  return path;
}

const EXPLANATION = `
alibi ${VERSION}

  alibi           the test failed when the change was taken away. It is
                  evidence for the change, and the only verdict this tool
                  treats as proof.

  no alibi        the test passed against the source from before the change.
                  It may test something real; it does not test this. Mark it
                  with "alibi: characterization" if that is deliberate.

  provisional     the test never ran against the old source — the code it
                  imports did not exist yet. Expected for a new module, and
                  evidence of nothing either way.

  green lie       something that is green because the red part was removed,
                  switched off, or never able to fail. Read from the diff or
                  from an exit code, never inferred from prose.

  unproven        a static reading found something worth a second look. This
                  tool never promotes a pattern match to a lie.
`;

export function main(argv: string[]): number {
  let flags: Flags;
  try {
    flags = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`alibi: ${(error as Error).message}\n`);
    return 3;
  }

  if (flags.help || flags.command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (flags.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (flags.command === 'explain') {
    process.stdout.write(`${EXPLANATION}\n`);
    return 0;
  }

  try {
    const root = repoRoot(process.cwd());

    if (flags.command === 'init') {
      const path = writeLedger(root);
      process.stdout.write(`wrote ${path.replace(`${root}/`, '')}\n`);
      return 0;
    }

    if (flags.command !== 'verify') {
      process.stderr.write(`alibi: unknown command "${flags.command}"\n${USAGE}\n`);
      return 3;
    }

    const config = loadConfig(root);
    const quiet = flags.json || flags.markdown;

    const report = verify({
      cwd: root,
      base: flags.base,
      runner: flags.runner ?? config.runner,
      command: flags.template ?? config.command,
      link: [...(config.link ?? []), ...flags.link],
      timeoutMs: (flags.timeout ?? config.timeout ?? 120) * 1000,
      suite: flags.suite && config.suite !== false,
      mutate: flags.mutate || config.mutate === true,
      mutants: flags.mutants ?? config.mutants,
      claims: flags.claims,
      onEvent: quiet ? undefined : (event) => drawProgress(event, flags.color),
    });

    if (!quiet) clearProgress();

    if (flags.json) {
      process.stdout.write(`${toJson(report)}\n`);
    } else if (flags.markdown) {
      process.stdout.write(`${toMarkdown(report)}\n`);
    } else {
      process.stdout.write(render(report, { color: flags.color, verbose: flags.verbose }));
    }

    return exitCodeFor(report, flags.strict);
  } catch (error) {
    process.stderr.write(`alibi: ${(error as Error).message}\n`);
    return 3;
  }
}

let progressWidth = 0;

function drawProgress(event: ProgressEvent, color: boolean): void {
  if (!process.stderr.isTTY) return;
  const text =
    event.type === 'phase'
      ? `  ${event.name}…`
      : `  ${event.index}/${event.total}  ${event.name}`;
  const line = text.length > 78 ? `${text.slice(0, 75)}…` : text;
  progressWidth = Math.max(progressWidth, line.length);
  const dim = color ? '\u001b[2m' : '';
  const reset = color ? '\u001b[0m' : '';
  process.stderr.write(`\r${dim}${line.padEnd(progressWidth)}${reset}`);
}

function clearProgress(): void {
  if (!process.stderr.isTTY || progressWidth === 0) return;
  process.stderr.write(`\r${' '.repeat(progressWidth)}\r`);
}
