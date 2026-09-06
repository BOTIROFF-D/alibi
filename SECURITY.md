# Security

## What this tool does with your code

Nothing leaves the machine. There is no network call in this repository, no
telemetry, no analytics, and no language model in the loop. The verification
runs entirely against your git repository and your own test runner.

## What it executes

It runs your project's test command, once per test, inside a throwaway git
worktree. That command is yours — anything your test suite can do, a
verification can do. Run it on repositories you would already run `npm test`
in, and no others.

The `--command` option and the `command` key in `alibi.json` are passed to a
shell. They are configuration, not input: treat a repository that ships its own
`alibi.json` the same way you would treat one that ships its own `Makefile`.

## Reporting a vulnerability

Mail hello@dbit.one with the details and a way to reproduce it. I answer
personally, usually within a day. Please do not open a public issue for
anything that would be exploitable before there is a fix.
