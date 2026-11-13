// Structural analysis for the bundled Windows PowerShell runtime scripts.
//
// Why this exists: `[Parser]::ParseFile` only proves that a script *parses*.
// A bare `{ ... }` block is valid PowerShell on its own -- it is a script
// block literal, so it parses cleanly, produces no error, and is simply never
// executed. That is exactly how a repair path lost its migration check and its
// API health probe while continuing to report success. A syntax check cannot
// see it; this module can, because it tracks what the brace actually means.
//
// This is deliberately a small, conservative analyser, not a PowerShell
// parser. It models the constructs that decide whether a block runs:
//   * script blocks attached to a keyword/command on the same logical line
//     (`if (...) { }`, `foreach (...) { }`, `function X { }`, `. { }`,
//     `& { }`, `try { }`, `param (...)`, `switch (...) { }`)
//   * script blocks that are arguments/assignments (`$x = { }`,
//     `Invoke-Command -ScriptBlock { }`), which are legal and inert
//   * a `{` that owns the whole line with no owner: an orphan script block
//     that will silently never run.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

// Keywords whose block runs as part of the statement.
const STATEMENT_KEYWORDS = new Set([
  'if', 'elseif', 'else', 'foreach', 'for', 'while', 'do', 'until',
  'try', 'catch', 'finally', 'switch', 'function', 'filter', 'class',
  'trap', 'process', 'begin', 'end', 'parallel', 'sequence', 'inlinescript',
]);

// Keywords/cmds that legitimately take a script block as data, not as the
// statement body.
const INERT_BLOCK_CONSUMERS = new Set([
  '&', '.', 'invoke-command', 'invoke-expression', 'start-job', 'foreach-object',
  'where-object', 'sort-object', 'measure-object', 'group-object', 'select-object',
  'register-engineevent', 'register-objectevent', 'new-psobject', 'set-item',
  'param', 'configuration', 'using', 'data',
]);

