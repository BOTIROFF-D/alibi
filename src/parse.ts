/**
 * Finding the tests in a file without parsing the language.
 *
 * A real parser for six languages would be the larger part of this project and
 * would drag in a dependency for each. What the checks actually need is
 * narrower: where a test declaration starts, what it is called, and where its
 * body ends. That is recoverable from the shape of the text, and when the
 * shape is ambiguous the scanner stops rather than guesses — a missed test is
 * reported as unexamined, never as passed.
 */

import type { Language, TestCase } from './types.js';

/** `alibi: characterization` in a comment above or inside a test. */
const EXEMPT = /alibi:\s*characterization/i;

interface Scan {
  name: string;
  line: number;
  suite: string[];
  skipped: boolean;
  bodyStart: number;
  bodyEnd: number;
}

const JS_DECL =
  /^\s*(?:export\s+)?(?:async\s+)?(x|f)?(it|test|describe|context|suite)(?:\.(skip|only|todo|concurrent|sequential|each|failing))?\s*(?:\.[a-z]+)*\s*\(\s*(['"`])((?:[^\\]|\\.)*?)\4/;

function scanBrace(lines: string[], startLine: number, openerLine: string): number {
  /*
   * Counts braces from the declaration line to the matching close. String
   * literals and line comments are stepped over, because a `}` inside a
   * fixture literal has ended more than one naive scanner. Block comments are
   * not tracked: a brace inside a block comment is rare enough in a test body
   * to be worth the simpler loop, and the cost of being wrong is one test
   * reported as unexamined.
   */
  let depth = 0;
  let started = false;
  for (let i = startLine; i < lines.length; i++) {
    const text = i === startLine ? openerLine : (lines[i] as string);
    let inString: string | null = null;
    let escaped = false;
    for (let c = 0; c < text.length; c++) {
      const ch = text[c] as string;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === inString) inString = null;
        continue;
      }
      if (ch === '/' && text[c + 1] === '/') break;
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        continue;
      }
      if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}') {
        depth--;
        if (started && depth <= 0) return i;
      }
    }
  }
  return lines.length - 1;
}

function scanIndent(lines: string[], startLine: number): number {
  const declIndent = indentOf(lines[startLine] as string);
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === '') continue;
    if (indentOf(line) <= declIndent) return i - 1;
  }
  return lines.length - 1;
}

function indentOf(line: string): number {
  const match = /^[ \t]*/.exec(line);
  return match ? (match[0] as string).replace(/\t/g, '    ').length : 0;
}

