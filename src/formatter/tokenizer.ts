import type { Dialect } from './dialects';

export enum TokenType {
    Word = 'word',
    QuotedIdentifier = 'quotedIdentifier',
    String = 'string',
    Number = 'number',
    Variable = 'variable',
    Operator = 'operator',
    Comma = 'comma',
    Semicolon = 'semicolon',
    OpenParen = 'openParen',
    CloseParen = 'closeParen',
    Dot = 'dot',
    LineComment = 'lineComment',
    BlockComment = 'blockComment',
    BatchSeparator = 'batchSeparator',
    Unknown = 'unknown',
}

export interface Token {
    type: TokenType;
    /** Raw source text, preserved verbatim for strings, comments and literals. */
    value: string;
    /** Upper-cased `value`; used for all keyword matching. */
    key: string;
    start: number;
    end: number;
    /** Newlines in the whitespace run immediately before this token. */
    precedingNewlines: number;
    /** Whether any whitespace at all preceded this token. */
    precedingWhitespace: boolean;
    /** Whether this token is the first thing on its source line, at column 0. */
    atLineStart: boolean;
}

/**
 * Multi-character operators, longest first so that greedy matching picks
 * `<=>` over `<=` over `<`.
 */
const OPERATORS: string[] = [
    '<=>', '!==', '->>', '#>>',
    '||', '::', '->', '#>', '>=', '<=', '<>', '!=', '!<', '!>', '+=', '-=',
    '*=', '/=', '%=', '&=', '^=', '|=', '**', '&&', '<<', '>>', '@>', '<@',
    '=', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '~', '!',
];

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';

