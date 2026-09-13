import { TokenType, type Token } from './tokenizer';

/**
 * How the body that follows a clause keyword should be laid out when it does
 * not fit on one line.
 *
 *  - `keywordOwnLine`: the clause body starts on the line after the keyword
 *    (`SELECT`, `ORDER BY`, `VALUES`).
 *  - `expression`: the body starts on the keyword's line and only breaks
 *    before `AND` / `OR` (`WHERE`, `HAVING`, `ON`).
 *  - `inlineBody`: the body starts on the keyword's line and breaks at commas
 *    (`FROM`, `UPDATE`, `INSERT INTO`).
 */
export type ClauseLayout = 'keywordOwnLine' | 'expression' | 'inlineBody';

export interface ClauseDef {
    /** Upper-cased token sequence that introduces the clause. */
    words: string[];
    layout: ClauseLayout;
    /**
     * Indent of the keyword relative to the statement base.
     * Joins sit one level in from `FROM`; `ON` one level in from its join.
     */
    keywordIndentDelta: number;
    /** Marks clauses that reset the statement's clause indent (set operators). */
    isSetOperator?: boolean;
    isJoin?: boolean;
    isOn?: boolean;
}

/**
 * Clause phrases, checked longest-first so `GROUP BY` wins over `GROUP` and
 * `DELETE FROM` over `DELETE`.
 */
