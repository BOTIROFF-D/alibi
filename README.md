<h1>alibi</h1>

<p><strong>Your agent says "Done. All tests pass."</strong><br>
This reverts the fix, runs the new test again, and shows you the ones that still pass.</p>

<p><em>A test that has never failed has never tested anything.</em></p>

<p>
  <a href="https://www.npmjs.com/package/@botiroff/alibi"><img src="https://img.shields.io/npm/v/@botiroff/alibi?color=f85149&label=npm" alt="npm"></a>
  <a href="https://github.com/BOTIROFF-D/alibi/actions/workflows/ci.yml"><img src="https://github.com/BOTIROFF-D/alibi/actions/workflows/ci.yml/badge.svg" alt="ci"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a>
  <img src="https://img.shields.io/badge/runtime%20deps-0-3fb950" alt="zero runtime dependencies">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/BOTIROFF-D/alibi/main/docs/card.svg" alt="alibi catching a test that passes without the change" width="760">
</p>

## Install

```
npx skills add BOTIROFF-D/alibi
```

Your agent now runs the check before it says "done". Claude Code, Cursor,
Codex, Copilot, Gemini, Windsurf, Cline, Zed and 70 others.

Nothing to install for that — the skill uses git and your own test command.

For your terminal and CI:

```
npm install -g @botiroff/alibi && alibi
```

## The trick

1. Put the source back the way it was.
2. Run the test your agent just wrote.
3. It should fail. If it passes, it never tested the fix.

That is the whole idea. No model, no API key, no network.

## What it catches

| | |
| --- | --- |
| the new test passes on the old code | it tested nothing |
| the failing test was deleted | green because there is less of it |
| the failing test was `skip`ped | one word, and it never runs again |
| the test asserts nothing | it can only fail by crashing |
| the test mocks the thing that changed | a photo of a bridge holds no weight |
| the assertion was softened | it checked contents, now it checks length |

Each of these is a real repository in [`examples/museum`](examples/museum),
built and checked by CI. If one stops being caught, the build breaks.

## Why this exists

- **75.8%** of failing coding-agent runs still report success
  ([paper](https://arxiv.org/abs/2606.09863))
- Asking another model to check is a coin flip: best **AUROC 0.65**, same paper
- Agent pull requests that touch code *and* tests improve coverage in **35.9%**
  of cases in Java and **22.5%** in Python
  ([paper](https://arxiv.org/abs/2607.18057))
- **45%** of developers say the top problem with AI is "almost right, but not
  quite" (Stack Overflow 2025, 49k respondents)

The thing that wrote the code is the only thing being asked whether it works.
An exit code has no tone of voice.

## Exit codes

| | |
| --- | --- |
| `0` | nothing false |
| `1` | a test passed on the old code, or a test was deleted or skipped |
| `2` | something is only unproven, with `--strict` |
| `3` | could not answer |

## In CI

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: BOTIROFF-D/alibi@v0
```

## When a test *should* pass without the fix

Characterization tests lock in behaviour that already exists. Say so:

```js
// alibi: characterization
it('still renders the legacy header', () => { ... });
```

It stays in the report, marked, and stops counting against you. There is no way
to silence a finding invisibly, and there will not be one.

## Limits

- It cannot prove your change is correct. It finds tests that are not evidence
  for it. An empty report means nothing was caught.
- It says nothing about tests your diff did not touch.
- Rust unit tests live inside the file they test, so reverting would revert the
  test too. Those are reported as unexamined.
- One process per test. On a suite with heavy setup this is slow. There is no
  fast mode that trusts parsed output, because parsed output is exactly what
  this refuses to trust.
- Editable Python installs can shadow the reverted source. The worktree goes
  first on `PYTHONPATH`, which covers the usual layouts and not all of them. If
  a Python project reports implausibly many failures, suspect this first.

More in [`DESIGN.md`](DESIGN.md) — including why a regex is never allowed to
call something a lie, and why "it never ran" is a third verdict rather than a
failure.

## Runners

vitest · jest · mocha · `node --test` · pytest · `go test` · `cargo test` ·
rspec · phpunit · or any shell command you give it.

## Configuration

Most projects need none. `alibi.json` if yours does:

```json
{ "runner": "pytest", "link": [".venv"], "timeout": 180 }
```

| key | meaning |
| --- | --- |
| `runner` | force one instead of detecting it |
| `command` | a shell template: `{file}`, `{name}`, `{fullName}` |
| `link` | directories to link into the throwaway worktree |
| `timeout` | per-test seconds, default 120 |
| `mutate` | also damage the changed lines and see if anything objects |

## Prior art

Mutation testing ([PIT](https://pitest.org),
[Stryker](https://stryker-mutator.io),
[mutmut](https://github.com/boxed/mutmut)) asks: *if I injected a bug, would
the suite notice?* Hundreds of runs to answer.

This asks a cheaper one: *did it notice the bug that was actually there?* Your
change is the mutant. One run per new test.

## Contributing

The most useful thing you can send is a green suite this **doesn't** catch.
[Open an issue](https://github.com/BOTIROFF-D/alibi/issues/new?template=green-lie.yml)
and it becomes exhibit number seven.

Other languages: [Русский](README.ru.md) · [中文](README.zh-CN.md)

## Author

[Doniyor Botirov](https://dbit.one/en/founder), founder of
[dbit.one](https://dbit.one). Also:
[unflake](https://github.com/BOTIROFF-D/unflake) ·
[bulwark](https://github.com/BOTIROFF-D/bulwark) ·
[adya](https://github.com/BOTIROFF-D/adya) ·
[pnueli](https://github.com/BOTIROFF-D/pnueli) ·
[sable](https://github.com/BOTIROFF-D/sable)

MIT.
