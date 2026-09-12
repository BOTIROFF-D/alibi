# Installing into a coding agent

`SKILL.md` at the root of this repository is the whole integration. The
`skills` CLI copies it into whichever agents it finds:

```
npx skills add BOTIROFF-D/alibi          # every agent on this machine
npx skills add BOTIROFF-D/alibi -g       # globally, not just this project
npx skills add BOTIROFF-D/alibi --agent claude-code
```

## By hand

Copy `SKILL.md` to wherever your agent reads instructions from. The file is
plain Markdown with YAML front matter; nothing in it is specific to a vendor.

| Agent | Path |
| --- | --- |
| Claude Code | `.claude/skills/alibi/SKILL.md` |
| Cursor | `.cursor/rules/alibi.md` |
| Windsurf | `.windsurf/rules/alibi.md` |
| Cline | `.clinerules/alibi.md` |
| Codex CLI, Copilot CLI, Gemini CLI, Zed, OpenCode | append to `AGENTS.md` |
| anything else | any file it reads before finishing a task |

## What the agent is told to do

Four steps, and the third is the one that matters:

1. Write the claims down in `.alibi/claims.md` **before** running anything.
   A claim written after seeing the verdict is a description of the verdict.
2. Run `npx -y @botiroff/alibi verify`.
3. Act on what comes back. A test with no alibi gets strengthened or marked as
   a characterization test — never quietly left alone. A deleted or skipped
   test gets put back, or explained in the summary.
4. Report the verdict lines verbatim in the summary, and do not describe the
   work as done while the command exits non-zero.

## Why it is worth a place in the agent's instructions

An agent that runs this before reporting can no longer say "added a test for
it" about a test that passes on the code from before the fix. Not because it
was told not to — because the exit code says otherwise, and it has to paste
the exit code.
