/**
 * Shared vocabulary.
 *
 * The words here are load-bearing, so they are defined once and used
 * everywhere. A test has an ALIBI when it can be shown to have been red
 * before the change it claims to cover. Everything else this tool reports is
 * a consequence of that one question.
 */

export type Language = 'js' | 'ts' | 'python' | 'go' | 'rust' | 'ruby' | 'java' | 'php' | 'unknown';

export type FileRole = 'test' | 'source' | 'other';

export interface ChangedFile {
  /** Path relative to the repository root, POSIX separators. */
  path: string;
  /** `A` added, `M` modified, `D` deleted, `R` renamed. */
  status: 'A' | 'M' | 'D' | 'R';
  role: FileRole;
  language: Language;
  /** Present for renames: where the file used to live. */
  from?: string;
}

/** One test case, as declared in a file. */
export interface TestCase {
  /** Name as the runner sees it. For pytest this is the node id suffix. */
  name: string;
  /** File the declaration lives in, relative to the repository root. */
  file: string;
  /** 1-based line of the declaration. */
  line: number;
  language: Language;
  /** Enclosing describe/class chain, outermost first. Empty for flat runners. */
  suite: string[];
  /** Marked skipped/ignored at the declaration site. */
  skipped: boolean;
  /**
   * The author asked for this test to be exempt from the alibi check, with an
   * `alibi: characterization` marker. Recorded, never silently obeyed: the
   * report still lists it, it just does not count against the verdict.
   */
  exempt: boolean;
  /** Source text of the test body, used by the static checks. */
  body: string;
}

/**
 * What the alibi run found out about one test.
 *
 * `provisional` is the honest middle: the test did not merely pass, it never
 * ran, because the code it imports did not exist yet. That is expected for a
 * genuinely new module and it is not evidence of anything. Collapsing it into
 * either of the other two states would be a lie in one direction or the other.
 */
export type AlibiVerdict = 'alibi' | 'provisional' | 'none' | 'error' | 'skipped';

export interface AlibiResult {
  test: TestCase;
  verdict: AlibiVerdict;
  /** Exit code of the run against the pre-change source. */
  exitCode: number | null;
  /** Milliseconds the run took. */
  durationMs: number;
  /** First interesting line of output, kept for the report. */
  evidence: string;
}

export type FindingKind =
  | 'no-alibi'
  | 'vacuous-assertion'
  | 'no-assertion'
  | 'subject-mocked'
  | 'test-deleted'
  | 'test-skipped'
  | 'assertion-weakened'
  | 'suite-failing'
  | 'mutant-survived';

export type Severity = 'lie' | 'unproven' | 'note';

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  /** One line, present tense, no adjectives. Shown in the report. */
  title: string;
  file: string;
  line: number;
  /** The concrete thing that was observed. Never a guess. */
  evidence: string;
}

export type ClaimTag = 'tests' | 'fix' | 'pass' | 'safe' | 'perf' | 'other';

export interface Claim {
  tag: ClaimTag;
  text: string;
  /** 1-based line in the claims file. */
  line: number;
}

export type ClaimStatus = 'proven' | 'unproven' | 'false';

export interface ClaimResult {
  claim: Claim;
  status: ClaimStatus;
  /** Why the status is what it is, in one line. */
  reason: string;
  /** Findings that decided this claim. */
  findings: Finding[];
}

export interface Report {
  version: string;
  base: string;
  runner: string;
  testsExamined: number;
  results: AlibiResult[];
  findings: Finding[];
  claims: ClaimResult[];
  /** Wall-clock milliseconds for the whole verification. */
  durationMs: number;
  /** Set when the suite was run as a whole and the exit code was non-zero. */
  suiteExitCode: number | null;
}