const isLetter = (ch: string): boolean =>
    (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch.charCodeAt(0) > 127;

/**
 * Splits `sql` into a flat token stream. Whitespace is not emitted; it is
 * recorded on the following token via `precedingNewlines` so the formatter can
 * honour author-inserted blank lines.
 *
 * The tokenizer never throws on malformed input: an unterminated string or
 * comment is emitted as a single token running to end of input, which keeps the
 * formatter's "leave it alone if you can't parse it" guarantee intact.
 */
export function tokenize(sql: string, dialect: Dialect): Token[] {
    const tokens: Token[] = [];
    const len = sql.length;
    let pos = 0;
    let pendingNewlines = 0;
    let pendingWhitespace = false;
    let atLineStart = true;

    const push = (type: TokenType, start: number, end: number): void => {
        const value = sql.slice(start, end);
        tokens.push({
            type,
            value,
            key: value.toUpperCase(),
            start,
            end,
            precedingNewlines: pendingNewlines,
            precedingWhitespace: pendingWhitespace,
            atLineStart,
        });
        pendingNewlines = 0;
        pendingWhitespace = false;
        atLineStart = false;
    };

    while (pos < len) {
        const ch = sql[pos];

        // --- whitespace ---------------------------------------------------
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f') {
            if (ch === '\n') {
                pendingNewlines += 1;
                atLineStart = true;
            } else if (ch !== '\r') {
                atLineStart = false;
            }
            pendingWhitespace = true;
            pos += 1;
            continue;
        }

        // --- line comments ------------------------------------------------
        if (ch === '-' && sql[pos + 1] === '-') {
            const start = pos;
            pos += 2;
            while (pos < len && sql[pos] !== '\n') {
                pos += 1;
            }
            // Trailing \r of a CRLF pair belongs to the line break, not the comment.
            let end = pos;
            if (end > start && sql[end - 1] === '\r') {
                end -= 1;
            }
            push(TokenType.LineComment, start, end);
            continue;
        }

        if (ch === '#' && dialect.hashLineComment) {
            const start = pos;
            while (pos < len && sql[pos] !== '\n') {
                pos += 1;
            }
            let end = pos;
            if (end > start && sql[end - 1] === '\r') {
                end -= 1;
            }
            push(TokenType.LineComment, start, end);
            continue;
        }

        // --- block comments -----------------------------------------------
        if (ch === '/' && sql[pos + 1] === '*') {
            const start = pos;
            pos += 2;
            let depth = 1;
            while (pos < len && depth > 0) {
                if (dialect.nestedBlockComments && sql[pos] === '/' && sql[pos + 1] === '*') {
                    depth += 1;
                    pos += 2;
                } else if (sql[pos] === '*' && sql[pos + 1] === '/') {
                    depth -= 1;
                    pos += 2;
                } else {
                    pos += 1;
                }
            }
            push(TokenType.BlockComment, start, pos);
            continue;
        }

        // --- dollar-quoted strings (PostgreSQL) ----------------------------
        if (ch === '$' && dialect.dollarQuoting) {
            const tagEnd = readDollarTag(sql, pos);
            if (tagEnd > 0) {
                const tag = sql.slice(pos, tagEnd);
                const start = pos;
                const close = sql.indexOf(tag, tagEnd);
                pos = close === -1 ? len : close + tag.length;
                push(TokenType.String, start, pos);
                continue;
            }
        }

        // --- string literals, with optional prefix -------------------------
        const prefix = matchStringPrefix(sql, pos, dialect);
        if (prefix !== null) {
            const start = pos;
            pos = readSingleQuoted(sql, pos + prefix.length, dialect);
            push(TokenType.String, start, pos);
            continue;
        }
        if (ch === "'") {
            const start = pos;
            pos = readSingleQuoted(sql, pos, dialect);
            push(TokenType.String, start, pos);
            continue;
        }

        // --- quoted identifiers --------------------------------------------
        const quote = dialect.identifierQuotes.find((q) => q.open === ch);
        if (quote) {
            const start = pos;
            pos += 1;
            while (pos < len) {
                if (sql[pos] === quote.close) {
                    if (quote.escapeByDoubling && sql[pos + 1] === quote.close) {
                        pos += 2;
                        continue;
                    }
                    pos += 1;
                    break;
                }
                pos += 1;
            }
            push(TokenType.QuotedIdentifier, start, pos);
            continue;
        }

        // --- numbers ---------------------------------------------------------
        if (isDigit(ch) || (ch === '.' && isDigit(sql[pos + 1] ?? ''))) {
            const start = pos;
            if (ch === '0' && (sql[pos + 1] === 'x' || sql[pos + 1] === 'X')) {
                pos += 2;
                while (pos < len && /[0-9a-fA-F]/u.test(sql[pos])) {
                    pos += 1;
                }
            } else {
                while (pos < len && isDigit(sql[pos])) {
                    pos += 1;
                }
                if (sql[pos] === '.' && isDigit(sql[pos + 1] ?? '')) {
                    pos += 1;
                    while (pos < len && isDigit(sql[pos])) {
                        pos += 1;
                    }
                } else if (sql[pos] === '.' && !isLetter(sql[pos + 1] ?? '')) {
                    // Trailing decimal point, e.g. `1.`
                    pos += 1;
                }
                if (sql[pos] === 'e' || sql[pos] === 'E') {
                    const save = pos;
                    pos += 1;
                    if (sql[pos] === '+' || sql[pos] === '-') {
                        pos += 1;
                    }
                    if (isDigit(sql[pos] ?? '')) {
                        while (pos < len && isDigit(sql[pos])) {
                            pos += 1;
                        }
                    } else {
                        pos = save;
                    }
                }
            }
            push(TokenType.Number, start, pos);
            continue;
        }

        // --- variables / bind parameters -------------------------------------
        const varPrefix = dialect.variablePrefixes.find((p) => sql.startsWith(p, pos));
        if (varPrefix && !sql.startsWith('::', pos)) {
            const start = pos;
            pos += varPrefix.length;
            while (pos < len && isIdentifierPart(sql[pos], dialect)) {
                pos += 1;
            }
            push(TokenType.Variable, start, pos);
            continue;
        }

        // --- punctuation -------------------------------------------------------
        if (ch === '(') {
            push(TokenType.OpenParen, pos, ++pos);
            continue;
        }
        if (ch === ')') {
            push(TokenType.CloseParen, pos, ++pos);
            continue;
        }
        if (ch === ',') {
            push(TokenType.Comma, pos, ++pos);
            continue;
        }
        if (ch === ';') {
            push(TokenType.Semicolon, pos, ++pos);
            continue;
        }
        if (ch === '.') {
            push(TokenType.Dot, pos, ++pos);
            continue;
        }

        // --- operators ---------------------------------------------------------
        const op = OPERATORS.find((candidate) => sql.startsWith(candidate, pos));
        if (op) {
            const start = pos;
            pos += op.length;
            push(TokenType.Operator, start, pos);
            continue;
        }

        // --- bare identifiers / keywords ---------------------------------------
        if (isIdentifierStart(ch, dialect)) {
            const start = pos;
            while (pos < len && isIdentifierPart(sql[pos], dialect)) {
                pos += 1;
            }
            const value = sql.slice(start, pos);
            const isBatchSeparator =
                dialect.batchSeparator !== undefined &&
                value.toUpperCase() === dialect.batchSeparator &&
                isAloneOnLine(sql, start, pos);
            push(isBatchSeparator ? TokenType.BatchSeparator : TokenType.Word, start, pos);
            continue;
        }

        // --- anything else is passed through untouched --------------------------
        push(TokenType.Unknown, pos, ++pos);
    }

    return tokens;
}

