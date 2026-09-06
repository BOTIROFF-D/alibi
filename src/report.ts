/**
 * The card.
 *
 * The report is the product: it is what gets read, pasted into a pull request
 * and argued with. Two rules keep it honest. Every line says what was observed
 * rather than what it means, and every accusation carries the file and line
 * that produced it, so the reader can go and disagree with the evidence
 * instead of with the tool.
 */

import type { AlibiResult, Finding, Report, Severity } from './types.js';

const COLOR = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
};

export interface RenderOptions {
  color: boolean;
  /** Prints every examined test, not only the ones with something to say. */
  verbose: boolean;
}

function paint(text: string, code: string, on: boolean): string {
  return on ? `${code}${text}${COLOR.reset}` : text;
}

/** Keeps a line inside a terminal that has not been widened for this tool. */
function clip(text: string, width = 78): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

const MARK: Record<Severity | 'ok', string> = {
  lie: '✕',
  unproven: '!',
  note: '·',
  ok: '✓',
};

export function render(report: Report, options: RenderOptions): string {
  const c = options.color;
  const out: string[] = [];
  const lies = report.findings.filter((f) => f.severity === 'lie');
  const unproven = report.findings.filter((f) => f.severity === 'unproven');
  const withAlibi = report.results.filter((r) => r.verdict === 'alibi');
  const without = report.results.filter((r) => r.verdict === 'none' && !r.test.exempt);
  const provisional = report.results.filter((r) => r.verdict === 'provisional');

  out.push('');
  out.push(
    `  ${paint('ALIBI', COLOR.bold, c)}  ${paint(
      `v${report.version} · ${report.runner} · base ${report.base.slice(0, 7)}`,
      COLOR.dim,
      c,
    )}`,
  );
  out.push('');

  const headline = [
    `${report.testsExamined} test${report.testsExamined === 1 ? '' : 's'} examined`,
    `${withAlibi.length} with an alibi`,
    without.length > 0 ? paint(`${without.length} without`, COLOR.red, c) : '0 without',
  ];
  out.push(`  ${headline.join(' · ')}`);
  out.push('');

  for (const result of report.results) {
    const block = renderResult(result, c, options.verbose);
    if (block) out.push(...block, '');
  }

  const statics = report.findings.filter((f) => f.kind !== 'no-alibi' && f.kind !== 'suite-failing');
  if (statics.length > 0) {
    out.push(`  ${paint('ALSO IN THIS DIFF', COLOR.bold, c)}`);
    out.push('');
    for (const finding of statics) {
      const mark = paint(MARK[finding.severity], finding.severity === 'lie' ? COLOR.red : COLOR.yellow, c);
      out.push(`  ${mark}  ${finding.title}`);
      if (finding.evidence) out.push(`     ${paint(clip(finding.evidence), COLOR.dim, c)}`);
      out.push(`     ${paint(`${finding.file}:${finding.line}`, COLOR.dim, c)}`);
      out.push('');
    }
  }

  if (report.claims.length > 0) {
    out.push(`  ${paint('CLAIMS', COLOR.bold, c)}`);
    out.push('');
    for (const result of report.claims) {
      const mark =
        result.status === 'proven'
          ? paint(MARK.ok, COLOR.green, c)
          : result.status === 'false'
            ? paint(MARK.lie, COLOR.red, c)
            : paint(MARK.unproven, COLOR.yellow, c);
      out.push(`  ${mark}  ${paint(`[${result.claim.tag}]`, COLOR.dim, c)} ${result.claim.text}`);
      out.push(`     ${paint(result.reason, COLOR.dim, c)}`);
      for (const finding of result.findings.slice(0, 3)) {
        out.push(`     ${paint(clip(`${finding.file}:${finding.line}  ${finding.title}`), COLOR.dim, c)}`);
      }
      out.push('');
    }
  }

  const falseClaims = report.claims.filter((x) => x.status === 'false').length;
  const unprovenClaims = report.claims.filter((x) => x.status === 'unproven').length;
  const provenClaims = report.claims.filter((x) => x.status === 'proven').length;

  const verdict: string[] = [];
  if (report.claims.length > 0) {
    verdict.push(
      falseClaims > 0 ? paint(`${falseClaims} false`, COLOR.red, c) : `${falseClaims} false`,
      `${unprovenClaims} unproven`,
      provenClaims > 0 ? paint(`${provenClaims} proven`, COLOR.green, c) : `${provenClaims} proven`,
    );
  } else {
    verdict.push(
      lies.length > 0
        ? paint(`${lies.length} green ${lies.length === 1 ? 'lie' : 'lies'}`, COLOR.red, c)
        : '0 green lies',
      `${unproven.length} unproven`,
      `${provisional.length} provisional`,
    );
  }

  out.push(`  ${paint('VERDICT', COLOR.bold, c)}  ${verdict.join(' · ')}`);
  out.push(`  ${paint(`${(report.durationMs / 1000).toFixed(1)}s`, COLOR.dim, c)}`);
  out.push('');
  return out.join('\n');
}