const CLAUSES: ClauseDef[] = [
    { words: ['WHEN', 'NOT', 'MATCHED'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['WHEN', 'MATCHED'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['INSERT', 'INTO'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['DELETE', 'FROM'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['MERGE', 'INTO'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['GROUP', 'BY'], layout: 'keywordOwnLine', keywordIndentDelta: 0 },
    { words: ['ORDER', 'BY'], layout: 'keywordOwnLine', keywordIndentDelta: 0 },
    { words: ['PARTITION', 'BY'], layout: 'keywordOwnLine', keywordIndentDelta: 0 },
    { words: ['UNION', 'ALL'], layout: 'inlineBody', keywordIndentDelta: 0, isSetOperator: true },
    { words: ['FETCH', 'FIRST'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['FETCH', 'NEXT'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['FOR', 'XML'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['FOR', 'JSON'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['CROSS', 'APPLY'], layout: 'inlineBody', keywordIndentDelta: 1, isJoin: true },
    { words: ['OUTER', 'APPLY'], layout: 'inlineBody', keywordIndentDelta: 1, isJoin: true },
    { words: ['SELECT'], layout: 'keywordOwnLine', keywordIndentDelta: 0 },
    { words: ['FROM'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['WHERE'], layout: 'expression', keywordIndentDelta: 0 },
    { words: ['HAVING'], layout: 'expression', keywordIndentDelta: 0 },
    { words: ['VALUES'], layout: 'keywordOwnLine', keywordIndentDelta: 0 },
    { words: ['SET'], layout: 'keywordOwnLine', keywordIndentDelta: 0 },
    { words: ['OUTPUT'], layout: 'keywordOwnLine', keywordIndentDelta: 0 },
    { words: ['RETURNING'], layout: 'keywordOwnLine', keywordIndentDelta: 0 },
    { words: ['USING'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['UPDATE'], layout: 'inlineBody', keywordIndentDelta: 0 },
    // Bare forms, used by MERGE actions (`WHEN MATCHED THEN DELETE`) and by
    // T-SQL's optional INTO. Listed after their two-word variants above.
    { words: ['INSERT'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['DELETE'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['INTO'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['LIMIT'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['OFFSET'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['OPTION'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['PIVOT'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['UNPIVOT'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['WINDOW'], layout: 'keywordOwnLine', keywordIndentDelta: 0 },
    // Only a CTE header; `WITH (NOLOCK)` and `WITH CHECK` are filtered out
    // by the formatter before this matches.
    { words: ['WITH'], layout: 'inlineBody', keywordIndentDelta: 0 },
    { words: ['UNION'], layout: 'inlineBody', keywordIndentDelta: 0, isSetOperator: true },
    { words: ['EXCEPT'], layout: 'inlineBody', keywordIndentDelta: 0, isSetOperator: true },
    { words: ['INTERSECT'], layout: 'inlineBody', keywordIndentDelta: 0, isSetOperator: true },
    { words: ['MINUS'], layout: 'inlineBody', keywordIndentDelta: 0, isSetOperator: true },
    { words: ['ON'], layout: 'expression', keywordIndentDelta: 1, isOn: true },
];

/** Words that may precede `JOIN`, in the order T-SQL accepts them. */
const JOIN_SIDES = new Set(['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL']);
const JOIN_HINTS = new Set(['LOOP', 'HASH', 'MERGE', 'REMOTE', 'REDUCE', 'REPLICATE']);

/** Keywords that begin a new top-level statement. */
export const STATEMENT_STARTERS: ReadonlySet<string> = new Set([
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'WITH', 'CREATE', 'ALTER',
    'DROP', 'TRUNCATE', 'DECLARE', 'SET', 'EXEC', 'EXECUTE', 'PRINT',
    'RAISERROR', 'THROW', 'RETURN', 'IF', 'WHILE', 'BEGIN', 'END', 'USE',
    'GRANT', 'REVOKE', 'DENY', 'WAITFOR', 'COMMIT', 'ROLLBACK', 'SAVE',
    'BREAK', 'CONTINUE', 'GOTO', 'OPEN', 'CLOSE', 'DEALLOCATE', 'BACKUP',
    'RESTORE', 'DBCC', 'ELSE', 'TRY', 'CATCH', 'CALL', 'DO', 'EXPLAIN',
    'ANALYZE', 'VACUUM', 'PRAGMA', 'SHOW', 'REFRESH', 'COMMENT',
]);

/**
 * Tokens after which a `SELECT`/`INSERT`/... is a *continuation*, not the start
 * of a new statement (`... UNION SELECT`, `INSERT ... SELECT`, `(SELECT ...)`).
 */
const CONTINUATION_PREDECESSORS: ReadonlySet<string> = new Set([
    'UNION', 'ALL', 'EXCEPT', 'INTERSECT', 'MINUS', 'AS', 'THEN', 'ELSE',
    'IN', 'EXISTS', 'AND', 'OR', 'NOT', 'INTO', 'FROM', 'RETURNS', 'IS',
    'WHEN', 'BY', 'USING', 'ON', 'WITH', 'CASE', 'FOR', 'WHILE', 'IF',
]);

export interface ClauseMatch {
    def: ClauseDef;
    /** Number of tokens the clause keyword occupies. */
    length: number;
}

/** Matches a clause phrase starting at `tokens[i]`, longest phrase first. */
export function matchClause(tokens: Token[], i: number): ClauseMatch | null {
    const join = matchJoin(tokens, i);
    if (join !== null) {
        return join;
    }
    for (const def of CLAUSES) {
        if (matchesWords(tokens, i, def.words)) {
            return { def, length: def.words.length };
        }
    }
    return null;
}

/** Matches `[INNER|LEFT|...] [OUTER] [LOOP|HASH|...] JOIN`. */
function matchJoin(tokens: Token[], i: number): ClauseMatch | null {
    let j = i;
    const words: string[] = [];
    if (isWord(tokens[j]) && JOIN_SIDES.has(tokens[j].key)) {
        words.push(tokens[j].key);
        j += 1;
    }
    if (isWord(tokens[j]) && tokens[j].key === 'OUTER') {
        words.push('OUTER');
        j += 1;
    }
    if (isWord(tokens[j]) && JOIN_HINTS.has(tokens[j].key)) {
        words.push(tokens[j].key);
        j += 1;
    }
    if (!isWord(tokens[j]) || tokens[j].key !== 'JOIN') {
        return null;
    }
    words.push('JOIN');
    return {
        def: { words, layout: 'inlineBody', keywordIndentDelta: 1, isJoin: true },
        length: words.length,
    };
}

function matchesWords(tokens: Token[], i: number, words: string[]): boolean {
    for (let k = 0; k < words.length; k += 1) {
        const token = tokens[i + k];
        if (!isWord(token) || token.key !== words[k]) {
            return false;
        }
    }
    return true;
}

function isWord(token: Token | undefined): token is Token {
    return token !== undefined && token.type === TokenType.Word;
}

/**
 * Decides whether `tokens[i]` opens a new statement. Beyond the explicit
 * boundaries (`;`, `GO`, `BEGIN`, `END`) this also catches scripts written
 * without semicolons, where a statement keyword simply starts a fresh line.
 */
export function startsNewStatement(
    tokens: Token[],
    i: number,
    previous: Token | undefined,
    statementHasContent: boolean,
): boolean {
    const token = tokens[i];
    if (token.type !== TokenType.Word || !STATEMENT_STARTERS.has(token.key)) {
        return false;
    }
    if (!statementHasContent) {
        return false;
    }
    if (previous === undefined) {
        return false;
    }
    // An explicit terminator already ended the previous statement.
    if (
        previous.type === TokenType.Semicolon ||
        previous.type === TokenType.BatchSeparator
    ) {
        return true;
    }
    // Only trust the heuristic when the author started a new source line.
    if (token.precedingNewlines === 0) {
        return false;
    }
    if (previous.type === TokenType.Word && CONTINUATION_PREDECESSORS.has(previous.key)) {
        return false;
    }
    if (
        previous.type === TokenType.Operator ||
        previous.type === TokenType.Comma ||
        previous.type === TokenType.OpenParen ||
        previous.type === TokenType.Dot
    ) {
        return false;
    }
    // `ELSE`, `BEGIN` and `END` are handled by the block logic, not here.
    if (token.key === 'ELSE' || token.key === 'BEGIN' || token.key === 'END') {
        return false;
    }
    return true;
}
