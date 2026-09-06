---
name: alibi
description: Before reporting a code change as done, prove the tests are evidence for it. Writes down the claims, reverts the change, reruns the new tests against the old source, and refuses to report done while a claim is contradicted. Use at the end of any task that changed code or tests.
license: MIT
---

# alibi

A test that has never been red has not tested anything. Before you tell anyone
the work is done, establish which of the tests you wrote would have failed
without your change.

## When to use this

At the end of any task that changed source or test files. Not during
exploration, not between edits — once, before reporting the work.

## Procedure

**1. Write the claims down first, before running anything.** Create or update
`.alibi/claims.md`. One line per claim, each tagged. Only claim what you
actually did:

```markdown
- [tests] covers the retry path in SessionStore
- [fix] fixed the race that dropped the second flush
- [pass] the suite passes
- [safe] no existing test was removed, skipped or weakened
```

Tags and what each one means:

| Tag | The claim | What settles it |
| --- | --- | --- |
| `tests` | the new tests cover the change | a new test fails when the change is taken away |
| `fix` | something that was broken is not any more | at least one test fails without the change |
| `pass` | the suite passes | the suite exits zero |
| `safe` | nothing was broken to get there | no test deleted, skipped or weakened |
| `perf` | it is faster | nothing here — attach a benchmark instead |

Leave out any claim you are not making. An absent claim costs nothing; a false
one is the thing this exists to catch.

**2. Run it.**

```
npx -y @botiroff/alibi verify
```

Add `--base origin/main` when the work spans several commits rather than the
working tree. Add `--mutate` when the change is one you would not want to be
wrong about.

**3. Read the verdict and act on it.**

- **`NO ALIBI`** — that test passes against the source from before your change.
  It is not evidence for what you did. Either strengthen it until it fails
  without your change, or, if it is deliberately locking in existing behaviour,
  mark it in the test file with a comment `alibi: characterization` and say so
  in your summary.
- **`PROVISIONAL`** — the test could not run against the old source because the
  module did not exist yet. Expected for new code. Not evidence either.
- **A deleted or skipped test** — put it back, or explain in your summary
  exactly why it should be gone. Never leave this one silent.
- **`unproven` findings** — a static reading of your test found an assertion
  that cannot fail, a lone existence check, or the subject mocked out. Look at
  each one; some are fine, and you should say which and why.
- **A false claim** — fix the work or remove the claim. Do not do the second
  one to avoid the first.

**4. Report honestly.** Paste the verdict lines into your summary. If anything
is `false` or `unproven`, say so in your own words at the top of the summary,
before the description of what you built. Do not describe work as done while
`alibi` exits non-zero.

## Rules

- Never mark a test with `alibi: characterization` to make the report quiet.
  The marker is for tests that genuinely lock in existing behaviour, and it
  stays visible in the report either way.
- Never delete, skip, or weaken a test to make a suite green. If a test is
  wrong, say that it is wrong and why, as its own change.
- Never claim `[pass]` without having run the suite.
- If the tool cannot run at all (exit code 3), report that plainly instead of
  reporting the work as verified.

## Why this exists

Across 4,882 agent-generated pull requests, the ones that changed both code and
tests improved coverage over the existing suite in 35.9% of cases in Java and
22.5% in Python. Among failing coding-agent trajectories in AppWorld, 75.8%
still reported success. Asking another model to check does not help: no judge
configuration exceeded AUROC 0.65.

The exit code of a test run against the old source is not a matter of opinion.
