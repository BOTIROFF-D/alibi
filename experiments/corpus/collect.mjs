/**
 * Collects merged pull requests written by coding agents.
 *
 * The search API cannot ask "did this pull request touch a test file", so the
 * filtering happens here: over-fetch by author and language, then look at the
 * file list of each candidate and keep only the ones that changed source *and*
 * tests. Those are the pull requests where the question "would these tests have
 * failed before the change?" is meaningful at all.
 *
 * Selection is written down as it happens. Every pull request that is fetched
 * and then dropped is recorded with the reason, so the funnel from "what the
 * search returned" to "what was measured" can be audited by someone who
 * disagrees with the result.
 *
 *   GITHUB_TOKEN=... node collect.mjs [--limit 400] [--out candidates.json]
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const AUTHORS = [
  'devin-ai-integration[bot]',
  'copilot-swe-agent[bot]',
  'claude[bot]',
  'codegen-sh[bot]',
  'openhands-agent',
];

/**
 * Languages whose test suites can plausibly be run unattended. The check needs
 * to install dependencies and run a suite in a container-less sandbox; JVM and
 * mobile toolchains do not survive that, so they are not pretended at.
 */
const LANGUAGES = ['javascript', 'typescript', 'python', 'go'];

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};

const LIMIT = Number(flag('limit', 400));
const OUT = flag('out', 'candidates.json');

function api(path, params = {}) {
  const args = ['api', '-X', 'GET', path];
  for (const [key, value] of Object.entries(params)) args.push('-f', `${key}=${value}`);
  const raw = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(raw);
}

const TEST_PATH = [
  /(^|\/)(tests?|__tests__|specs?|e2e)\//i,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(py|go)$/,
];

const SOURCE_EXT = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|py|go)$/i;

const IGNORED = [
  /(^|\/)node_modules\//,
  /(^|\/)(dist|build|vendor|\.venv)\//,
  /\.(md|json|yml|yaml|lock|txt|svg|png)$/i,
];

const isTest = (path) => TEST_PATH.some((re) => re.test(path));
const isIgnored = (path) => IGNORED.some((re) => re.test(path));
const isSource = (path) => !isIgnored(path) && !isTest(path) && SOURCE_EXT.test(path);

/** Politeness, and the search endpoint's own limit of thirty requests a minute. */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function search(author, language, page) {
  const query = `is:pr is:merged author:${author} language:${language}`;
  const result = api('search/issues', { q: query, per_page: '100', page: String(page) });
  await pause(2100);
  return result.items ?? [];
}

/**
 * A cap of two pull requests per repository.
 *
 * Without it the result is a measurement of whichever repository the agent was
 * busiest in: the first attempt returned 120 pull requests from 23
 * repositories, half of them from one. A number built on that describes one
 * team's habits, not agents.
 */
const PER_REPO = 2;

/**
 * The search is walked breadth-first across every (language, author) pair
 * rather than draining one pair at a time, for the same reason: a limit
 * reached inside the first pair would make the whole corpus one agent writing
 * one language.
 */
const streams = [];
for (const language of LANGUAGES) {
  for (const author of AUTHORS) {
    streams.push({ language, author, page: 1, queue: [], done: false });
  }
}

const candidates = [];
const rejected = [];
const seen = new Set();
const perRepo = new Map();

const note = (key, reason) => rejected.push({ key, reason });

/**
 * Written after every addition rather than at the end.
 *
 * The first run of this script reached 166 pull requests and was then killed
 * with the whole corpus still in memory. Half an hour of API quota bought
 * nothing. Collecting is slow and interruptible by nature, so the file on disk
 * is always the answer so far.
 */
function save() {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        collectedAt: new Date().toISOString(),
        authors: AUTHORS,
        languages: LANGUAGES,
        perRepoCap: PER_REPO,
        funnel: {
          examined: seen.size,
          kept: candidates.length,
          repositories: perRepo.size,
          rejectedBy: rejected.reduce((counts, entry) => {
            const reason = entry.reason.replace(/\d+/g, 'N');
            counts[reason] = (counts[reason] ?? 0) + 1;
            return counts;
          }, {}),
        },
        candidates,
      },
      null,
      2,
    ),
  );
}

while (candidates.length < LIMIT && streams.some((s) => !s.done)) {
  for (const stream of streams) {
    if (stream.done || candidates.length >= LIMIT) continue;

    if (stream.queue.length === 0) {
      if (stream.page > 5) {
        stream.done = true;
        continue;
      }
      try {
        stream.queue = await search(stream.author, stream.language, stream.page++);
      } catch (error) {
        note(`${stream.author}/${stream.language}`, `search failed: ${String(error).slice(0, 80)}`);
        stream.done = true;
        continue;
      }
      if (stream.queue.length === 0) {
        stream.done = true;
        continue;
      }
    }

    const item = stream.queue.shift();
    const repo = item.repository_url.split('/').slice(-2).join('/');
    const key = `${repo}#${item.number}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if ((perRepo.get(repo) ?? 0) >= PER_REPO) {
      note(key, 'repository already represented');
      continue;
    }

    let files;
    try {
      files = api(`repos/${repo}/pulls/${item.number}/files`, { per_page: '100' });
    } catch {
      note(key, 'file list unavailable');
      continue;
    }

    const paths = files.map((f) => f.filename);
    const tests = paths.filter(isTest);
    const sources = paths.filter(isSource);

    if (tests.length === 0) {
      note(key, 'no test file touched');
      continue;
    }
    if (sources.length === 0) {
      note(key, 'no source file touched');
      continue;
    }
    if (paths.length > 60) {
      note(key, `too large: ${paths.length} files`);
      continue;
    }

    let pull;
    try {
      pull = api(`repos/${repo}/pulls/${item.number}`);
    } catch {
      note(key, 'pull request unavailable');
      continue;
    }

    perRepo.set(repo, (perRepo.get(repo) ?? 0) + 1);
    candidates.push({
      repo,
      number: item.number,
      author: stream.author,
      language: stream.language,
      title: item.title,
      base: pull.base.sha,
      head: pull.head.sha,
      cloneUrl: pull.base.repo.clone_url,
      defaultBranch: pull.base.repo.default_branch,
      stars: pull.base.repo.stargazers_count ?? 0,
      tests,
      sources,
      additions: pull.additions,
      mergedAt: pull.merged_at,
    });

    save();
    process.stderr.write(`\r  kept ${candidates.length} from ${perRepo.size} repos, seen ${seen.size}   `);
  }
}

save();

process.stderr.write('\n');

console.log(`${candidates.length} candidates from ${seen.size} pull requests → ${OUT}`);
