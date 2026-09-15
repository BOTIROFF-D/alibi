# Do the tests coding agents write actually test the change?

Measured with [alibi](https://github.com/BOTIROFF-D/alibi) over merged pull requests written by five coding agents. Generated 2026-09-15T07:38:13.484Z.

## The funnel

| | |
| --- | --- |
| pull requests attempted | 200 |
| measured | 17 |
| dropped | 183 |

Every drop, by reason:

| reason | count |
| --- | --- |
| the suite could not be started here | 50 |
| suite already failing at the base commit | 33 |
| the suite needs infrastructure this harness does not provide | 30 |
| no test produced a definitive answer against the base source | 21 |
| npm install failed | 12 |
| commits no longer fetchable | 11 |
| pip install -e . failed | 8 |
| no package.json | 7 |
| pip install -r requirements.txt failed | 6 |
| go mod download failed | 5 |

**This selection is not neutral, and it leans the friendly way.** A repository whose suite installs and passes unattended at the base commit is a better-kept repository than one that does not. If anything, the pull requests that survived the funnel come from projects with more test discipline than the ones that did not, which makes the number below a floor rather than an estimate.

## The result

| | count | share of answered |
| --- | --- | --- |
| tests added and answered | 140 | 100% |
| **went red without the change** | **105** | **75.0%** |
| **passed without the change** | **35** | **25.0%** |

A further 19 added tests could not be answered at all: they never ran against the base source, because the code they import did not exist yet. That is expected for new modules and is evidence in neither direction, so they are outside the denominator rather than inside it on favourable terms.

2 of the 17 measured pull requests (11.8%) added tests of which **not one** would have failed without the change.

Alongside that: 4 existing tests were deleted or switched off in these diffs, and 3 added tests carry an assertion that cannot fail or no assertion at all.

## By language

| language | pull requests | tests answered | passed without the change |
| --- | --- | --- | --- |
| typescript | 7 | 48 | 14 (29.2%) |
| go | 3 | 37 | 0 (0.0%) |
| javascript | 4 | 32 | 7 (21.9%) |
| python | 3 | 23 | 14 (60.9%) |

## By agent

These counts are too small to rank anything, and are here so that the corpus is not mistaken for one agent.

| agent | pull requests | tests answered | passed without the change |
| --- | --- | --- | --- |
| devin-ai-integration | 7 | 58 | 20 (34.5%) |
| claude | 5 | 53 | 11 (20.8%) |
| codegen-sh | 1 | 16 | 0 (0.0%) |
| copilot-swe-agent | 4 | 13 | 4 (30.8%) |

## Go and check

Each of these is a merged pull request whose added test passes against the commit it was merged on top of. Check out the base commit, copy the test file in, run it.

| pull request | test | file |
| --- | --- | --- |
| [serio-ngo/handoff-os#25](https://github.com/serio-ngo/handoff-os/pull/25) | verify gate › stands down after two blocks so a session cannot be trapped | `test/guard.test.mjs:395` |
| [serio-ngo/handoff-os#22](https://github.com/serio-ngo/handoff-os/pull/22) | read and query budgets › credits a refused read once however often it is retried | `test/guard.test.mjs:271` |
| [koji-s-private/react-native-first-app#348](https://github.com/koji-s-private/react-native-first-app/pull/348) | HomeScreen › カレンダーの年月ジャンプ用ピッカー › sets minDate to the first day of the current month on the underlying Calendar component when there are no diary entries yet (正常系) | `tests/app/index.test.tsx:2664` |
| [koji-s-private/react-native-first-app#348](https://github.com/koji-s-private/react-native-first-app/pull/348) | HomeScreen › カレンダーの年月ジャンプ用ピッカー › sets minDate to the first day of the oldest diary entry month on the underlying Calendar component, not just the current month (境界値) | `tests/app/index.test.tsx:2674` |
| [osatetsu/tekken-code-image#40](https://github.com/osatetsu/tekken-code-image/pull/40) | convertTextNodesToPaths › returns original SVG when conversion is partial (missed/errors) | `test/path-converter.test.ts:63` |
| [osatetsu/tekken-code-image#40](https://github.com/osatetsu/tekken-code-image/pull/40) | extractFontFamilyName › prefers en over ja/default | `test/path-converter.test.ts:168` |
| [federicos-svg/fantacalcio-public#111](https://github.com/federicos-svg/fantacalcio-public/pull/111) | la formula: logit, ritaglio, indisponibilità › due fonti d'accordo su «quasi certo» non producono un dubbio (per questo la media è in logit) | `packages/source-reliability/tests/starterProbability.test.ts:309` |
| [federicos-svg/fantacalcio-public#111](https://github.com/federicos-svg/fantacalcio-public/pull/111) | ciò che si rifiuta invece di indovinarlo › una percentuale fuori da [0, 1] | `packages/source-reliability/tests/starterProbability.test.ts:461` |
| [B-icy/pi2#3](https://github.com/B-icy/pi2/pull/3) | real extension loads, gates writes, executes checks and rejects stale evidence | `tests/extension.test.mjs:38` |
| [B-icy/pi2#3](https://github.com/B-icy/pi2/pull/3) | edit calls normalize a JSON-encoded edits array | `tests/extension.test.mjs:129` |
| [nbstyle69/AthleX-Manager#332](https://github.com/nbstyle69/AthleX-Manager/pull/332) | pages de retour auth — aucun routage par type › les liens déjà envoyés sous /email-confirme/auth/* retombent sur /auth/* | `__tests__/lib/authLinks.test.ts:60` |
| [amarazzi/argentina-news-digest#10](https://github.com/amarazzi/argentina-news-digest/pull/10) | test_el_deporte_entra_solo_si_es_un_hito | `tests/test_judge.py:56` |
| [amarazzi/argentina-news-digest#10](https://github.com/amarazzi/argentina-news-digest/pull/10) | test_lo_internacional_entra_solo_si_es_extraordinario | `tests/test_judge.py:70` |

## How to reproduce this

```
git clone https://github.com/BOTIROFF-D/alibi && cd alibi
npm install && npm run build
cd experiments/corpus
node collect.mjs --limit 200      # needs gh, authenticated
node measure.mjs --take 200       # hours, and it clones and installs 200 repositories
node summarize.mjs
```

`candidates.json` and `results.json` are committed, so the numbers above can be checked without re-running anything. The corpus will drift as repositories change; a rerun will not reproduce it exactly, and the committed files are what these numbers were computed from.

## What this does not say

- It does not say the changes were wrong. Every one of these pull requests was merged, and most of the fixes are probably fine. It says the tests shipped with them are not the reason to believe so.
- It does not compare agents with people. No human-authored control group was measured, and until one is, nobody should read this as a statement about agents specifically rather than about how tests get written next to a change.
- It does not generalise past the funnel above. Small repositories with runnable suites are over-represented, because those are the ones that can be measured at all.
