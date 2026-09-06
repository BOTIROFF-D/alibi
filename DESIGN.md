# Design

Notes on the decisions that are not obvious from the code, and on the ones that
were tempting and rejected. If you are here to change something, this file is
the argument you are arguing with.

## The one question

Everything in the tool is a consequence of a single question: *would this test
have failed before the change it was written for?* The answer is produced by
running the test against the old source and reading an exit code. It is not
inferred, scored, or judged.

That is the whole reason the tool can be trusted at the moment it matters most
— when it contradicts a confident summary.

## Why a throwaway worktree, and not a stash

The obvious implementation reverts the source in place, runs the tests, and
puts everything back. It is faster and it is wrong. An agent is frequently
still working in that directory; so is the person reading its output. A tool
whose failure mode is "your uncommitted work briefly disappeared, and then the
process was killed" has no business running unattended.

`git worktree add --detach` costs a checkout and buys the guarantee that the
working tree is never written to. There is a test that fails if a run leaves
`git status` even one byte different, and it is not an optional test.

Dependency directories are linked into the worktree rather than installed,
because an install would take longer than the verification and could fail for
reasons that have nothing to do with the change.

## Why exit codes, and never parsed output

Every test runner prints results, and every one of them prints them
differently, changes the format between versions, and changes it again when a
reporter is configured. A parser that is 98% correct produces a false
accusation every fiftieth run, and one false accusation costs more trust than
fifty correct ones earn.

So each test is asked on its own, by name, and the only thing read is the exit
code. It is slower. It is the difference between a tool that can say "this test
passed against the old source" and one that can say "this text looked like a
pass".

Two consequences follow. A runner that cannot select a single test by name does
not get an adapter. And there is no fast mode that trusts parsed output,
because parsed output is exactly what this tool exists not to trust.

## Why `provisional` is its own verdict

A new test for a module that does not exist yet cannot import it. Against the
old source the runner exits non-zero without ever evaluating an assertion.

Counting that as an alibi would hand one to every test written against new
code, which is most of them, and the tool would report proof it does not have.
Counting it as *no alibi* would accuse a perfectly good test of proving
nothing. Both are lies in opposite directions, so it gets its own name and
proves nothing on purpose.

Detection is a list of patterns — `ModuleNotFoundError`, `Cannot find module`,
`error[E0433]`, and their relatives. This is the one place the tool reads
output rather than exit codes, and it does so only to choose between two ways
of *not* claiming evidence, never to claim any.

## Why a static reading may never accuse

The vacuity checks are regular expressions. They are useful — a lone
`toBeDefined` really is worth a second look — and they are wrong often enough
that letting one produce a `lie` would make every verdict negotiable.

So the severity ladder is fixed by provenance, not by how bad the finding
looks:

| Provenance | Strongest verdict |
| --- | --- |
| an executed run | `lie` |
| the diff itself | `lie` |
| a pattern match | `unproven` |

A reader who disagrees with an `unproven` finding has lost nothing. A reader
who catches the tool calling a pattern match a lie has lost the tool.

## Why the ledger has tags

The alternative is reading the agent's closing paragraph and deciding what it
promised. That is natural-language inference, it needs a model, and models are
at AUROC 0.65 on exactly this task — they read the confident tone.

A tag is a claim about which evidence applies. `[pass]` means the suite exits
zero; the sentence after it can say anything at all and the check does not
change. This also makes the one honest answer cheap: `perf` claims are always
returned unproven, because nothing in a diff can settle them.

## Why the change is the mutant

Mutation testing injects a synthetic bug and asks whether the suite notices.
It answers a broader question than this tool does and costs hundreds of runs to
answer it.

The alibi run uses a mutant that is already there and known to be meaningful:
the bug that was actually fixed. One run per new test, no operators to argue
about, and the result is about the change someone actually made rather than
about a bug nobody had.

The mutation pass remains, bounded to the lines the change touched, for the
second question — whether anything watches those lines at all. It is off by
default because it is the slower question and the less pointed one.

## Why the environment is stripped

A nested test run inherits `NODE_TEST_CONTEXT`, `PYTEST_CURRENT_TEST`,
`VITEST_WORKER_ID` and their relatives, and a runner that finds them believes
it is already inside another runner. It then reports to a parent that is not
listening instead of failing, and exits zero.

That failure mode is silent and it points the wrong way: real tests get accused
of having no alibi. The variables are deleted for every spawned run. This was
found by the tool's own integration test, which is the argument for having one.

## What was rejected

**Asking a model to grade the summary.** It is the cheapest thing to build and
it reproduces the problem it claims to solve.

**Parsing the agent's transcript to extract claims.** Every harness stores them
differently, the formats change weekly, and the result would be a tool that
works with two agents and rots. A file the agent writes works with all of them.

**A `--fix` mode that strengthens weak tests.** A tool that both writes tests
and grades them is the thing this exists to replace.

**Counting how much a session cost.** It would be the best line in the report,
and nothing in the working tree records it. An unverifiable number in a tool
about verification is not worth the sentence it would print.

**Silencing a finding from configuration.** The characterization marker excuses
a test from the verdict and keeps it in the report. A silence that leaves no
mark would eventually be used to make a report quiet rather than true.