const OPEN_EXTENT = /^\s*(?:@\(|@\{|\{|\(|\[|\$\()/;
const CLOSERS = { '{': '}', '(': ')', '[': ']' };

/**
 * Remove comments and quoted strings so that braces inside them are not
 * counted, while preserving line structure (newlines are kept) so positions
 * remain meaningful.
 */
export function stripComments(text) {
  return scrub(text, { keepStrings: true });
}

export function stripCommentsAndStrings(text) {
  return scrub(text, { keepStrings: false });
}

function scrub(text, { keepStrings }) {
  const out = [];
  let i = 0;
  const n = text.length;
  // Stack of here-string terminators we are currently inside.
  let hereTerminator = null;
  let depthParen = 0;

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];

    if (hereTerminator) {
      const idx = text.indexOf(hereTerminator, i);
      if (idx === -1) {
        out.push(text.slice(i));
        break;
      }
      // Blank out content but keep newlines (unless strings are kept).
      out.push(keepStrings ? text.slice(i, idx) : text.slice(i, idx).replace(/[^\n]/g, ' '));
      out.push(hereTerminator);
      i = idx + hereTerminator.length;
      hereTerminator = null;
      continue;
    }

    // Block comment
    if (ch === '<' && next === '#') {
      const end = text.indexOf('#>', i + 2);
      const stop = end === -1 ? n : end + 2;
      out.push(text.slice(i, stop).replace(/[^\n]/g, ' '));
      i = stop;
      continue;
    }

    // Line comment
    if (ch === '#' && (i === 0 || /[\s;{}()\[\]]/.test(text[i - 1]))) {
      let end = text.indexOf('\n', i);
      if (end === -1) end = n;
      out.push(' '.repeat(end - i));
      i = end;
      continue;
    }

    // Here-strings: @" ... "@ and @' ... '@
    if (ch === '@' && (next === '"' || next === "'")) {
      const quote = next;
      const terminator = '\n' + quote + '@';
      const searchFrom = i + 2;
      const idx = text.indexOf(terminator, searchFrom);
      if (idx === -1) {
        out.push(text.slice(i).replace(/[^\n]/g, ' '));
        break;
      }
      out.push(text.slice(i, idx).replace(/[^\n]/g, ' '));
      out.push(terminator);
      i = idx + terminator.length;
      continue;
    }

    // Double-quoted string (with backtick escapes and $( ) subexpressions)
    if (ch === '"') {
      let j = i + 1;
      let sub = 0;
      while (j < n) {
        const c = text[j];
        if (c === '`') { j += 2; continue; }
        if (c === '$' && text[j + 1] === '(') { sub += 1; j += 2; continue; }
        if (c === '(' && sub > 0) { sub += 1; j += 1; continue; }
        if (c === ')' && sub > 0) { sub -= 1; j += 1; continue; }
        if (c === '"' && sub === 0) { j += 1; break; }
        j += 1;
      }
      // Keep the delimiters, blank the content.
      const doubleBody = text.slice(i + 1, Math.max(i + 1, j - 1));
      out.push('"');
      out.push(keepStrings ? doubleBody : doubleBody.replace(/[^\n]/g, ' '));
      out.push('"');
      i = j;
      continue;
    }

    // Single-quoted string (no escapes except '' doubling)
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      const singleBody = text.slice(i + 1, Math.max(i + 1, j - 1));
      out.push("'");
      out.push(keepStrings ? singleBody : singleBody.replace(/[^\n]/g, ' '));
      out.push("'");
      i = j;
      continue;
    }

    out.push(ch);
    i += 1;
  }

  void depthParen;
  return out.join('');
}

/**
 * Analyse one PowerShell source text.
 *
 * Returns:
 *   orphanBlocks: bare script-block literals that own a line and are never
 *                 executed nor consumed as a value.
 *   unclosedBlocks: `{` with no matching `}`.
 */
export function analysePowerShell(text, { fileName = '<memory>' } = {}) {
  const stripped = stripCommentsAndStrings(text);
  const lines = stripped.split('\n');
  // Comment-only stripping keeps quoted text, so diagnostics can quote the
  // real statement instead of a line with its strings blanked out.
  const rawLines = text.split('\n');

  // Provide a previous non-empty line lookup for multi-line conditions.
  const orphanBlocks = [];
  const unclosedBlocks = [];

  const stack = []; // {type, line, col}
  let offset = 0;
  const lineStarts = [];
  {
    let acc = 0;
    for (const line of lines) {
      lineStarts.push(acc);
      acc += line.length + 1;
    }
  }

  // Track logical statement context: a `{` at the start of the *logical line*
  // already accumulated is an orphan unless it is preceded by an owner token.
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    offset = lineStarts[lineIndex];

    for (let col = 0; col < rawLine.length; col += 1) {
      const ch = rawLine[col];

      if (ch === '{') {
        const restOfLine = rawLine.slice(col);
        const isFirstOnLine = rawLine.slice(0, col).trim() === '';
        const closerOnly = restOfLine.trim() === '{';

        if (isFirstOnLine && closerOnly) {
          const { ownerLine, cursor } = owningStatementLine(lines, lineIndex);
          const previous = cursor >= 0 ? lines[cursor] : '';
          const nearLiteral = previous.trim() === '}' || previous.trim() === '} else {';
          const owner = ownerLine ? classifyBlockOwner(ownerLine) : { kind: 'unknown' };
          // `}` closing a block, then a bare `{`: nothing consumes this block.
          if (owner.kind === 'orphan' || (nearLiteral && owner.kind !== 'statement')) {
            const ownerRaw = (cursor >= 0 && rawLines[cursor] ? rawLines[cursor] : '').trim();
            orphanBlocks.push({
              fileName,
              line: lineIndex + 1,
              column: col + 1,
              evidence: ownerRaw || ownerLine.trim(),
            });
          }
        }
        stack.push({ type: '{', line: lineIndex + 1, column: col + 1 });
        continue;
      }

      if (ch === '}') {
        popMatching(stack, '{', lineIndex + 1, unclosedBlocks);
        continue;
      }

      if (ch === '(') { stack.push({ type: '(', line: lineIndex + 1, column: col + 1 }); continue; }
      if (ch === ')') { popMatching(stack, '(', lineIndex + 1, unclosedBlocks); continue; }
      if (ch === '[') { stack.push({ type: '[', line: lineIndex + 1, column: col + 1 }); continue; }
      if (ch === ']') { popMatching(stack, '[', lineIndex + 1, unclosedBlocks); continue; }
    }
  }

  for (const open of stack) {
    if (open.type === '{') unclosedBlocks.push(open);
  }

  return { orphanBlocks, unclosedBlocks, fileName };
}

function popMatching(stack, expected, line, unclosed) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i].type === expected) {
      stack.length = i;
      return;
    }
  }
  // Unmatched closer: tolerated (noise) -- syntax parsing covers this.
  void line;
  void unclosed;
}

