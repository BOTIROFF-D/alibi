# Working in this repository

Read `DESIGN.md` before changing anything under `src/checks/`. The severity
ladder there is not a style choice: a pattern match may never produce a `lie`,
and an executed run or the diff may.

Rules that the tests enforce, so you will find out anyway:

- No runtime dependencies, and no network calls.
- No parsing of test-runner output to decide pass or fail. Exit codes only.
- A verification must leave `git status` byte-identical.

Before reporting a change here as done, run it against itself:

```
npm run build && node bin/alibi.js verify
```
