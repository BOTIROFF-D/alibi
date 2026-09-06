# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions
follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

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