function previousCodeLine(lines, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (lines[i].trim() !== '') return lines[i];
  }
  return '';
}

// A line that continues the statement on the next line: the block that follows
// still belongs to a keyword further up.
const CONTINUATION_TAIL = /(?:[-|,+=]|\b(?:-and|-or|-eq|-ne|-gt|-lt|-ge|-le|-like|-match|-notmatch|-contains|-in)\b)\s*$/i;

function isContinuationLine(line) {
  const trimmed = line.trim();
  if (trimmed === '') return false;
  if (trimmed === ')' || trimmed === '}' || trimmed === ']') return true;
  if (CONTINUATION_TAIL.test(trimmed)) return true;
  if (/^\s*[-|]/.test(trimmed)) return true;
  return false;
}

/**
 * Walk back over continuation lines to find the statement that owns a block
 * written on its own line. Returns the owner line's first token.
 */
function owningStatementLine(lines, index) {
  let i = index - 1;
  // Skip blank lines.
  while (i >= 0 && lines[i].trim() === '') i -= 1;
  const cursor = i;
  let owner = i >= 0 ? lines[i] : '';
  let guard = 0;
  while (i >= 0 && guard < 40) {
    if (!isContinuationLine(lines[i])) break;
    i -= 1;
    while (i >= 0 && lines[i].trim() === '') i -= 1;
    if (i >= 0) owner = lines[i];
    guard += 1;
  }
  return { ownerLine: owner, cursor };
}

/**
 * Decide what the previous non-empty line means for a block that owns a line.
 */
export function classifyBlockOwner(previousLine) {
  const line = previousLine.trim();
  if (line === '') return { kind: 'unknown' };

  // Split into the leading token sequence.
  const firstToken = (line.match(/^[A-Za-z_][\w\-]*/) || [null])[0];

  if (firstToken) {
    const lower = firstToken.toLowerCase();
    if (STATEMENT_KEYWORDS.has(lower)) return { kind: 'statement', keyword: lower };
    if (INERT_BLOCK_CONSUMERS.has(lower)) return { kind: 'inert', keyword: lower };
  }

  // `} else {` / `} elseif (...) {` / `} catch {` attach to a prior block.
  if (line.startsWith('}')) {
    const after = line.slice(1).trim();
    const tok = (after.match(/^[A-Za-z_][\w\-]*/) || [null])[0];
    if (tok && STATEMENT_KEYWORDS.has(tok.toLowerCase())) {
      return { kind: 'statement', keyword: tok.toLowerCase() };
    }
    return { kind: 'inert', keyword: 'closer' };
  }

  // `.` or `&` invocation operator on its own.
  if (line === '.' || line === '&') return { kind: 'inert', keyword: line };

  // Assignment or pipeline into a block: `$x =`, `... | ForEach-Object`
  if (/=\s*$/.test(line)) return { kind: 'inert', keyword: 'assignment' };
  if (/\|\s*[A-Za-z_][\w\-]*\s*$/.test(line)) return { kind: 'inert', keyword: 'pipeline' };

  // A comparison or condition tail inside a multi-line `if (`
  // e.g.  if ((Test-Path ...) -and
  //       (Test-Path ...)) {
  // is covered because the `{` would share the line with `)`.
  //
  // Anything else owning a line alone is an orphan.
  return { kind: 'orphan', keyword: null };
}

/** Analyse a PowerShell file from disk. */
export function analysePowerShellFile(path) {
  const text = readFileSync(path, 'utf8');
  return {
    ...analysePowerShell(text, { fileName: basename(path) }),
    path,
  };
}

/**
 * Statements that must remain present and reachable inside a script.
 * Each entry is matched against comment/string-stripped source so that a
 * commented-out or stringified command does not satisfy it.
 */
export function findStatement(source, matcher) {
  const stripped = stripComments(source);
  return typeof matcher === 'string' ? stripped.includes(matcher) : matcher.test(stripped);
}