function renderResult(result: AlibiResult, color: boolean, verbose: boolean): string[] | null {
  const name = [...result.test.suite, result.test.name].join(' › ');
  const where = `${result.test.file}:${result.test.line}`;

  switch (result.verdict) {
    case 'alibi':
      if (!verbose) return null;
      return [
        `  ${paint(MARK.ok, COLOR.green, color)}  ${name}`,
        `     ${paint(clip(`red without the change — ${result.evidence}`), COLOR.dim, color)}`,
      ];
    case 'none':
      return [
        `  ${paint(MARK.lie, COLOR.red, color)}  ${name}   ${paint(
          result.test.exempt ? 'CHARACTERIZATION' : 'NO ALIBI',
          result.test.exempt ? COLOR.dim : COLOR.red,
          color,
        )}`,
        `     ${paint('passes against the source from before the change', COLOR.dim, color)}`,
        `     ${paint(where, COLOR.dim, color)}`,
      ];
    case 'provisional':
      if (!verbose) return null;
      return [
        `  ${paint(MARK.note, COLOR.blue, color)}  ${name}   ${paint('PROVISIONAL', COLOR.dim, color)}`,
        `     ${paint(clip(`never ran against the old source — ${result.evidence}`), COLOR.dim, color)}`,
      ];
    case 'error':
      return [
        `  ${paint(MARK.unproven, COLOR.yellow, color)}  ${name}   ${paint('NOT ANSWERED', COLOR.yellow, color)}`,
        `     ${paint(result.evidence, COLOR.dim, color)}`,
      ];
    default:
      return null;
  }
}

/** The same report, for machines. Stable field names; add, never rename. */
export function toJson(report: Report): string {
  return JSON.stringify(
    {
      tool: 'alibi',
      version: report.version,
      base: report.base,
      runner: report.runner,
      durationMs: report.durationMs,
      summary: {
        testsExamined: report.testsExamined,
        withAlibi: report.results.filter((r) => r.verdict === 'alibi').length,
        withoutAlibi: report.results.filter((r) => r.verdict === 'none' && !r.test.exempt).length,
        provisional: report.results.filter((r) => r.verdict === 'provisional').length,
        greenLies: report.findings.filter((f) => f.severity === 'lie').length,
        unproven: report.findings.filter((f) => f.severity === 'unproven').length,
      },
      tests: report.results.map((r) => ({
        name: [...r.test.suite, r.test.name].join(' › '),
        file: r.test.file,
        line: r.test.line,
        verdict: r.verdict,
        exempt: r.test.exempt,
        evidence: r.evidence,
        durationMs: r.durationMs,
      })),
      findings: report.findings,
      claims: report.claims.map((c) => ({
        tag: c.claim.tag,
        text: c.claim.text,
        status: c.status,
        reason: c.reason,
      })),
    },
    null,
    2,
  );
}

/** A shape that fits in a pull request comment. */
export function toMarkdown(report: Report): string {
  const without = report.results.filter((r) => r.verdict === 'none' && !r.test.exempt);
  const lies = report.findings.filter((f) => f.severity === 'lie');
  const lines: string[] = [];

  lines.push(`### alibi — ${report.testsExamined} tests examined`);
  lines.push('');
  lines.push(
    `${report.results.filter((r) => r.verdict === 'alibi').length} went red without the change, ` +
      `${without.length} did not, ${lies.length} green ${lies.length === 1 ? 'lie' : 'lies'}.`,
  );
  lines.push('');

  if (without.length > 0) {
    lines.push('| test | file | verdict |');
    lines.push('| --- | --- | --- |');
    for (const result of without) {
      lines.push(
        `| ${[...result.test.suite, result.test.name].join(' › ')} | \`${result.test.file}:${result.test.line}\` | no alibi |`,
      );
    }
    lines.push('');
  }

  for (const finding of report.findings) {
    lines.push(`- **${finding.severity}** ${finding.title} — \`${finding.file}:${finding.line}\``);
  }

  if (report.claims.length > 0) {
    lines.push('');
    lines.push('| claim | status | evidence |');
    lines.push('| --- | --- | --- |');
    for (const claim of report.claims) {
      lines.push(`| ${claim.claim.text} | ${claim.status} | ${claim.reason} |`);
    }
  }
  return lines.join('\n');
}

export function exitCodeFor(report: Report, strict: boolean): number {
  const lies = report.findings.some((f) => f.severity === 'lie');
  const falseClaims = report.claims.some((c) => c.status === 'false');
  if (lies || falseClaims) return 1;
  if (
    strict &&
    (report.findings.some((f) => f.severity === 'unproven') ||
      report.claims.some((c) => c.status === 'unproven'))
  ) {
    return 2;
  }
  return 0;
}

/** Turns the alibi results into findings, so one list carries every verdict. */
export function findingsFrom(results: AlibiResult[]): Finding[] {
  return results
    .filter((r) => r.verdict === 'none' && !r.test.exempt)
    .map((r) => ({
      kind: 'no-alibi' as const,
      severity: 'lie' as const,
      title: `"${[...r.test.suite, r.test.name].join(' › ')}" passes without the change it was written for`,
      file: r.test.file,
      line: r.test.line,
      evidence: r.evidence,
    }));
}
