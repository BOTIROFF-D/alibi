# Contributing

## The two contributions that help most

**A new runner.** `src/runner.ts` holds one object per test runner: how to run
one test, one file, and the whole suite. Adding one is about fifteen lines, and
it needs a fixture under `examples/` proving the single-test filter actually
selects a single test.

**A new green lie.** Anything that makes a suite green without making it
meaningful. Add it to `examples/museum/` as a directory containing the change
that produces it and a note on what the report says. If the report does not
catch it, that is the most useful issue you can open.

## Ground rules

- **No runtime dependencies.** The tool has to run inside other people's
  projects without adding to their tree.
- **Nothing over the network.** Ever, for any reason.
- **A static reading may never produce a lie.** Pattern matches are reported as
  `unproven`. Only an executed run or the diff itself can accuse.
- **No output parsing to decide pass or fail.** Exit codes only. If a runner
  cannot be asked about one test at a time, it does not get an adapter yet.

## Working on it

```
npm install
npm run build
npm test
```

The suite includes an integration test that builds a real repository, commits a
real bug, and checks that each of the four cases — a test with an alibi, a test
without one, a deleted test, and a fix with no test — is reported correctly.
Mocking git there would only test the mocks.

One test asserts that a run leaves `git status` byte-identical. If you change
anything about the worktree handling, that is the test to watch.

## Commits

Present tense, one change per commit, and a body when the reason is not obvious
from the diff. No generated commit messages.