function isIdentifierStart(ch: string, dialect: Dialect): boolean {
    return isLetter(ch) || dialect.extraIdentifierStart.includes(ch);
}

function isIdentifierPart(ch: string, dialect: Dialect): boolean {
    return (
        isLetter(ch) || isDigit(ch) || dialect.extraIdentifierPart.includes(ch)
    );
}

/** Consumes a `'...'` literal starting at `pos`, returning the index after it. */
function readSingleQuoted(sql: string, pos: number, dialect: Dialect): number {
    const len = sql.length;
    pos += 1; // opening quote
    while (pos < len) {
        const ch = sql[pos];
        if (dialect.backslashEscapes && ch === '\\' && pos + 1 < len) {
            pos += 2;
            continue;
        }
        if (ch === "'") {
            if (sql[pos + 1] === "'") {
                pos += 2;
                continue;
            }
            return pos + 1;
        }
        pos += 1;
    }
    return len;
}

/**
 * Matches a string prefix such as `N` in `N'x'`, but only when it is not part
 * of a longer identifier (`Name'` must not be read as prefix `N`).
 */
function matchStringPrefix(sql: string, pos: number, dialect: Dialect): string | null {
    for (const prefix of dialect.stringPrefixes) {
        const candidate = sql.slice(pos, pos + prefix.length);
        if (candidate.toUpperCase() !== prefix.toUpperCase()) {
            continue;
        }
        if (sql[pos + prefix.length] !== "'") {
            continue;
        }
        const before = sql[pos - 1];
        if (before !== undefined && isIdentifierPart(before, dialect)) {
            continue;
        }
        return candidate;
    }
    return null;
}

/** Returns the index after a `$tag$` opener, or -1 when this is not one. */
function readDollarTag(sql: string, pos: number): number {
    let i = pos + 1;
    while (i < sql.length && /[A-Za-z0-9_]/u.test(sql[i])) {
        i += 1;
    }
    return sql[i] === '$' ? i + 1 : -1;
}

/** True when only whitespace separates [start, end) from its line boundaries. */
function isAloneOnLine(sql: string, start: number, end: number): boolean {
    let i = start - 1;
    while (i >= 0 && (sql[i] === ' ' || sql[i] === '\t' || sql[i] === '\r')) {
        i -= 1;
    }
    if (i >= 0 && sql[i] !== '\n') {
        return false;
    }
    let j = end;
    while (j < sql.length && (sql[j] === ' ' || sql[j] === '\t' || sql[j] === '\r')) {
        j += 1;
    }
    return j >= sql.length || sql[j] === '\n';
}
