/**
 * The programmatic surface.
 *
 * Exported so that a continuous integration job, an editor plugin or another
 * tool can ask the same questions without going through a terminal. The types
 * are the same ones the report is built from; there is no second vocabulary.
 */

export { verify, VerifyError, VERSION, type VerifyOptions, type ProgressEvent } from './verify.js';
export { render, toJson, toMarkdown, exitCodeFor, type RenderOptions } from './report.js';
export { readClaims, judge, CLAIMS_PATH } from './claims.js';
export { detectRunner, runnerById, templateRunner, RUNNER_IDS, type Runner } from './runner.js';
export { findTests } from './parse.js';
export { roleOf, languageOf, isIgnored } from './classify.js';
export { loadConfig, type FileConfig } from './config.js';
export type {
  AlibiResult,
  AlibiVerdict,
  ChangedFile,
  Claim,
  ClaimResult,
  ClaimStatus,
  ClaimTag,
  Finding,
  FindingKind,
  Language,
  Report,
  Severity,
  TestCase,
} from './types.js';