function scanJs(lines: string[]): Scan[] {
  const out: Scan[] = [];
  const openSuites: { name: string; endLine: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const match = JS_DECL.exec(line);
    if (!match) continue;

    const prefix = match[1];
    const kind = match[2] as string;
    const modifier = match[3];
    const name = (match[5] as string).replace(/\\(['"`])/g, '$1');
    const end = scanBrace(lines, i, line);

    while (openSuites.length > 0 && (openSuites[openSuites.length - 1] as { endLine: number }).endLine < i) {
      openSuites.pop();
    }

    if (kind === 'describe' || kind === 'context' || kind === 'suite') {
      openSuites.push({ name, endLine: end });
      continue;
    }

    out.push({
      name,
      line: i + 1,
      suite: openSuites.map((s) => s.name),
      skipped: prefix === 'x' || modifier === 'skip' || modifier === 'todo',
      bodyStart: i,
      bodyEnd: end,
    });
  }
  return out;
}

function scanPython(lines: string[]): Scan[] {
  const out: Scan[] = [];
  const classes: { name: string; indent: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    const cls = /^(\s*)class\s+([A-Za-z_][\w]*)/.exec(line);
    if (cls) {
      const indent = indentOf(cls[1] as string);
      while (classes.length > 0 && (classes[classes.length - 1] as { indent: number }).indent >= indent) {
        classes.pop();
      }
      classes.push({ name: cls[2] as string, indent });
      continue;
    }

    const fn = /^(\s*)(?:async\s+)?def\s+(test[\w]*)\s*\(/.exec(line);
    if (!fn) continue;

    const indent = indentOf(fn[1] as string);
    const enclosing = classes.filter((c) => c.indent < indent).map((c) => c.name);

    let skipped = false;
    for (let d = i - 1; d >= 0; d--) {
      const above = (lines[d] as string).trim();
      if (above === '' || above.startsWith('#')) continue;
      if (!above.startsWith('@')) break;
      if (/@(pytest\.mark\.)?skip|@unittest\.skip|@pytest\.mark\.xfail/.test(above)) skipped = true;
    }

    out.push({
      name: fn[2] as string,
      line: i + 1,
      suite: enclosing,
      skipped,
      bodyStart: i,
      bodyEnd: scanIndent(lines, i),
    });
  }
  return out;
}

function scanGo(lines: string[]): Scan[] {
  const out: Scan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fn = /^func\s+((?:Test|Fuzz|Example)[\w]*)\s*\(/.exec(line);
    if (!fn) continue;
    const end = scanBrace(lines, i, line);
    const body = lines.slice(i, end + 1).join('\n');
    out.push({
      name: fn[1] as string,
      line: i + 1,
      suite: [],
      skipped: /\bt\.Skip(Now)?\s*\(/.test(body),
      bodyStart: i,
      bodyEnd: end,
    });
  }
  return out;
}

function scanRust(lines: string[]): Scan[] {
  const out: Scan[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*#\[(test|tokio::test|async_std::test)\]/.test(lines[i] as string)) continue;
    let ignored = false;
    let j = i + 1;
    while (j < lines.length && /^\s*#\[/.test(lines[j] as string)) {
      if (/#\[ignore/.test(lines[j] as string)) ignored = true;
      j++;
    }
    const fn = /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/.exec(lines[j] as string ?? '');
    if (!fn) continue;
    const end = scanBrace(lines, j, lines[j] as string);
    out.push({
      name: fn[1] as string,
      line: j + 1,
      suite: [],
      skipped: ignored,
      bodyStart: j,
      bodyEnd: end,
    });
  }
  return out;
}

function scanRuby(lines: string[]): Scan[] {
  const out: Scan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const spec = /^\s*(it|specify|scenario)\s*\(?\s*(['"])(.*?)\2/.exec(line);
    const unit = /^\s*def\s+(test_[\w]*)/.exec(line);
    if (!spec && !unit) continue;
    const name = spec ? (spec[3] as string) : (unit?.[1] as string);
    let end = i;
    const declIndent = indentOf(line);
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] as string;
      if (l.trim() === 'end' && indentOf(l) === declIndent) {
        end = j;
        break;
      }
    }
    out.push({ name, line: i + 1, suite: [], skipped: /\bskip\b/.test(line), bodyStart: i, bodyEnd: end });
  }
  return out;
}

function scanJava(lines: string[]): Scan[] {
  const out: Scan[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*@Test\b/.test(lines[i] as string)) continue;
    let j = i + 1;
    let disabled = false;
    while (j < lines.length && /^\s*@/.test(lines[j] as string)) {
      if (/@(Disabled|Ignore)\b/.test(lines[j] as string)) disabled = true;
      j++;
    }
    const fn = /\b(?:void|[A-Za-z_<>,\s]+)\s+([A-Za-z_][\w]*)\s*\(/.exec(lines[j] as string ?? '');
    if (!fn) continue;
    const end = scanBrace(lines, j, lines[j] as string);
    out.push({ name: fn[1] as string, line: j + 1, suite: [], skipped: disabled, bodyStart: j, bodyEnd: end });
  }
  return out;
}

const SCANNERS: Partial<Record<Language, (lines: string[]) => Scan[]>> = {
  js: scanJs,
  ts: scanJs,
  python: scanPython,
  go: scanGo,
  rust: scanRust,
  ruby: scanRuby,
  java: scanJava,
  php: scanJava,
};

/** Every test declared in `content`, in declaration order. */
export function findTests(file: string, content: string, language: Language): TestCase[] {
  const scanner = SCANNERS[language];
  if (!scanner) return [];
  const lines = content.split(/\r?\n/);

  return scanner(lines).map((scan) => {
    const body = lines.slice(scan.bodyStart, scan.bodyEnd + 1).join('\n');
    const above = lines.slice(Math.max(0, scan.bodyStart - 3), scan.bodyStart).join('\n');
    return {
      name: scan.name,
      file,
      line: scan.line,
      language,
      suite: scan.suite,
      skipped: scan.skipped,
      exempt: EXEMPT.test(body) || EXEMPT.test(above),
      body,
    };
  });
}
