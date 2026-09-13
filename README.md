<h1>alibi</h1>

<p><strong>Every green test needs an alibi.</strong></p>

<p>
  <a href="https://www.npmjs.com/package/@botiroff/alibi"><img src="https://img.shields.io/npm/v/@botiroff/alibi?color=f85149&label=npm" alt="npm"></a>
  <a href="https://github.com/BOTIROFF-D/alibi/actions/workflows/ci.yml"><img src="https://github.com/BOTIROFF-D/alibi/actions/workflows/ci.yml/badge.svg" alt="ci"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a>
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-3fb950" alt="zero runtime dependencies">
</p>

Your agent says it fixed the bug and the tests pass. `alibi` puts the source back
the way it was, runs the tests it just wrote, and reports the ones that still
pass. A test that has never been red has not tested the change.

No model is asked anything. No API key, no network, no telemetry. It asks git
and your test runner, and it gives the same answer every time.

<p align="center">
  <img src="https://raw.githubusercontent.com/BOTIROFF-D/alibi/main/docs/card.svg" alt="alibi reporting one test with no alibi, one deleted test, and two false claims" width="760">
</p>

<sub>The picture is not a mock-up: it is generated from a real run by
<code>scripts/card.mjs</code>, so it cannot claim something the tool has stopped
doing.</sub>


## Install

For a coding agent — the agent runs it before it tells you it is done:

```
npx skills add BOTIROFF-D/alibi
```

