---
name: alibi
description: Before you say "done, tests pass" — revert your own fix, run the test you just wrote, and check that it fails. A test that has never failed has never tested anything. Use at the end of any task that changed code or tests.
license: MIT
---

# alibi

Before you report a change as done, prove the tests you wrote are evidence for it.

**A test that has never failed has never tested anything.**

## When

At the end of any task that changed source or test files. Once, before you
report. Not during exploration.

## The check

Nothing to install. Six commands.

```bash
# 1. What did you change?
git status --porcelain

# 2. Make a copy of the world before your change.
git worktree add --detach /tmp/alibi-check HEAD

# 3. Copy your NEW TESTS into it. Only the tests. Leave the old source alone.
cp <each new or changed test file> /tmp/alibi-check/<same path>

# 4. Link dependencies so the suite can start (skip if not needed).
ln -s "$PWD/node_modules" /tmp/alibi-check/node_modules   # or .venv, vendor, target

# 5. Run each new test there, one at a time.
cd /tmp/alibi-check && <your test command, filtered to one test>

# 6. Clean up.
git worktree remove --force /tmp/alibi-check
```

If `HEAD` is not the right baseline — the work spans several commits — use the
branch point instead: `git merge-base HEAD origin/main`.

## Reading the result

| the test | means |
| --- | --- |
| **fails** there | good. It is evidence for your change. |
| **passes** there | it did not test your change. Fix it or say so. |
| **errors on import** (module not found) | expected for brand-new files. Proves nothing either way. Say so. |

## Also check, straight from the diff

```bash
git diff HEAD -- '<test paths>'
```

- A test that is **gone** — put it back, or explain in your summary why it should be.
- A test that gained **`skip`**, `xfail`, `t.Skip`, `@Disabled` — same.
- A test that **lost assertions** — say which and why.

Never make a suite green by removing the red part.

## Then report

Say, in your own summary, in this shape:

```
alibi: 4 new tests · 3 failed without the change · 1 did not
  ✕ "returns a list" (test/sessions.test.js:14) passes on the code from before the fix
```

**Do not write "done" or "tests pass" while a new test passes on the old code.**
Either strengthen it, or mark it deliberate and say you did:

```js
// alibi: characterization — locks in existing behaviour
```

## Two examples

**A test with no alibi.** The fix is real; the test is not evidence for it.

```js
// the change
-  for (const item of items) out.push(item);
+  if (seen.has(item.id)) continue;
+  seen.add(item.id);
+  out.push(item);

// the test that shipped with it
test('de-duplicates the list', () => {
  const out = dedupe([{ id: 'a' }, { id: 'a' }]);
  assert.ok(Array.isArray(out));      // it always returned an array
});
```

Reverted, this passes. Report it and strengthen it:

```js
assert.equal(dedupe([{ id: 'a' }, { id: 'a' }]).length, 1);   // now it fails without the fix
```

**A green suite with a hole in it.** Nothing was fixed; the test that disagreed
is gone.

```diff
-test('handles an empty list', () => {
-  assert.equal(dedupe([]).length, 0);
-});
```

The suite is green because there is less of it. Put the test back, or say in
your summary exactly why it should not exist.

## Rules

- Never mark a test as characterization to quiet the check.
- Never delete, skip or weaken a test to get a green suite. If a test is wrong,
  say that it is wrong, as its own change.
- Never claim the suite passes without having run it.
- If the check cannot run at all, say that plainly. Do not report the work as
  verified.

## Why

75.8% of failing coding-agent runs still report success. Asking another model
to check is a coin flip — best AUROC 0.65 across five judges and five prompt
strategies, because judges read the confident closing tone instead of the state
of the machine.

An exit code has no tone of voice.

## Automatic version

The same check, as one command, with the worktree, the cleanup, the diff
reading and the report handled for you:

```bash
npx -y @botiroff/alibi verify
```

Exit code `1` means a test passed on the old code, or a test was deleted or
skipped. Source and issues: https://github.com/BOTIROFF-D/alibi
