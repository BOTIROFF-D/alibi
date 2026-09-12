# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions
follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-09-12

Three fixes, all found by running the tool against a corpus of merged pull
requests written by coding agents rather than against its own examples.

### Fixed

- **A real failure could be filed as "never ran".** The two lists behind the
  `provisional` verdict were merged rather than ordered, so an assertion
  failure whose message happened to contain `is not a function` or
  `undefined:` — which is what a great many honest failures say — was read as
  a test that never started. Such a test left the report as provisional
  instead of as an alibi, silently, which is the worst way for this tool to be
  wrong. Evidence that a test body was entered now settles the question, and
  the never-ran patterns are consulted only in its absence.
- **A python project with no config file was refused.** A `tests/` directory
  full of `test_*.py` and no `pytest.ini`, `pyproject.toml` or
  `requirements.txt` produced "no test runner found" — a refusal over a
  missing config file rather than a missing runner. Config files are still
  tried first; failing that, the filenames are now consulted, three
  directories deep, skipping vendored trees.
- **Installing the skill copied the whole repository.** With `SKILL.md` at the
  root, `npx skills add` put `src/`, `test/`, `experiments/`, `tsconfig.json`
  and the lockfile into the user's project: 98 files to deliver one page of
  instructions. The skill now lives in `skills/alibi/`, and an install is one
  file.

### Added

- `experiments/corpus/` — the collector, measurer and summariser used to ask
  the tool's own question of merged agent-written pull requests. The funnel is
  recorded as it happens: anything that cannot be installed, or whose suite is
  already red at the base commit, is dropped and counted as dropped.

## [0.1.0] — 2026-09-07

First public release.

### Added

- The alibi run: a throwaway worktree at the base revision, the new tests
  copied over it, one process per test, exit codes only.
- Three verdicts — `alibi`, `provisional`, `none` — with `provisional` kept
  separate so that a test written against a module that does not exist yet is
  not counted as evidence.
- Diff checks for deleted tests, newly skipped tests and weakened assertions.
- A static reading for assertions that cannot fail, tests without assertions,
  lone existence checks, swallowed exceptions and a mocked subject. These
  never produce a lie.
- An optional mutation pass over the lines the change touched.
- The claims ledger, `.alibi/claims.md`, and the tags `tests`, `fix`, `pass`,
  `safe` and `perf`.
- Runners: vitest, jest, mocha, `node --test`, pytest, `go test`,
  `cargo test`, rspec, phpunit, and a shell template for anything else.
- Reports for a terminal, for a machine (`--json`) and for a pull request
  (`--markdown`).
- The `alibi: characterization` marker, which excuses a test from the verdict
  without hiding it from the report.