Works with Claude Code, Cursor, Codex CLI, Copilot CLI, Gemini CLI, Windsurf,
Cline, OpenCode, Zed and anything else that reads `SKILL.md` or `AGENTS.md`.
See [installing by hand](#installing-by-hand) if your agent is not on that list.

For you and for CI:

```
npm install -g @botiroff/alibi
alibi
```

Or without installing anything: `npx @botiroff/alibi`.

Node 18.17 or newer. No runtime dependencies.

## The problem this exists for

The measurements are not mine, and they agree with each other:

- **75.8%** of failing coding-agent trajectories in AppWorld still reported
  success. In single-control tau2-bench domains it was 45–48%.
  ([From Confident Closing to Silent Failure](https://arxiv.org/abs/2606.09863), Advani, June 2026)
- Asking another model to check is close to a coin flip: **no configuration
  across 5 judges and 5 prompt strategies exceeded AUROC 0.65**, and the same
  judges reached 0.54 on AppWorld. Judges read the confident closing tone
  rather than the state of the machine. (same paper)
- Of 4,882 agent-generated pull requests, the ones that changed code *and*
  tests improved coverage over the existing suite in **35.9%** of cases in Java
  and **22.5%** in Python.
  ([Test Coverage Analysis of Agentic Pull Requests](https://arxiv.org/abs/2607.18057),
  Dipongkor et al., July 2026)
- The single most common complaint about AI in the 2025 Stack Overflow survey
  of 49,000+ developers was **"almost right, but not quite" (45%)**, and
  **66%** said they spend more time fixing that almost-right code.

The common thread is not that agents are bad at writing code. It is that the
only thing asked whether the work was done was the thing that did the work.

`alibi` moves the question somewhere it cannot be answered with a tone of
voice.

## What it checks

**1. The diff, before anything is run.** A test that was deleted, a test that
gained a `skip`, a test that quietly lost half its assertions. These are read
straight out of `git diff` and reported as facts, because that is what they
are.

**2. The alibi run.** A throwaway git worktree is created at the base revision
— the world before the change. The new and modified *test* files are copied
over it. The source is left old. Then every new or changed test is run on its
own, and the only thing read is the exit code.

- The test fails → it has an **alibi**. It is evidence for the change.
- The test passes → it has **none**. It may be testing something real, but not
  this.
- The test never ran, because it imports code that did not exist yet →
  **provisional**. That is expected for a new module and proves nothing in
  either direction. Collapsing it into either of the other two would be a lie
  in one direction or the other.

**3. A static reading of the new tests.** Assertions that cannot fail
(`expect(true).toBe(true)`), tests with no assertion at all, a lone
`toBeDefined`, a snapshot written by the same run that reads it, a subject
mocked out of the test that is supposed to cover it. These are pattern matches,
so they are reported as *unproven* and never as a lie. The line between what
the machine observed and what a regex suspected is the reason to trust the
first half.

**4. Mutation of the changed lines** (`--mutate`, off by default). Each line
the change touched is damaged one at a time — a comparison relaxed, a
conjunction weakened, a guard removed — and the tests are given a chance to
object. A mutant nothing objects to is a line nothing is watching.

**5. The ledger.** `.alibi/claims.md` holds what the author of the change
claims, one line each, tagged with the kind of evidence that would settle it.
Nothing here reads English: the tag picks the check, the sentence is for the
human.

```markdown
- [tests] covers the retry path
- [fix] fixed the race in SessionStore.flush
- [pass] the suite passes
- [safe] no existing test was removed, skipped or weakened
```

`perf` claims are always returned unproven, with a note asking for a benchmark.
Refusing to grade what it cannot measure is the point of the file.

## Verdicts and exit codes

| Exit | Meaning |
| --- | --- |
| `0` | nothing false |
| `1` | a green lie, or a claim contradicted by evidence |
| `2` | something is merely unproven, and `--strict` was given |
| `3` | the tool could not answer — no runner, no repository, bad options |

A **green lie** is only ever produced by an executed run or by the diff: a test
that passes without the change, a test that was deleted or switched off, a
suite that does not actually pass. A pattern match never becomes one.

## In CI

```yaml
- uses: BOTIROFF-D/alibi@v0
  with:
    base: ${{ github.event.pull_request.base.sha }}
    strict: false        # exit 2 on findings that are only unproven
    mutate: false        # also damage the changed lines
```

The action needs the base commit, so give the checkout step some history:
`actions/checkout@v4` with `fetch-depth: 0`.

Or without the action:

```bash
npx @botiroff/alibi verify --base origin/main --markdown >> "$GITHUB_STEP_SUMMARY"
```

## Deliberate exceptions

A characterization test — one written to lock in behaviour that already exists
— has no alibi by definition, and that is correct. Say so where it is written:

```js
// alibi: characterization
it('still renders the legacy header', () => { ... });
```

It stays in the report, marked, and stops counting against the verdict. There
is no way to silence it invisibly, and there will not be one.

## Configuration

Most projects need none. `alibi.json` when yours does:

```json
{
  "runner": "pytest",
  "link": [".venv"],
  "timeout": 180,
  "mutate": false
}
```

| Key | Meaning |
| --- | --- |
| `runner` | `vitest`, `jest`, `mocha`, `node`, `pytest`, `go`, `cargo`, `rspec`, `phpunit` |
| `command` | a shell template for anything else: `{file}`, `{name}`, `{fullName}` |
| `link` | directories to link into the throwaway worktree, e.g. `.venv`, `target` |
| `timeout` | per-test seconds, default 120 |
| `suite` | run the whole suite once, default true |
| `mutate`, `mutants` | mutation pass and its budget, default off and 8 |

## Limits

Read these before trusting a green report.

- **It cannot prove a change is correct.** It can only find tests that are not
  evidence for it. An empty report means nothing was caught, which is not the
  same as nothing being wrong.
- **It says nothing about tests the diff did not touch.** Whatever alibi they
  had, they had it before.
- **Rust unit tests live in the file they test.** Reverting the source would
  revert the test with it, so `#[cfg(test)]` blocks inside a changed source
  file are left alone and reported as unexamined rather than guessed at.
- **The throwaway worktree does not install anything.** Dependency directories
  are linked, not built. A project whose test command needs a build step first
  needs that step in `command`.
- **The static reading has false positives**, which is why it can never produce
  a lie. A test asserting `toBeDefined` on a function that used to return
  `undefined` is a real test; the report says *unproven* and leaves the reading
  to you.
- **Editable Python installs** point an absolute path at your working tree, so
  a run inside the throwaway worktree can import the new code and pass there —
  the tool then accusing a perfectly good test. The worktree is put first on
  `PYTHONPATH` to shadow the installed copy, which works for a plain source
  tree and for the common `src/` layout, and does not work for every packaging
  arrangement. If a Python project reports implausibly many tests without an
  alibi, this is the first thing to suspect.
- **The tests are run one process each.** On a suite with heavy global setup
  this is slow. `--no-suite` and a smaller diff help; a fast mode that trusts
  parsed output does not exist, because parsed output is what this tool
  refuses to trust.
- **It cannot see money.** It says nothing about how many tokens the session
  spent, because nothing in the working tree records it.

## Prior art, and what is different

Mutation testing is old — DeMillo, Lipton and Sayward, 1978 — and well served
by [PIT](https://pitest.org), [Stryker](https://stryker-mutator.io) and
[mutmut](https://github.com/boxed/mutmut). Those tools ask: *if I injected a
bug, would the suite notice?* It is the right question and it costs hundreds of
runs to answer.

`alibi` asks a cheaper and more pointed one: *did the suite notice the bug that
was actually there?* The change itself is the mutant. There is no operator to
argue with, no sampling strategy to tune, and the cost is one run per new test.
The mutation pass is still here for the lines a change touched, but it is the
second question, not the first.

The idea that a test must be seen to fail is older than any of it: it is the
red in red-green-refactor. What is new is that nobody is watching the red any
more, because the thing writing the test is also the thing reporting on it.

## Installing by hand

`skills/alibi/SKILL.md` is the whole integration. Copy it to wherever your agent
reads instructions from:

| Agent | Path |
| --- | --- |
| Claude Code | `.claude/skills/alibi/SKILL.md` |
| Cursor | `.cursor/rules/alibi.md` |
| Codex CLI, Copilot CLI, Gemini CLI, Zed | `AGENTS.md` (append) |
| Windsurf | `.windsurf/rules/alibi.md` |
| Cline | `.clinerules/alibi.md` |
| anything else | any file it reads before finishing a task |

The skill is short on purpose: write the claims down, run `alibi`, do not
report the work as done while a claim is false.

## What it will never do

- Send your code anywhere. There is no network call in this repository.
- Ask a language model whether the work looks finished.
- Modify your working tree. Everything happens in a throwaway worktree, and
  there is a test that fails if a run leaves a single byte changed.
- Grade a claim it cannot check, or hide one it cannot check behind a pass.

## Contributing

The interesting contributions are new runners and new green lies. A green lie
belongs in `examples/museum/` with the diff that produces it and the report
that catches it. See [CONTRIBUTING.md](CONTRIBUTING.md) and
[DESIGN.md](DESIGN.md).

Other languages: [Русский](README.ru.md) · [中文](README.zh-CN.md)

## Author

[Doniyor Botirov](https://dbit.one/en/founder) — founder of
[dbit.one](https://dbit.one), where I write the architecture myself. Other
things I have built in the open: a
[deterministic simulation tester](https://github.com/BOTIROFF-D/unflake), a
[Raft implementation held up by seeded failures](https://github.com/BOTIROFF-D/bulwark),
an [MVCC engine with its isolation levels convicted](https://github.com/BOTIROFF-D/adya),
and an [explicit-state model checker](https://github.com/BOTIROFF-D/pnueli).

They share this one's assumption: a green run carries no information until
something has tried to make it red.

MIT.
