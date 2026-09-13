import {
    STATEMENT_STARTERS,
    matchClause,
    startsNewStatement,
    type ClauseDef,
} from './clauses';
import { getDialect, type Dialect } from './dialects';
import {
    indentWidth,
    resolveOptions,
    type CaseStyle,
    type CommaPlacement,
    type DeepPartial,
    type FormatOptions,
    type OpeningParen,
    type ParenElements,
    type ParenStyle,
    type Placement,
    type WrapMode,
} from './options';
import { Printer, leftAlignMark } from './printer';
import { TokenType, tokenize, type Token } from './tokenizer';

const BOOLEAN_LITERAL_KEYS = new Set(['NULL', 'TRUE', 'FALSE']);
const UNARY_OPERATORS = new Set(['-', '+', '~', '!']);
/** Words that may follow `BEGIN` without opening an indented block. */
const NON_BLOCK_BEGIN = new Set(['TRAN', 'TRANSACTION', 'DISTRIBUTED']);
/** Words that pair with `BEGIN` / `END` to form a block. */
const BLOCK_QUALIFIERS = new Set(['TRY', 'CATCH']);
/**
 * Statements whose bodies are keyword soup rather than clauses. Inside them,
 * words like `SELECT` and `ON` are operands, so clause layout is switched off
 * (`GRANT SELECT ON dbo.T TO reader`).
 */
const CLAUSELESS_STATEMENTS = new Set([
    'GRANT', 'REVOKE', 'DENY', 'PRINT', 'RAISERROR', 'THROW', 'USE', 'DBCC',
    'WAITFOR', 'GOTO', 'BREAK', 'CONTINUE', 'COMMIT', 'ROLLBACK', 'SAVE',
    'EXEC', 'EXECUTE', 'DECLARE', 'SET', 'BACKUP', 'RESTORE',
]);
/** Statements laid out with the DDL tab's settings rather than the Queries tab's. */
const DDL_STATEMENTS = new Set(['CREATE', 'ALTER', 'DROP', 'TRUNCATE']);

/** The settings section that governs one parenthesised group. */
interface ParenSection {
    style: ParenStyle;
    comma: CommaPlacement;
    wrap: WrapMode;
    /** A trailing DDL option list, which has its own wrapping settings. */
    postfix?: boolean;
}

/** A half-open token range. */
interface Range {
    start: number;
    end: number;
}

/** Saved layout state, restored when a BEGIN block closes. */
interface Frame {
    statementIndent: number;
    statementKeyword: string | null;
}

/** Everything `layoutList` needs in order to place one clause's elements. */
interface ListStyle {
    placement: Placement;
    wrap: WrapMode;
    comma: CommaPlacement;
    /** Indent for element lines when they are not column-aligned. */
    elementIndent: number;
    /** Whether elements line up in a column under the first one. */
    align: boolean;
    /** Put the first element on a line of its own, indented. */
    underHeader: boolean;
    /** Break even when the whole list would fit, because a setting asked for it. */
    forceBreak: boolean;
    /** Alignment group for "Align AS" / "Align =" / "Align ASC-DESC". */
    tailAlignGroup: string | null;
    /** Which token the tail alignment group lines up on. */
    tailAlignKind: TailAlign;
}

type TailAlign = 'none' | 'as' | 'equals' | 'ascDesc';

export function formatSql(
    sql: string,
    options: DeepPartial<FormatOptions> = {},
): string {
    const opts = resolveOptions(options);
    const dialect = getDialect(opts.dialect);
    const tokens = tokenize(sql, dialect);
    if (tokens.length === 0) {
        return '';
    }
    return new SqlFormatter(tokens, opts, dialect).run();
}

const isComment = (token: Token): boolean =>
    token.type === TokenType.LineComment || token.type === TokenType.BlockComment;

/** Returns the dominant line terminator in `text`. */
export function detectNewline(text: string): string {
    const crlf = (text.match(/\r\n/gu) ?? []).length;
    const lf = (text.match(/(?<!\r)\n/gu) ?? []).length;
    return crlf > lf ? '\r\n' : '\n';
}

class SqlFormatter {
    private readonly tokens: Token[];
    private readonly opts: FormatOptions;
    private readonly dialect: Dialect;
    private readonly printer: Printer;
    private readonly frames: Frame[] = [];
    private readonly singleStatementIndents: number[] = [];

    private statementIndent = 0;
    /** Indent used for continuation lines of the construct being written. */
    private breakIndent = 0;
    private clause: ClauseDef | null = null;
    private statementHasContent = false;
    private betweenDepth = 0;
    private pendingBody = false;
    private cteStatement = false;
    private forceStatementAt = -1;
    private statementKeyword: string | null = null;
    private mergeWhenIndent: number | null = null;
    /** Whether a join has already been written in the current FROM clause. */
    private joinSeen = false;
    /** Indent of the FROM clause that the current joins belong to. */
    private fromIndent = 0;
    /** True when the FROM holds joins only, with no comma-separated tables. */
    private fromJoinOnly = false;
    /** Alignment groups shared by every join line of the current FROM. */
    private joinTableGroup: string | null = null;
    private joinAliasGroup: string | null = null;
    /**
     * Width of the clause-keyword field for the current statement, used by
     * river style. Computed once per statement so the column every clause body
     * starts at is known while writing rather than only afterwards.
     */
    private keywordField: number | null = null;
    /** Alignment group active for the element currently being written. */
    private tailAlignGroup: string | null = null;
    private tailAlignKind: TailAlign = 'none';
    private tailAlignUsed = false;
    private groupCounter = 0;
    /** Columns in one indent level; all indents below are column counts. */
    private readonly unit: number;
    /** Columns a continuation line is indented past the line it continues. */
    private readonly continuation: number;
    /** Spacing inside the parenthesised groups currently open, innermost last. */
    private readonly parenSpaces: boolean[] = [];
    /** Depth of DDL column lists being written, where query clauses do not apply. */
    private ddlGroupDepth = 0;
    /** Alignment group for trailing line comments in the list being written. */
    private commentAlignGroup: string | null = null;
    /** True while writing a routine's parameter list. */
    private inRoutineSignature = false;
    /** True while writing a CREATE / ALTER VIEW. */
    private inViewStatement = false;
    /** Suppresses the line break the next clause keyword would take. */
    private suppressClauseBreak = false;
    /** Statement indents saved for open LOOP blocks. */
    private readonly loopIndents: number[] = [];
    /** Whether the statement just written was a DDL declaration. */
    private previousWasDeclaration = false;
    /** Extra indent applied to declarations inside a CREATE SCHEMA. */
    private schemaIndent = 0;
    /**
     * Depth of "this group was measured and fits, write it on one line".
     * While it is above zero no construct may introduce a line break.
     */
    private inlineDepth = 0;
    /**
     * Set after an alignment mark: the separator has already been written, so
     * the next token must not add one of its own.
     */
    private suppressSpace = false;

    constructor(tokens: Token[], opts: FormatOptions, dialect: Dialect) {
        this.tokens = tokens;
        this.opts = opts;
        this.dialect = dialect;
        this.printer = new Printer(opts);
        this.unit = indentWidth(opts);
        this.continuation = Math.max(1, opts.indents.continuationIndent);
    }

    run(): string {
        this.emitRange(0, this.tokens.length);
        return this.printer.toString();
    }

    private get inline(): boolean {
        return this.inlineDepth > 0;
    }

    /** Emits `[from, to)` with every line break suppressed. */
    private emitInline(from: number, to: number): void {
        this.inlineDepth += 1;
        this.emitRange(from, to);
        this.inlineDepth -= 1;
    }

    /**
     * Writes an alignment mark. Any separating space has to go in front of the
     * mark, because padding inserted at the mark cannot move text that already
     * precedes it; the next token is then emitted without its own separator.
     */
    private markAlign(group: string, separate: boolean): void {
        if (separate && !this.printer.isLineEmpty) {
            this.printer.append(' ', false);
        }
        this.printer.appendRaw(leftAlignMark(group));
        this.suppressSpace = true;
    }

    private nextGroup(prefix: string): string {
        this.groupCounter += 1;
        return `${prefix}${this.groupCounter}`;
    }

    // ------------------------------------------------------------------
    // Main dispatch
    // ------------------------------------------------------------------

    private emitRange(from: number, to: number): void {
        let i = from;
        while (i < to) {
            const next = this.step(i, to);
            i = next > i ? next : i + 1;
        }
    }

    private step(i: number, limit: number): number {
        const token = this.tokens[i];

        if (token.type === TokenType.LineComment || token.type === TokenType.BlockComment) {
            this.emitComment(i);
            return i + 1;
        }

        switch (token.type) {
            case TokenType.BatchSeparator:
                this.emitBatchSeparator(i);
                return i + 1;
            case TokenType.Semicolon:
                this.emitSemicolon(i);
                return i + 1;
            case TokenType.OpenParen:
                return this.handleOpenParen(i, limit);
            case TokenType.Word:
                return this.handleWord(i, limit);
            default:
                this.emitWithTailAlign(i);
                return i + 1;
        }
    }

    private handleWord(i: number, limit: number): number {
        const token = this.tokens[i];

        if (token.key === 'CASE' && !this.inline) {
            return this.layoutCase(i, limit);
        }
        if (!this.inline) {
            if (token.key === 'BEGIN' && this.isBlockBegin(i)) {
                return this.openBlock(i);
            }
            if (token.key === 'END' && this.frames.length > 0) {
                return this.closeBlock(i);
            }
            if (token.key === 'ELSE') {
                return this.emitElse(i);
            }
            if (
                token.key === 'THEN' &&
                this.opts.code.block.wrapThen &&
                this.statementKeyword === 'IF'
            ) {
                this.breakLine(
                    this.opts.code.block.indentThenAndElse
                        ? this.statementIndent + this.unit
                        : this.statementIndent,
                    token,
                );
                this.emit(i);
                return i + 1;
            }
        }

        if (!this.inline && this.startsStatementAt(i)) {
            this.endStatement(false);
            this.keepAuthorBlankLine(token);
            this.beginStatement();
        }

        if (token.key === 'BETWEEN') {
            this.betweenDepth += 1;
        }
        if (token.key === 'AND' && this.betweenDepth > 0) {
            this.betweenDepth -= 1;
            this.emit(i);
            return i + 1;
        }

        if (token.key === 'DECLARE' && !this.statementHasContent) {
            return this.emitDeclare(i, limit);
        }
        if (
            (token.key === 'PROCEDURE' || token.key === 'PROC' || token.key === 'FUNCTION') &&
            (this.statementKeyword === 'CREATE' || this.statementKeyword === 'ALTER')
        ) {
            return this.emitRoutineSignature(i, limit);
        }
        if (token.key === 'VIEW' &&
            (this.statementKeyword === 'CREATE' || this.statementKeyword === 'ALTER')) {
            this.inViewStatement = true;
        }
        if (token.key === 'AS' && this.inViewStatement) {
            return this.emitViewAs(i);
        }
        if (token.key === 'ADD' && this.statementKeyword === 'ALTER') {
            return this.emitAlterInstructions(i, limit);
        }
        if (token.key === 'LOOP' && !this.inline) {
            return this.openLoop(i);
        }
        if (token.key === 'END' && this.tokens[i + 1]?.key === 'LOOP' && this.loopIndents.length > 0) {
            return this.closeLoop(i);
        }

        // With `enabled`, a whole short statement goes on one line, clauses and
        // all; the check has to come before clause layout claims the keyword.
        if (
            !this.statementHasContent &&
            this.opts.queries.common.collapseShortStatements === 'enabled'
        ) {
            const collapsed = this.tryCollapseStatement(i, limit);
            if (collapsed > i) {
                return collapsed;
            }
        }

        const clause = this.matchClauseAt(i);
        if (clause !== null) {
            return this.emitClause(i, clause.def, clause.length, limit);
        }

        if (!this.statementHasContent) {
            const collapsed = this.tryCollapseStatement(i, limit);
            if (collapsed > i) {
                return collapsed;
            }
        }

        this.emitWithTailAlign(i);
        if (token.key === 'IF' || token.key === 'WHILE') {
            this.pendingBody = true;
            this.forceStatementAt = this.findConditionEnd(i + 1);
        }
        return i + 1;
    }

    // ------------------------------------------------------------------
    // Clause layout
    // ------------------------------------------------------------------

    private matchClauseAt(i: number): { def: ClauseDef; length: number } | null {
        const match = matchClause(this.tokens, i);
        if (match === null) {
            return null;
        }
        if (this.statementKeyword !== null && CLAUSELESS_STATEMENTS.has(this.statementKeyword)) {
            return null;
        }
        // Inside a column list, words like ON and DELETE are constraint syntax,
        // not query clauses.
        if (this.ddlGroupDepth > 0) {
            return null;
        }
        // `SET` only introduces a clause inside an UPDATE or MERGE. Opening a
        // statement, it is T-SQL's own SET (`SET NOCOUNT ON`, `SET @x = 1`).
        if (match.def.words[0] === 'SET' && !this.statementHasContent) {
            return null;
        }
        // `WITH` introduces a clause only when it heads a CTE list; elsewhere it
        // is a table hint (`WITH (NOLOCK)`) or a constraint option.
        if (match.def.words[0] === 'WITH' && !this.isCteWith(i)) {
            return null;
        }
        // `ON` belongs to the join (or MERGE `USING`) it follows. Elsewhere it
        // is part of something else -- `CREATE INDEX ... ON t`, `GRANT ... ON t`.
        if (match.def.isOn) {
            const owner = this.clause;
            const joinable =
                owner !== null && (owner.isJoin === true || owner.words[0] === 'USING');
            if (!joinable) {
                return null;
            }
        }
        return match;
    }

    private emitClause(i: number, def: ClauseDef, length: number, limit: number): number {
        if (this.inline) {
            for (let k = 0; k < length; k += 1) {
                this.emit(i + k);
            }
            this.clause = def;
            return i + length;
        }
        const common = this.opts.queries.common;
        const owner = this.clause;
        const isMergeWhen = def.words[0] === 'WHEN';
        if (isMergeWhen && this.mergeWhenIndent !== null) {
            this.statementIndent = this.mergeWhenIndent;
        }

        let keywordIndent = this.clauseKeywordIndent(def, owner);
        if (common.alignFirstWordOfClause === 'toRight' && !def.isOn) {
            if (this.keywordField === null) {
                this.keywordField = this.measureKeywordField(i);
            }
            keywordIndent += this.keywordField - this.clauseKeywordWidth(i, length);
        }
        if (this.shouldWrapClause(def)) {
            this.breakLine(keywordIndent, this.tokens[i]);
        }

        for (let k = 0; k < length; k += 1) {
            if (
                k > 0 &&
                def.words[k] === 'INTO' &&
                this.opts.queries.insert.placeIntoOnNewLine
            ) {
                this.printer.newline();
                this.printer.setIndent(
                    common.alignFirstWordOfClause === 'toLeftWithIndent'
                        ? keywordIndent + this.unit
                        : keywordIndent,
                );
            }
            this.emit(i + k);
        }
        if (def.isJoin) {
            this.joinSeen = true;
        } else if (def.words[0] === 'FROM') {
            this.joinSeen = false;
            this.fromIndent = keywordIndent;
            this.joinTableGroup = this.opts.queries.from.alignJoinedTables
                ? this.nextGroup('jt') : null;
            this.joinAliasGroup = this.opts.queries.from.alignTableAliases
                ? this.nextGroup('ja') : null;
        }
        this.clause = def;
        // The WITH clause keeps the CTE flag it just set; every other clause
        // ends any CTE header that preceded it.
        if (def.words[0] !== 'WITH') {
            this.cteStatement = false;
        }

        let bodyStart = i + length;
        let forceUnderHeader = false;
        if (def.words[0] === 'SELECT') {
            // ALL / DISTINCT belong to the keyword, not to the select list.
            const qualifier = this.tokens[bodyStart];
            if (
                qualifier?.type === TokenType.Word &&
                (qualifier.key === 'ALL' || qualifier.key === 'DISTINCT')
            ) {
                this.emit(bodyStart);
                bodyStart += 1;
                forceUnderHeader = this.opts.queries.select.newLineAfterAllDistinct;
            }
        }
        this.breakIndent = keywordIndent + this.unit;
        if (isMergeWhen) {
            this.mergeWhenIndent = this.statementIndent;
            this.statementIndent += this.unit;
        }
        if (def.isSetOperator) {
            this.breakIndent = this.statementIndent + this.unit;
            return bodyStart;
        }

        const bodyEnd = Math.min(this.findClauseEnd(bodyStart), limit);
        if (bodyStart >= bodyEnd) {
            return bodyStart;
        }

        if (def.words[0] === 'FROM') {
            this.fromJoinOnly = !this.hasTopLevelComma(bodyStart, this.findFromEnd(bodyStart));
        }
        this.layoutClauseBody(def, bodyStart, bodyEnd, keywordIndent, forceUnderHeader);
        return bodyEnd;
    }

    /** Queries > From controls whether a join starts its own line. */
    private shouldWrapClause(def: ClauseDef): boolean {
        if (this.suppressClauseBreak) {
            this.suppressClauseBreak = false;
            return false;
        }
        if (!def.isJoin) {
            if (def.isOn) {
                // MERGE's ON is structural, so it always wraps; a join's ON is
                // governed by Queries > From.
                return this.clause?.words[0] === 'USING' || this.opts.queries.from.wrapOnUsing;
            }
            return true;
        }
        // `this.clause` is the join's own ON by the time the next join arrives,
        // so the first-vs-next decision needs its own flag.
        const from = this.opts.queries.from;
        return this.joinSeen ? from.wrapNextJoin : from.wrapFirstJoin;
    }

    private clauseKeywordIndent(def: ClauseDef, owner: ClauseDef | null): number {
        const common = this.opts.queries.common;
        const from = this.opts.queries.from;
        const base = this.statementIndent;
        if (def.isSetOperator) {
            return base;
        }
        if (def.isOn) {
            if (owner?.words[0] === 'USING') {
                return base + this.unit;
            }
            return from.placeOnUsingUnder === 'tableIndented'
                ? base + this.unit * 2
                : base + this.unit;
        }
        if (def.isJoin) {
            // River style right-aligns joins with the other clause keywords, so
            // the join indent would fight the alignment.
            if (common.alignFirstWordOfClause === 'toRight') {
                return base;
            }
            if (!from.indentJoin) {
                return base;
            }
            // `indentJoin` decides whether a join is indented at all; for a
            // FROM that holds nothing but joins, this decides what it lines up
            // under.
            if (this.fromJoinOnly) {
                switch (from.placeJoinInJoinOnlyQueriesUnder) {
                    case 'from':
                        return this.fromIndent;
                    case 'table':
                        return this.fromIndent + 'FROM '.length;
                    default:
                        return this.fromIndent + this.unit;
                }
            }
            return base + this.unit;
        }
        if (common.alignFirstWordOfClause === 'toLeftWithIndent') {
            // A hanging indent: the statement's own keyword stays out at the
            // margin and the clauses under it are indented.
            return this.statementHasContent ? base + this.unit : base;
        }
        return base;
    }

    /** Widest clause keyword in the statement starting at `i`. */
    private measureKeywordField(i: number): number {
        const end = this.findStatementEnd(i);
        let depth = 0;
        let widest = 0;
        for (let j = i; j < end; j += 1) {
            const token = this.tokens[j];
            if (token.type === TokenType.OpenParen) {
                depth += 1;
                continue;
            }
            if (token.type === TokenType.CloseParen) {
                depth -= 1;
                continue;
            }
            if (depth > 0 || token.type !== TokenType.Word) {
                continue;
            }
            const match = matchClause(this.tokens, j);
            if (match !== null && !match.def.isOn) {
                widest = Math.max(widest, this.clauseKeywordWidth(j, match.length));
            }
        }
        return widest;
    }

    private clauseKeywordWidth(i: number, length: number): number {
        let width = 0;
        for (let k = 0; k < length; k += 1) {
            width += this.renderToken(i + k).length + (k > 0 ? 1 : 0);
        }
        return width;
    }

    private layoutClauseBody(
        def: ClauseDef,
        bodyStart: number,
        bodyEnd: number,
        keywordIndent: number,
        forceUnderHeader = false,
    ): void {
        const style = this.listStyleFor(def, keywordIndent);
        if (forceUnderHeader) {
            // The keyword line already ends at ALL / DISTINCT, so the list
            // starts beneath it rather than aligned to a first element.
            style.underHeader = true;
            style.align = false;
            style.forceBreak = true;
            style.elementIndent = keywordIndent + this.unit;
        }
        if (def.isJoin) {
            this.breakIndent = style.elementIndent;
            this.emitJoinBody(bodyStart, bodyEnd);
            return;
        }
        if (def.isOn || def.isSetOperator) {
            this.breakIndent = style.elementIndent;
            this.emitRange(bodyStart, bodyEnd);
            return;
        }
        this.layoutList(bodyStart, bodyEnd, style, def);
    }

    /** A join body is `table [AS] alias`, with its own column alignment. */
    private emitJoinBody(start: number, end: number): void {
        if (this.joinTableGroup !== null) {
            this.markAlign(this.joinTableGroup, true);
        }
        let i = start;
        // The table reference: a name, possibly schema-qualified or a function.
        while (i < end) {
            const token = this.tokens[i];
            const isAliasStart =
                i > start &&
                this.tokens[i - 1].type !== TokenType.Dot &&
                token.type !== TokenType.Dot &&
                (token.type === TokenType.Word || token.type === TokenType.QuotedIdentifier);
            if (isAliasStart) {
                break;
            }
            i = this.step(i, end);
        }
        if (i < end && this.joinAliasGroup !== null) {
            this.markAlign(this.joinAliasGroup, true);
        }
        this.emitRange(i, end);
    }

    private hasTopLevelComma(start: number, end: number): boolean {
        let depth = 0;
        for (let j = start; j < end; j += 1) {
            const type = this.tokens[j].type;
            if (type === TokenType.OpenParen) {
                depth += 1;
            } else if (type === TokenType.CloseParen) {
                depth -= 1;
            } else if (type === TokenType.Comma && depth === 0) {
                return true;
            }
        }
        return false;
    }

    /** End of the whole FROM section, joins included. */
    private findFromEnd(start: number): number {
        let depth = 0;
        for (let j = start; j < this.tokens.length; j += 1) {
            const token = this.tokens[j];
            if (token.type === TokenType.OpenParen) {
                depth += 1;
                continue;
            }
            if (token.type === TokenType.CloseParen) {
                if (depth === 0) return j;
                depth -= 1;
                continue;
            }
            if (depth > 0 || token.type !== TokenType.Word) {
                continue;
            }
            const match = matchClause(this.tokens, j);
            if (match !== null && !match.def.isJoin && !match.def.isOn) {
                return j;
            }
        }
        return this.tokens.length;
    }

    /** Words that end a routine's parameter list. */
    private static readonly ROUTINE_BODY = new Set(['AS', 'RETURNS', 'WITH', 'BEGIN', 'RETURN']);

    /**
     * `CREATE PROCEDURE name @a int, @b int AS` and its parenthesised cousin.
     * The parameter list gets the Code > Routine Arguments settings; a
     * parenthesised list is handed to the normal group layout, which picks the
     * same section up through `inRoutineSignature`.
     */
    private emitRoutineSignature(i: number, limit: number): number {
        const cfg = this.opts.code.routineArguments;
        this.emit(i);
        let j = i + 1;
        // The routine's name, which may be schema-qualified or quoted.
        while (j < limit) {
            const token = this.tokens[j];
            if (
                token.type === TokenType.Variable ||
                token.type === TokenType.OpenParen ||
                (token.type === TokenType.Word && SqlFormatter.ROUTINE_BODY.has(token.key))
            ) {
                break;
            }
            this.emit(j);
            j += 1;
        }
        if (j >= limit || this.tokens[j].type !== TokenType.Variable) {
            this.inRoutineSignature = this.tokens[j]?.type === TokenType.OpenParen;
            return j;
        }

        const end = this.findRoutineArgumentsEnd(j, limit);
        const keywordIndent = this.printer.currentLineIndent;
        const style: ListStyle = {
            placement: cfg.newLineAfterComma ? 'newLine' : 'sameLine',
            wrap: cfg.wrapElements,
            comma: cfg.placeComma === 'asInCommon'
                ? this.opts.queries.common.placeComma
                : cfg.placeComma,
            elementIndent: keywordIndent + this.continuation,
            align: this.opts.queries.common.alignSectionElements,
            underHeader: false,
            forceBreak: false,
            tailAlignGroup: null,
            tailAlignKind: 'none',
        };
        this.layoutSimpleList(j, end, style);
        this.inRoutineSignature = false;
        return end;
    }

    private findRoutineArgumentsEnd(start: number, limit: number): number {
        let depth = 0;
        for (let j = start; j < limit; j += 1) {
            const token = this.tokens[j];
            if (token.type === TokenType.OpenParen) {
                depth += 1;
                continue;
            }
            if (token.type === TokenType.CloseParen) {
                depth -= 1;
                continue;
            }
            if (depth > 0) {
                continue;
            }
            if (token.type === TokenType.Semicolon) {
                return j;
            }
            if (token.type === TokenType.Word && SqlFormatter.ROUTINE_BODY.has(token.key)) {
                return j;
            }
        }
        return limit;
    }

    /** A comma-separated list laid out with no clause keyword in front of it. */
    private layoutSimpleList(start: number, end: number, style: ListStyle): void {
        const elements = this.splitElements(start, end);
        if (elements.length === 0) {
            return;
        }
        style.comma = this.resolveComma(style.comma, start, end);
        const oneLine =
            style.placement === 'sameLine' ||
            style.wrap === 'doNotChange' ||
            (style.wrap !== 'chop' && style.wrap !== 'wrapIfLong'
                && this.rangeFits(start, end, this.printer.column + 1)) ||
            (style.wrap === 'wrapIfLong' && this.rangeFits(start, end, this.printer.column + 1)) ||
            (style.wrap === 'chop' && elements.length === 1);
        const fill = style.wrap === 'wrapIfLong' && !oneLine;
        const column = oneLine || !style.align ? style.elementIndent : this.printer.column + 1;

        for (const [index, element] of elements.entries()) {
            if (index > 0 && !oneLine && (!fill || !this.elementFitsOnCurrentLine(element))) {
                this.breakBeforeElement(element, style, column);
            }
            this.emitRange(element.start, element.end);
            if (index < elements.length - 1 && (oneLine || style.comma !== 'toBegin')) {
                const comma = this.tokens[element.end];
                if (comma?.type === TokenType.Comma) {
                    this.emit(element.end);
                }
            }
        }
    }

    /** `CREATE VIEW v AS <query>`. */
    private emitViewAs(i: number): number {
        const cfg = this.opts.ddl.view;
        if (cfg.wrapAs) {
            this.breakLine(this.statementIndent, this.tokens[i]);
        }
        this.emit(i);
        if (cfg.indentQuery) {
            this.statementIndent += this.unit;
            this.breakIndent = this.statementIndent + this.unit;
        }
        this.suppressClauseBreak = !cfg.wrapQueryBeginning;
        this.inViewStatement = false;
        return i + 1;
    }

    /** `ALTER TABLE t ADD a int, b int`. */
    private emitAlterInstructions(i: number, limit: number): number {
        const ddl = this.opts.ddl;
        this.emit(i);
        const start = i + 1;
        const end = Math.min(this.findStatementEnd(start), limit);
        if (start >= end) {
            return start;
        }
        const style: ListStyle = {
            placement: ddl.wrapAlterInstructions ? 'newLine' : 'sameLine',
            wrap: ddl.wrapAlterInstructions ? 'chop' : 'chopIfLong',
            comma: this.opts.queries.common.placeComma,
            elementIndent: this.statementIndent + this.unit,
            align: ddl.alignAlterInstructions,
            underHeader: false,
            forceBreak: false,
            tailAlignGroup: null,
            tailAlignKind: 'none',
        };
        this.layoutSimpleList(start, end, style);
        return end;
    }

    private openLoop(i: number): number {
        const cfg = this.opts.code.loops;
        const end = this.matchLoopEnd(i);
        if (cfg.collapseWhenShort && end !== -1 && this.groupFitsOnLine(i, end)) {
            this.emit(i);
            this.emitInline(i + 1, end + 2);
            return end + 2;
        }
        if (cfg.wrapLoop) {
            this.breakLine(
                cfg.indentLoop ? this.statementIndent + this.unit : this.statementIndent,
                this.tokens[i],
            );
        }
        this.emit(i);
        const loopIndent = this.printer.currentLineIndent;
        this.loopIndents.push(this.statementIndent);
        this.statementIndent = loopIndent + this.unit;
        this.breakIndent = this.statementIndent + this.unit;
        this.printer.newline();
        this.printer.setIndent(this.statementIndent);
        this.statementHasContent = false;
        return i + 1;
    }

    private closeLoop(i: number): number {
        this.endStatement(true);
        this.printer.clearPendingBlankLines();
        const saved = this.loopIndents.pop() as number;
        this.statementIndent = this.opts.code.loops.indentEndLoop ? saved + this.unit : saved;
        this.printer.newline();
        this.printer.setIndent(this.statementIndent);
        this.emit(i);
        this.emit(i + 1);
        this.statementIndent = saved;
        this.breakIndent = this.statementIndent + this.unit;
        this.statementHasContent = true;
        return i + 2;
    }

    /** Index of the `END` of `END LOOP` that closes the `LOOP` at `i`. */
    private matchLoopEnd(i: number): number {
        let depth = 0;
        for (let j = i; j < this.tokens.length; j += 1) {
            const token = this.tokens[j];
            if (token.type !== TokenType.Word) {
                continue;
            }
            if (token.key === 'LOOP' && this.tokens[j - 1]?.key !== 'END') {
                depth += 1;
            } else if (token.key === 'END' && this.tokens[j + 1]?.key === 'LOOP') {
                depth -= 1;
                if (depth === 0) {
                    return j;
                }
            }
        }
        return -1;
    }

    /**
     * A `DECLARE` section is a comma-separated list of `@name TYPE = value`,
     * laid out with its own settings and its own three alignment columns.
     */
    private emitDeclare(i: number, limit: number): number {
        const cfg = this.opts.code.declaredVariables;
        const common = this.opts.queries.common;
        this.emit(i);
        const start = i + 1;
        const end = Math.min(this.findStatementEnd(start), limit);
        if (start >= end) {
            return start;
        }

        const keywordIndent = this.printer.currentLineIndent;
        const style: ListStyle = {
            placement: cfg.wrapSection ? 'newLine' : 'sameLine',
            wrap: cfg.wrapVariables,
            comma: common.placeComma,
            elementIndent: keywordIndent + this.continuation,
            align: common.alignSectionElements,
            underHeader: false,
            forceBreak: false,
            tailAlignGroup: null,
            tailAlignKind: 'none',
        };
        const groups = {
            type: cfg.alignTypes ? this.nextGroup('vt') : null,
            assign: cfg.alignAssignments ? this.nextGroup('va') : null,
            expr: cfg.alignExpressions ? this.nextGroup('ve') : null,
        };

        const elements = this.splitElements(start, end);
        const oneLine =
            style.placement === 'sameLine' ||
            style.wrap === 'doNotChange' ||
            (style.wrap !== 'chop' && this.rangeFits(start, end, this.printer.column + 1));
        const fill = style.wrap === 'wrapIfLong' && !oneLine;
        const column = oneLine ? style.elementIndent : this.printer.column + 1;

        for (const [index, element] of elements.entries()) {
            if (index > 0 && !oneLine && (!fill || !this.elementFitsOnCurrentLine(element))) {
                this.breakBeforeElement(element, style, style.align ? column : style.elementIndent);
            }
            this.emitDeclaredVariable(element, groups);
            if (index < elements.length - 1 && style.comma !== 'toBegin') {
                const comma = this.tokens[element.end];
                if (comma?.type === TokenType.Comma) {
                    this.emit(element.end);
                }
            }
        }
        return end;
    }

    /** `@name TYPE = value`, with each part able to start at a fixed column. */
    private emitDeclaredVariable(
        element: Range,
        groups: { type: string | null; assign: string | null; expr: string | null },
    ): void {
        let i = this.skipLeadingComments(element.start, element.end);
        if (i < element.end) {
            this.emit(i);
            i += 1;
        }
        if (groups.type !== null && i < element.end) {
            this.markAlign(groups.type, true);
        }
        while (i < element.end) {
            const token = this.tokens[i];
            if (token.type === TokenType.Operator && token.value === '=') {
                break;
            }
            i = this.step(i, element.end);
        }
        if (i < element.end) {
            if (groups.assign !== null) {
                this.markAlign(groups.assign, true);
            }
            this.emit(i);
            i += 1;
            if (groups.expr !== null && i < element.end) {
                this.markAlign(groups.expr, true);
            }
        }
        this.emitRange(i, element.end);
    }

    /** Resolves the settings that apply to `def` into one ListStyle. */
    private listStyleFor(def: ClauseDef, keywordIndent: number): ListStyle {
        const q = this.opts.queries;
        const common = q.common;
        const head = def.words[0];
        let placement: Placement = 'asInCommon';
        let wrap: WrapMode = 'chopIfLong';
        let comma: CommaPlacement = 'asInCommon';
        let tail: TailAlign = 'none';
        let intoUnderHeader = false;

        if (head === 'SELECT') {
            placement = q.select.placeElementsOn;
            wrap = q.select.wrapElements;
            comma = q.select.placeComma;
            tail = q.select.alignAs ? 'as' : 'none';
        } else if (head === 'FROM') {
            placement = q.from.placeElementsOn;
            wrap = q.from.wrapElements;
            comma = q.from.placeComma;
        } else if (head === 'WHERE' || head === 'HAVING') {
            placement = q.where.placeElementsOn;
            wrap = q.where.wrapElements;
            tail = q.where.alignAs ? 'as' : 'none';
        } else if (head === 'GROUP' || head === 'ORDER') {
            placement = q.orderGroupBy.placeElementsOn;
            wrap = q.orderGroupBy.wrapElements;
            comma = q.orderGroupBy.placeComma;
            tail = q.orderGroupBy.alignAscDesc ? 'ascDesc' : 'none';
        } else if (head === 'SET') {
            placement = q.update.placeElementsOn;
            wrap = q.update.wrapElements;
            comma = q.update.placeComma;
            tail = q.update.alignEqualSign ? 'equals' : 'none';
        } else if (head === 'VALUES') {
            placement = q.insert.placeValuesRowsOn;
            // Rows only ever share a line when short rows may be collapsed.
            wrap = q.insert.collapseShortMultiRowValues ? q.insert.wrapColumnsOrValues : 'chop';
            comma = q.insert.placeComma;
        } else if (head === 'INSERT' || head === 'INTO') {
            placement = q.insert.placeIntoClauseElementsOn;
            wrap = q.insert.wrapColumnsOrValues;
            comma = q.insert.placeComma;
            // Choosing "new line" explicitly puts the target under the keyword;
            // inheriting it from Common keeps the usual `INSERT INTO t (...)`.
            intoUnderHeader = placement === 'newLine';
        } else if (head === 'WITH') {
            placement = q.with.placeElementsOn;
            wrap = q.with.wrapSubqueries;
            comma = q.with.placeComma;
            tail = q.with.alignAs ? 'as' : 'none';
        }

        return {
            placement: placement === 'asInCommon' ? common.placeClauseElementsOn : placement,
            wrap,
            comma: comma === 'asInCommon' ? common.placeComma : comma,
            elementIndent: keywordIndent + (common.keepElementsUnderSectionHeader ? this.unit : this.continuation),
            align: common.alignSectionElements && !common.keepElementsUnderSectionHeader,
            underHeader: common.keepElementsUnderSectionHeader || intoUnderHeader,
            forceBreak: intoUnderHeader,
            tailAlignGroup: tail === 'none' ? null : this.nextGroup('a'),
            tailAlignKind: tail,
        };
    }

    /**
     * Places the comma-separated elements of a clause body according to
     * the "place elements on" / "wrap elements" / "place comma" trio.
     */
    private layoutList(start: number, end: number, style: ListStyle, def: ClauseDef): void {
        const elements = this.splitElements(start, end);
        if (elements.length === 0) {
            return;
        }
        this.breakIndent = style.elementIndent;
        style.comma = this.resolveComma(style.comma, start, end);

        const head = def.words[0];
        const isPredicate = head === 'WHERE' || head === 'HAVING' || head === 'ON';
        if (isPredicate && elements.length === 1) {
            this.layoutPredicate(elements[0], style);
            return;
        }

        const oneLine =
            !style.forceBreak && this.listFitsOnOneLine(start, end, style, elements.length);
        const useAlign = !oneLine && style.align && !style.underHeader;
        // `inTheMiddle` means the comma is not a break point at all: the list
        // runs on and wraps only where the margin forces it.
        const wrapIfLong =
            !oneLine && (style.wrap === 'wrapIfLong' || style.comma === 'inTheMiddle');
        const followSource = style.wrap === 'doNotChange' && !oneLine;
        const savedCommentGroup = this.commentAlignGroup;
        this.commentAlignGroup =
            this.opts.queries.common.alignLineCommentsAtRightOfElements && !oneLine
                ? this.nextGroup('lc')
                : null;
        const rowGroup =
            head === 'VALUES' &&
            this.opts.queries.insert.alignMultiRowValues &&
            elements.length > 1 &&
            !oneLine
                ? this.nextGroup('vr')
                : null;
        // The column the elements line up in is known exactly: it is wherever
        // the first one lands after the clause keyword. Using a real indent
        // rather than an alignment mark keeps nested groups anchored correctly.
        let column = style.elementIndent;

        for (const [index, element] of elements.entries()) {
            const first = index === 0;
            if (first) {
                if (style.underHeader && !oneLine) {
                    this.printer.newline();
                    this.printer.setIndent(style.elementIndent);
                } else if (useAlign) {
                    column = this.printer.column + 1;
                }
            } else if (
                !oneLine &&
                (followSource
                    ? this.elementBreaksInSource(element)
                    : !wrapIfLong || !this.elementFitsOnCurrentLine(element))
            ) {
                this.breakBeforeElement(element, style, column);
            }

            this.beginTailAlign(style);
            if (rowGroup !== null) {
                this.emitValuesRow(element, rowGroup);
            } else if (head === 'SELECT' && this.opts.queries.select.useAs) {
                this.emitSelectItemWithAs(element);
            } else {
                this.emitRange(element.start, element.end);
            }
            this.endTailAlign();

            if (index < elements.length - 1) {
                this.emitComma(element.end, style, oneLine || wrapIfLong);
                // A comment written after the comma annotates the element that
                // just ended, so it stays on that line instead of opening the
                // next one.
                const next = elements[index + 1];
                while (
                    next.start < next.end &&
                    this.tokens[next.start].type === TokenType.LineComment &&
                    this.tokens[next.start].precedingNewlines === 0
                ) {
                    this.emitComment(next.start);
                    next.start += 1;
                }
            }
        }
        this.commentAlignGroup = savedCommentGroup;
    }

    /**
     * Writes a select item, inserting `AS` when the alias was written without
     * one. This is the one setting that adds a token rather than moving one.
     */
    private emitSelectItemWithAs(element: Range): void {
        const aliasAt = this.bareAliasIndex(element);
        if (aliasAt === -1) {
            this.emitRange(element.start, element.end);
            return;
        }
        this.emitRange(element.start, aliasAt);
        this.printer.append(this.applyCase('AS', this.opts.case.keyword), true);
        this.emitRange(aliasAt, element.end);
    }

    /** Index of an alias written without `AS`, or -1. */
    private bareAliasIndex(element: Range): number {
        const last = element.end - 1;
        if (last <= element.start) {
            return -1;
        }
        const alias = this.tokens[last];
        const before = this.tokens[last - 1];
        if (alias.type === TokenType.QuotedIdentifier) {
            return before.type === TokenType.Dot ? -1 : last;
        }
        if (alias.type !== TokenType.Word || this.dialect.keywords.has(alias.key)) {
            return -1;
        }
        switch (before.type) {
            case TokenType.Word:
                return this.dialect.keywords.has(before.key) ? -1 : last;
            case TokenType.QuotedIdentifier:
            case TokenType.CloseParen:
            case TokenType.Number:
            case TokenType.String:
            case TokenType.Variable:
                return last;
            default:
                return -1;
        }
    }

    /** Emits one `( ... )` row of a VALUES list with its columns aligned. */
    private emitValuesRow(element: Range, group: string): void {
        const open = element.start;
        if (this.tokens[open]?.type !== TokenType.OpenParen) {
            this.emitRange(element.start, element.end);
            return;
        }
        const close = this.matchParen(open);
        if (close === -1 || close >= element.end) {
            this.emitRange(element.start, element.end);
            return;
        }
        this.emit(open);
        const columns = this.splitElements(open + 1, close);
        for (const [index, column] of columns.entries()) {
            if (index > 0) {
                this.markAlign(`${group}c${index}`, true);
            }
            this.emitInline(column.start, column.end);
            if (index < columns.length - 1 && this.tokens[column.end]?.type === TokenType.Comma) {
                this.emit(column.end);
            }
        }
        this.emit(close);
        this.emitRange(close + 1, element.end);
    }

    /**
     * Resolves `auto` by reading the source: whichever side of the line break
     * the author already put their commas on is the side they keep.
     */
    private resolveComma(placement: CommaPlacement, start: number, end: number): CommaPlacement {
        if (placement !== 'auto') {
            return placement;
        }
        for (let j = start; j < end; j += 1) {
            if (this.tokens[j].type !== TokenType.Comma) {
                continue;
            }
            if (this.parenBalance(start, j) !== 0) {
                continue;
            }
            if (this.tokens[j].precedingNewlines > 0) {
                return 'toBegin';
            }
            if ((this.tokens[j + 1]?.precedingNewlines ?? 0) > 0) {
                return 'toEnd';
            }
        }
        return 'toEnd';
    }

    /** Whether the author had this element on a line of its own. */
    private elementBreaksInSource(element: Range): boolean {
        if (this.tokens[element.start].precedingNewlines > 0) {
            return true;
        }
        const comma = this.tokens[element.start - 1];
        return comma?.type === TokenType.Comma && comma.precedingNewlines > 0;
    }

    private elementFitsOnCurrentLine(element: Range): boolean {
        return this.rangeFits(element.start, element.end, this.printer.column + 2);
    }

    /** Writes the comma that follows an element, honouring "Place comma". */
    private emitComma(at: number, style: ListStyle, inline: boolean): void {
        const comma = this.tokens[at];
        if (comma?.type !== TokenType.Comma) {
            return;
        }
        if (inline || style.comma !== 'toBegin') {
            this.emit(at);
        }
        // For `inTheMiddle` the comma is written here and never breaks after,
        // so the list simply fills the line.
        // For `toBegin` the comma is written by `breakBeforeElement` instead.
    }

    private breakBeforeElement(element: Range, style: ListStyle, column: number): void {
        this.printer.newline();
        if (style.comma === 'toBegin') {
            // The comma hangs two columns left so the elements still line up.
            this.printer.setIndent(Math.max(0, column - 2));
            const comma = this.tokens[element.start - 1];
            if (comma?.type === TokenType.Comma) {
                this.printer.append(',', false);
                return;
            }
        }
        this.printer.setIndent(column);
    }

    /**
     * `WHERE` / `HAVING` / `ON` bodies break before or after top-level
     * `AND` / `OR` rather than at commas.
     */
    /**
     * Indent for a predicate line that leads with AND / OR. Under river style
     * the operator joins the keyword column, ending where the clause keywords
     * end rather than hanging at the continuation indent.
     */
    private booleanOperatorIndent(at: number, fallback: number): number {
        if (
            this.opts.queries.common.alignFirstWordOfClause !== 'toRight' ||
            this.keywordField === null
        ) {
            return fallback;
        }
        const width = this.renderToken(at).length;
        return Math.max(0, this.statementIndent + this.keywordField - width);
    }

    private layoutPredicate(element: Range, style: ListStyle): void {
        const placement = this.opts.queries.where.placeTopLevelBooleanOperator;
        const parts = this.splitBooleanOperands(element.start, element.end);
        const fits = this.rangeFits(element.start, element.end, this.printer.column + 1);
        const keepTogether =
            style.placement === 'sameLine' ||
            (style.wrap === 'chopIfLong' && fits) ||
            (style.wrap === 'wrapIfLong' && fits) ||
            (style.wrap === 'doNotChange' && !parts.some((part, i) =>
                i > 0 && this.tokens[part.start].precedingNewlines > 0));
        if (parts.length === 1 || keepTogether) {
            this.beginTailAlign(style);
            this.emitRange(element.start, element.end);
            this.endTailAlign();
            return;
        }

        const operandGroup = this.opts.expressions.alignOperandsInBinaryExpressions
            ? this.nextGroup('op')
            : null;
        for (const [index, part] of parts.entries()) {
            this.beginTailAlign(style);
            if (index === 0) {
                this.emitPredicatePart(part.start, part.end, operandGroup);
                this.endTailAlign();
                continue;
            }
            const wanted =
                style.wrap === 'wrapIfLong'
                    ? !this.rangeFits(part.start, part.end, this.printer.column + 2)
                    : style.wrap === 'doNotChange'
                        ? this.tokens[part.start].precedingNewlines > 0
                        : true;
            if (!wanted) {
                this.emitPredicatePart(part.start, part.end, operandGroup);
                this.endTailAlign();
                continue;
            }
            if (placement === 'toEnd') {
                // The operator trails the previous line.
                this.emit(part.start);
                this.printer.newline();
                this.printer.setIndent(style.elementIndent);
                this.emitPredicatePart(part.start + 1, part.end, operandGroup);
                this.endTailAlign();
                continue;
            }
            this.printer.newline();
            this.printer.setIndent(
                this.booleanOperatorIndent(part.start, style.elementIndent),
            );
            this.emitPredicatePart(part.start, part.end, operandGroup);
            this.endTailAlign();
        }
    }

    /** One `a = b` of a broken predicate, with its operator able to align. */
    private emitPredicatePart(start: number, end: number, group: string | null): void {
        if (group === null) {
            this.emitRange(start, end);
            return;
        }
        void 0;
        let i = start;
        let marked = false;
        while (i < end) {
            if (
                !marked &&
                this.tokens[i].type === TokenType.Operator &&
                this.parenBalance(start, i) === 0
            ) {
                this.markAlign(group, true);
                marked = true;
            }
            i = this.step(i, end);
        }
    }

    private listFitsOnOneLine(
        start: number,
        end: number,
        style: ListStyle,
        elementCount: number,
    ): boolean {
        if (style.placement === 'sameLine') {
            return true;
        }
        if (style.wrap === 'doNotChange') {
            // Keep whatever the author wrote, which means breaking wherever
            // they broke rather than fitting the list to the margin.
            return false;
        }
        if (style.wrap === 'chop') {
            const allowance = Math.max(1, this.opts.queries.select.keepElementsOnOneLineIfUpTo);
            if (elementCount > allowance) {
                return false;
            }
        }
        return this.rangeFits(start, end, this.printer.column + 1);
    }

    // ------------------------------------------------------------------
    // Alignment of AS / = / ASC-DESC within an element
    // ------------------------------------------------------------------

    private beginTailAlign(style: ListStyle): void {
        this.tailAlignGroup = style.tailAlignGroup;
        this.tailAlignKind = style.tailAlignKind;
        this.tailAlignUsed = false;
    }

    private endTailAlign(): void {
        this.tailAlignGroup = null;
        this.tailAlignKind = 'none';
        this.tailAlignUsed = false;
    }

    /** Emits a token, inserting the tail alignment mark before its anchor. */
    private emitWithTailAlign(i: number): void {
        if (this.tailAlignGroup !== null && !this.tailAlignUsed && this.isTailAnchor(i)) {
            this.tailAlignUsed = true;
            // The separator has to be written before the mark: padding inserted
            // at the mark cannot push text that already precedes it.
            this.markAlign(this.tailAlignGroup, this.needsSpace(i));
            this.emit(i);
            return;
        }
        this.emit(i);
    }

    private isTailAnchor(i: number): boolean {
        const token = this.tokens[i];
        switch (this.tailAlignKind) {
            case 'as':
                return token.type === TokenType.Word && token.key === 'AS';
            case 'equals':
                return token.type === TokenType.Operator && token.value === '=';
            case 'ascDesc':
                return (
                    token.type === TokenType.Word &&
                    (token.key === 'ASC' || token.key === 'DESC')
                );
            default:
                return false;
        }
    }

    // ------------------------------------------------------------------
    // Splitting
    // ------------------------------------------------------------------

    /** Splits `[start, end)` on top-level commas. */
    private splitElements(start: number, end: number): Range[] {
        const out: Range[] = [];
        let depth = 0;
        let caseDepth = 0;
        let elementStart = start;
        for (let j = start; j < end; j += 1) {
            const token = this.tokens[j];
            if (token.type === TokenType.OpenParen) {
                depth += 1;
            } else if (token.type === TokenType.CloseParen) {
                depth -= 1;
            } else if (token.type === TokenType.Word && token.key === 'CASE') {
                caseDepth += 1;
            } else if (token.type === TokenType.Word && token.key === 'END' && caseDepth > 0) {
                caseDepth -= 1;
            } else if (token.type === TokenType.Comma && depth === 0 && caseDepth === 0) {
                out.push({ start: elementStart, end: j });
                elementStart = j + 1;
            }
        }
        if (elementStart < end) {
            out.push({ start: elementStart, end });
        }
        return out;
    }

    /** Splits a predicate on top-level AND / OR; each part after the first starts at its operator. */
    private splitBooleanOperands(start: number, end: number): Range[] {
        const out: Range[] = [];
        let depth = 0;
        let caseDepth = 0;
        let between = 0;
        let partStart = start;
        for (let j = start; j < end; j += 1) {
            const token = this.tokens[j];
            if (token.type === TokenType.OpenParen) {
                depth += 1;
                continue;
            }
            if (token.type === TokenType.CloseParen) {
                depth -= 1;
                continue;
            }
            if (depth > 0 || token.type !== TokenType.Word) {
                continue;
            }
            if (token.key === 'CASE') {
                caseDepth += 1;
                continue;
            }
            if (token.key === 'END' && caseDepth > 0) {
                caseDepth -= 1;
                continue;
            }
            if (caseDepth > 0) {
                continue;
            }
            if (token.key === 'BETWEEN') {
                between += 1;
                continue;
            }
            if (token.key === 'AND' && between > 0) {
                between -= 1;
                continue;
            }
            if ((token.key === 'AND' || token.key === 'OR') && j > partStart) {
                out.push({ start: partStart, end: j });
                partStart = j;
            }
        }
        out.push({ start: partStart, end });
        return out;
    }

    // ------------------------------------------------------------------
    // Parentheses
    // ------------------------------------------------------------------

    private handleOpenParen(i: number, limit: number): number {
        const close = this.matchParen(i);
        if (close === -1 || close >= limit) {
            this.emit(i);
            return i + 1;
        }

        const section = this.parenSectionFor(i);
        // `chop` means one element per line whatever the width, so such a group
        // breaks even when it would fit.
        // A postfix option list breaks because "wrap first option" says so; for
        // every other group a `chop` wrap is what forces it.
        const chopAlways = section.postfix === true
            ? this.opts.ddl.postfix.wrapFirstOption
            : section.wrap === 'chop' && this.splitElements(i + 1, close).length > 1;
        const forceBreak = chopAlways;
        const collapse = this.opts.queries.common.collapseShortStatements !== 'disabled';

        if (this.inline || (!forceBreak && collapse && this.groupFitsOnLine(i, close))) {
            this.emit(i);
            this.parenSpaces.push(section.style.spacesWithinParentheses);
            this.emitInline(i + 1, close);
            this.emit(close);
            this.parenSpaces.pop();
            return close + 1;
        }

        return this.layoutBrokenParen(i, close, section);
    }

    private layoutBrokenParen(open: number, close: number, section: ParenSection): number {
        const style = section.style;
        const saved = {
            breakIndent: this.breakIndent,
            statementIndent: this.statementIndent,
            clause: this.clause,
            statementKeyword: this.statementKeyword,
            cteStatement: this.cteStatement,
            betweenDepth: this.betweenDepth,
            keywordField: this.keywordField,
            statementHasContent: this.statementHasContent,
            tailAlignGroup: this.tailAlignGroup,
            tailAlignKind: this.tailAlignKind,
        };

        const lineIndent = this.printer.currentLineIndent;
        const openIndent = this.openingParenIndent(style.openingParenthesis, lineIndent);
        if (style.openingParenthesis !== 'sameLine') {
            this.printer.newline();
            this.printer.setIndent(openIndent);
        }
        this.emit(open);

        // `wrappedAligned` and `sameLineAligned` both hang off the column just
        // past the parenthesis, which is only known now that it is written.
        const afterOpen = this.printer.column;
        const contentIndent = this.contentIndent(style.elements, openIndent, afterOpen);
        if (style.elements !== 'sameLineAligned') {
            this.printer.newline();
        }
        this.printer.setIndent(contentIndent);

        this.breakIndent = contentIndent;
        this.statementIndent = contentIndent;
        this.clause = null;
        this.statementKeyword = null;
        this.cteStatement = false;
        this.betweenDepth = 0;
        this.keywordField = null;
        this.statementHasContent = false;
        this.tailAlignGroup = null;
        this.tailAlignKind = 'none';

        this.parenSpaces.push(style.spacesWithinParentheses);
        if (style.elements === 'sameLineAligned') {
            // The contents start beside the parenthesis, so the first clause of
            // a subquery must not take the line break it normally would.
            this.suppressClauseBreak = true;
        }
        this.layoutParenContents(open + 1, close, section, contentIndent);

        if (style.closingParenthesis !== 'atTheEnd') {
            this.printer.newline();
            this.printer.setIndent(
                style.closingParenthesis === 'underElements' ? contentIndent : openIndent,
            );
        }
        this.emit(close);
        this.parenSpaces.pop();

        this.breakIndent = saved.breakIndent;
        this.statementIndent = saved.statementIndent;
        this.clause = saved.clause;
        this.statementKeyword = saved.statementKeyword;
        this.cteStatement = saved.cteStatement;
        this.betweenDepth = saved.betweenDepth;
        this.keywordField = saved.keywordField;
        this.statementHasContent = saved.statementHasContent;
        this.tailAlignGroup = saved.tailAlignGroup;
        this.tailAlignKind = saved.tailAlignKind;
        return close + 1;
    }

    /** A broken parenthesis holds either a subquery or a comma-separated list. */
    private layoutParenContents(
        start: number,
        end: number,
        section: ParenSection,
        contentIndent: number,
    ): void {
        const style = section.style;
        const comma = section.comma;
        if (this.isSubqueryAt(start)) {
            this.emitRange(start, end);
            return;
        }
        if (section.postfix === true) {
            if (!this.opts.ddl.postfix.wrapNextOption) {
                // The list breaks away from the statement but the options
                // themselves stay together on one line.
                this.emitInline(start, end);
                return;
            }
            if (this.opts.ddl.postfix.alignOptions) {
                this.layoutPostfixOptions(start, end, contentIndent, comma);
                return;
            }
        }
        const elements = this.splitElements(start, end);
        if (elements.length <= 1) {
            this.emitRange(start, end);
            return;
        }
        const ddlAlign = this.ddlAlignGroups(style);
        const isDdl = style === this.opts.ddl;
        for (const [index, element] of elements.entries()) {
            if (index > 0) {
                this.printer.newline();
                this.printer.setIndent(contentIndent);
                if (comma === 'toBegin') {
                    this.printer.append(',', false);
                }
            }
            if (isDdl) {
                this.ddlGroupDepth += 1;
                this.emitDdlColumn(element, ddlAlign, contentIndent);
                this.ddlGroupDepth -= 1;
            } else {
                this.emitRange(element.start, element.end);
            }
            if (index < elements.length - 1) {
                // A comment written after the comma annotates the element that
                // just ended, so it stays on that line.
                const next = elements[index + 1];
                if (comma !== 'toBegin') {
                    this.emitTrailingComma(element, comma, contentIndent);
                }
                while (
                    next.start < next.end &&
                    this.tokens[next.start].type === TokenType.LineComment &&
                    this.tokens[next.start].precedingNewlines === 0
                ) {
                    this.emitComment(next.start);
                    next.start += 1;
                }
            }
        }
    }

    /** A DDL option list with its `=` signs lined up. */
    private layoutPostfixOptions(
        start: number,
        end: number,
        contentIndent: number,
        comma: CommaPlacement,
    ): void {
        const group = this.nextGroup('po');
        const elements = this.splitElements(start, end);
        for (const [index, element] of elements.entries()) {
            if (index > 0) {
                this.printer.newline();
                this.printer.setIndent(contentIndent);
                if (comma === 'toBegin') {
                    this.printer.append(',', false);
                }
            }
            let i = element.start;
            while (i < element.end) {
                const token = this.tokens[i];
                if (token.type === TokenType.Operator && token.value === '=') {
                    this.markAlign(group, true);
                }
                i = this.step(i, element.end);
            }
            if (index < elements.length - 1 && comma !== 'toBegin') {
                const next = this.tokens[element.end];
                if (next?.type === TokenType.Comma) {
                    this.emit(element.end);
                }
            }
        }
    }

    /** Writes the comma after a broken group's element. */
    private emitTrailingComma(
        element: Range,
        comma: CommaPlacement,
        contentIndent: number,
    ): void {
        this.emitComma(element.end, {
            placement: 'newLine',
            wrap: 'chop',
            comma,
            elementIndent: contentIndent,
            align: false,
            underHeader: false,
            forceBreak: false,
            tailAlignGroup: null,
            tailAlignKind: 'none',
        }, false);
    }

    /** Alignment groups for DDL column lists, when any DDL align option is on. */
    private ddlAlignGroups(style: ParenStyle): { type: string | null; rest: string | null } | null {
        if (style !== this.opts.ddl) {
            return null;
        }
        const ddl = this.opts.ddl;
        if (!ddl.alignTypes && !ddl.alignDefaults && !ddl.alignNullabilities) {
            return null;
        }
        return {
            type: ddl.alignTypes ? this.nextGroup('dt') : null,
            rest: ddl.alignDefaults || ddl.alignNullabilities ? this.nextGroup('dr') : null,
        };
    }

    /**
     * Emits `name TYPE [DEFAULT ...] [NULL|NOT NULL] [constraints]`, lining the
     * parts up in columns and breaking before the constraint keywords that the
     * DDL settings ask to wrap.
     */
    private emitDdlColumn(
        element: Range,
        groups: { type: string | null; rest: string | null } | null,
        contentIndent: number,
    ): void {
        if (groups === null) {
            this.emitDdlTail(element.start, element.end, contentIndent);
            return;
        }
        let i = this.skipLeadingComments(element.start, element.end);
        // The column or constraint name.
        if (i < element.end) {
            this.emit(i);
            i += 1;
        }
        while (i < element.end && this.tokens[i].type === TokenType.Dot) {
            this.emit(i);
            i += 1;
            if (i < element.end) {
                this.emit(i);
                i += 1;
            }
        }
        if (groups.type !== null && i < element.end) {
            this.markAlign(groups.type, true);
        }
        // The type, including any parenthesised precision.
        while (i < element.end) {
            const token = this.tokens[i];
            const isTail =
                token.type === TokenType.Word &&
                (token.key === 'DEFAULT' || token.key === 'NULL' || token.key === 'NOT');
            if (isTail) {
                break;
            }
            i = this.step(i, element.end);
        }
        if (groups.rest !== null && i < element.end) {
            this.markAlign(groups.rest, true);
        }
        this.emitDdlTail(i, element.end, contentIndent);
    }

    /** Words that the DDL constraint settings can move onto their own line. */
    private ddlWrapPoint(i: number): boolean {
        const cfg = this.opts.ddl.constraints;
        const token = this.tokens[i];
        if (token.type !== TokenType.Word) {
            return false;
        }
        switch (token.key) {
            case 'CONSTRAINT':
                return cfg.wrapConstraint;
            case 'PRIMARY':
            case 'FOREIGN':
            case 'UNIQUE':
            case 'CHECK':
                return cfg.wrapKeyCheck;
            case 'KEY':
                return cfg.wrapKeyCheck && this.tokens[i - 1]?.key !== 'PRIMARY'
                    && this.tokens[i - 1]?.key !== 'FOREIGN';
            case 'REFERENCES':
                return cfg.wrapReferences;
            case 'ON':
                return (
                    cfg.wrapCascadeAndDeferrability &&
                    (this.tokens[i + 1]?.key === 'DELETE' || this.tokens[i + 1]?.key === 'UPDATE')
                );
            case 'DEFERRABLE':
                return cfg.wrapCascadeAndDeferrability;
            default:
                return false;
        }
    }

    private emitDdlTail(start: number, end: number, contentIndent: number): void {
        let i = start;
        while (i < end) {
            // `step` skips over a whole parenthesised group, so the nesting has
            // to be measured rather than counted as we go.
            if (i > start && this.parenBalance(start, i) === 0 && this.ddlWrapPoint(i)) {
                this.printer.newline();
                this.printer.setIndent(contentIndent + this.unit);
            }
            i = this.step(i, end);
        }
    }

    /**
     * Writes any comments that open an element. They cannot go through `emit`,
     * which writes a raw token: a line comment has to end its line or the code
     * after it is commented out.
     */
    private skipLeadingComments(start: number, end: number): number {
        let i = start;
        if (i >= end || !isComment(this.tokens[i])) {
            return i;
        }
        // A comment can be pushed to column one, so the element's own indent
        // has to be put back before it is written.
        const indent = this.printer.currentLineIndent;
        while (i < end && isComment(this.tokens[i])) {
            this.emitComment(i);
            i += 1;
        }
        this.printer.setIndent(indent);
        return i;
    }

    /** Open-parenthesis balance across `[from, to)`. */
    private parenBalance(from: number, to: number): number {
        let depth = 0;
        for (let j = from; j < to; j += 1) {
            const type = this.tokens[j].type;
            if (type === TokenType.OpenParen) {
                depth += 1;
            } else if (type === TokenType.CloseParen) {
                depth -= 1;
            }
        }
        return depth;
    }

    private openingParenIndent(placement: OpeningParen, lineIndent: number): number {
        return placement === 'indented' ? lineIndent + this.unit : lineIndent;
    }

    private contentIndent(
        placement: ParenElements,
        openIndent: number,
        afterOpen: number,
    ): number {
        switch (placement) {
            case 'wrappedUnindented':
                return openIndent;
            case 'wrappedAligned':
            case 'sameLineAligned':
                return afterOpen;
            default:
                return openIndent + this.unit;
        }
    }

    /** Picks the settings section that governs the group opening at `i`. */
    private parenSectionFor(i: number): ParenSection {
        const common = this.opts.queries.common;
        if (this.isSubqueryAt(i + 1)) {
            return { style: this.opts.queries.subquery, comma: common.placeComma, wrap: 'chopIfLong' };
        }
        if (this.inRoutineSignature) {
            const args = this.opts.code.routineArguments;
            return {
                style: args,
                comma: args.placeComma === 'asInCommon' ? common.placeComma : args.placeComma,
                wrap: args.newLineAfterComma ? args.wrapElements : 'doNotChange',
            };
        }
        if (this.statementKeyword !== null && DDL_STATEMENTS.has(this.statementKeyword)) {
            const prev = this.tokens[i - 1];
            if (prev?.type === TokenType.Word && prev.key === 'WITH') {
                // A trailing `WITH (...)` option list, not a column list.
                const postfix = this.opts.ddl.postfix;
                return {
                    style: {
                        openingParenthesis: 'sameLine',
                        elements: postfix.indentOptions ? 'wrappedIndented' : 'wrappedUnindented',
                        closingParenthesis: 'underOpening',
                        spacesWithinParentheses: this.opts.ddl.spacesWithinParentheses,
                    },
                    comma: common.placeComma,
                    wrap: postfix.wrapNextOption ? 'chop' : 'chopIfLong',
                    postfix: true,
                };
            }
            return {
                style: this.opts.ddl,
                comma: common.placeComma,
                wrap: this.opts.ddl.collapseWhenShort ? 'chopIfLong' : 'chop',
            };
        }
        if (this.clause !== null) {
            const head = this.clause.words[0];
            if (head === 'INSERT' || head === 'VALUES' || head === 'INTO') {
                const insert = this.opts.queries.insert;
                return {
                    style: insert,
                    comma: insert.placeComma === 'asInCommon' ? common.placeComma : insert.placeComma,
                    wrap: insert.wrapColumnsOrValues,
                };
            }
        }
        const expr = this.opts.expressions;
        return {
            style: {
                openingParenthesis: 'sameLine',
                elements: 'wrappedIndented',
                closingParenthesis: 'underOpening',
                spacesWithinParentheses: this.isSubExpression(i)
                    ? expr.spaceBetweenParenthesizedSubExpressions
                    : expr.spacesWithinParentheses,
            },
            comma: expr.placeCommaToBegin ? 'toBegin' : common.placeComma,
            wrap: 'chopIfLong',
        };
    }

    /**
     * True for a parenthesis that groups an expression rather than holding a
     * call's arguments or a list: `(a + b) * c`, `WHERE (x = 1 OR y = 2)`.
     */
    private isSubExpression(i: number): boolean {
        const close = this.matchParen(i);
        if (close !== -1 && this.splitElements(i + 1, close).length > 1) {
            return false; // a list, not a single expression
        }
        const prev = this.tokens[i - 1];
        if (prev === undefined) {
            return true;
        }
        if (prev.type === TokenType.QuotedIdentifier || prev.type === TokenType.Variable) {
            return false;
        }
        if (prev.type !== TokenType.Word) {
            return true;
        }
        // A known function or type name, or any bare word written tight against
        // the parenthesis, is a call rather than a grouping.
        if (this.dialect.functions.has(prev.key) || this.dialect.dataTypes.has(prev.key)) {
            return false;
        }
        return this.dialect.keywords.has(prev.key);
    }

    private isSubqueryAt(i: number): boolean {
        const token = this.tokens[i];
        return (
            token?.type === TokenType.Word &&
            (token.key === 'SELECT' || token.key === 'WITH')
        );
    }

    // ------------------------------------------------------------------
    // CASE
    // ------------------------------------------------------------------

    private layoutCase(i: number, limit: number): number {
        const cfg = this.opts.expressions.caseClause;
        const end = this.matchCaseEnd(i);
        if (end === -1 || end >= limit) {
            this.emit(i);
            return i + 1;
        }
        if (cfg.collapseShortClause && this.groupFitsOnLine(i, end)) {
            for (let j = i; j <= end; j += 1) {
                this.emit(j);
            }
            return end + 1;
        }

        const anchor = this.printer.currentLineIndent;
        this.emit(i);
        const branchIndent = cfg.indentWhenIfWrapped ? anchor + this.unit : anchor;
        const thenGroup = cfg.alignThen ? this.nextGroup('t') : null;

        let j = i + 1;
        while (j < end) {
            const token = this.tokens[j];
            if (token.type === TokenType.Word && token.key === 'WHEN' && cfg.wrapWhen) {
                this.printer.newline();
                this.printer.setIndent(branchIndent);
            } else if (token.type === TokenType.Word && token.key === 'ELSE') {
                this.printer.newline();
                this.printer.setIndent(
                    cfg.alignElseUnderThenWhenThenAligned && thenGroup !== null
                        ? branchIndent + this.unit
                        : branchIndent,
                );
            } else if (token.type === TokenType.Word && token.key === 'THEN') {
                if (cfg.wrapThen) {
                    this.printer.newline();
                    this.printer.setIndent(branchIndent + this.unit);
                } else if (thenGroup !== null) {
                    this.markAlign(thenGroup, true);
                }
            }
            if (
                token.type === TokenType.Word &&
                (token.key === 'WHEN' || token.key === 'ELSE' || token.key === 'THEN')
            ) {
                this.emit(j);
                j += 1;
                const next = this.tokens[j];
                if (
                    cfg.keepNewLineAfterThenElse &&
                    token.key !== 'WHEN' &&
                    next !== undefined &&
                    next.precedingNewlines > 0
                ) {
                    this.printer.newline();
                    this.printer.setIndent(branchIndent + this.unit);
                }
                continue;
            }
            j = this.step(j, end);
        }

        if (cfg.alignEnd !== 'lineEnd') {
            this.printer.newline();
            this.printer.setIndent(cfg.alignEnd === 'withWhen' ? branchIndent : anchor);
        }
        this.emit(end);
        return end + 1;
    }

    // ------------------------------------------------------------------
    // Statements, blocks and batches
    // ------------------------------------------------------------------

    private startsStatementAt(i: number): boolean {
        const prev = this.tokens[i - 1];
        if (this.cteStatement && prev?.type === TokenType.CloseParen) {
            return false;
        }
        if (
            this.tokens[i].key === 'SET' &&
            (this.statementKeyword === 'UPDATE' || this.statementKeyword === 'MERGE')
        ) {
            return false;
        }
        if (i === this.forceStatementAt) {
            this.forceStatementAt = -1;
            return true;
        }
        return startsNewStatement(this.tokens, i, prev, this.statementHasContent);
    }

    private findConditionEnd(start: number): number {
        let depth = 0;
        for (let j = start; j < this.tokens.length; j += 1) {
            const token = this.tokens[j];
            if (token.type === TokenType.OpenParen) {
                depth += 1;
                continue;
            }
            if (token.type === TokenType.CloseParen) {
                if (depth === 0) {
                    return -1;
                }
                depth -= 1;
                continue;
            }
            if (depth > 0) {
                continue;
            }
            if (token.type === TokenType.Semicolon || token.type === TokenType.BatchSeparator) {
                return -1;
            }
            if (token.type !== TokenType.Word) {
                continue;
            }
            if (token.key === 'BEGIN' || token.key === 'END') {
                return -1;
            }
            if (STATEMENT_STARTERS.has(token.key)) {
                return j;
            }
        }
        return -1;
    }

    /**
     * Blank lines between two DDL declarations, held inside the range the
     * Schema settings allow rather than simply echoing the source.
     */
    private spaceDeclarations(token: Token): void {
        const cfg = this.opts.ddl.schema;
        const authored = Math.max(0, token.precedingNewlines - 1);
        const floor = Math.max(0, cfg.minBlankLinesBetweenDeclarations);
        const ceiling = Math.max(floor, cfg.maxBlankLinesBetweenDeclarations);
        const wanted = Math.min(Math.max(floor, authored), ceiling);
        if (wanted > 0) {
            this.printer.requestBlankLines(wanted);
        }
    }

    private beginStatement(): void {
        if (this.pendingBody) {
            this.pendingBody = false;
            this.singleStatementIndents.push(this.statementIndent);
            this.statementIndent += this.unit;
        }
        this.breakIndent = this.statementIndent + this.unit;
        this.keywordField = null;
        this.printer.setIndent(this.statementIndent + this.schemaIndent);
    }

    private endStatement(drainBodies: boolean, keepLine = false): void {
        if (!keepLine && !this.inline && this.opts.code.statements.wrapEveryStatement) {
            this.printer.newline();
        }
        this.clause = null;
        this.statementHasContent = false;
        this.betweenDepth = 0;
        this.cteStatement = false;
        this.previousWasDeclaration =
            this.statementKeyword !== null && DDL_STATEMENTS.has(this.statementKeyword);
        this.statementKeyword = null;
        this.keywordField = null;
        this.joinSeen = false;
        this.inViewStatement = false;
        this.inRoutineSignature = false;
        this.suppressClauseBreak = false;
        this.fromJoinOnly = false;
        this.joinTableGroup = null;
        this.joinAliasGroup = null;
        this.endTailAlign();
        if (this.mergeWhenIndent !== null) {
            this.statementIndent = this.mergeWhenIndent;
            this.mergeWhenIndent = null;
        }
        if (!this.pendingBody && this.singleStatementIndents.length > 0) {
            if (drainBodies) {
                this.statementIndent = this.singleStatementIndents[0];
                this.singleStatementIndents.length = 0;
            } else {
                this.statementIndent = this.singleStatementIndents.pop() as number;
            }
        }
        this.breakIndent = this.statementIndent + this.unit;
        this.printer.setIndent(this.statementIndent);
    }

    private emitSemicolon(i: number): void {
        this.schemaIndent = 0;
        if (this.opts.code.statements.newLineAroundSemicolon && this.statementHasContent) {
            this.printer.newline();
            this.printer.setIndent(this.statementIndent);
        }
        this.emit(i);
        this.endStatement(true);
    }

    /**
     * Keeps short, clause-free statements on one line. Returns the index just
     * past the statement, or `i` when it was not collapsed.
     */
    private tryCollapseStatement(i: number, limit: number): number {
        // Only `enabled` joins a whole statement; `subqueriesOnly` leaves
        // statements alone and collapses parenthesised groups only.
        if (this.opts.queries.common.collapseShortStatements !== 'enabled') {
            return i;
        }
        const key = this.tokens[i].key;
        if (key === 'IF' || key === 'WHILE' || key === 'ELSE') {
            return i;
        }
        // Inside a parenthesised group there is no statement to collapse; the
        // tokens belong to an element whose layout is already decided.
        if (this.parenSpaces.length > 0) {
            return i;
        }
        // A DDL statement told not to collapse must not be collapsed whole.
        if (DDL_STATEMENTS.has(key) && !this.opts.ddl.collapseWhenShort) {
            return i;
        }
        // Never run past the range being written: inside a list element the
        // tokens after it belong to the next element, not to this statement.
        const end = Math.min(this.findStatementEnd(i), limit);
        if (end <= i + 1) {
            return i;
        }
        // `subqueriesOnly` leaves anything with clause structure alone;
        // `enabled` collapses it too when it fits.
        if (this.opts.queries.common.collapseShortStatements !== 'enabled') {
            for (let j = i; j < end; j += 1) {
                if (this.tokens[j].type === TokenType.Word && matchClause(this.tokens, j) !== null) {
                    return i;
                }
            }
        }
        if (!this.rangeFits(i, end, this.printer.column)) {
            return i;
        }
        // Emit the head directly: re-entering `step` here would look at the same
        // token again and recurse.
        this.emit(i);
        this.emitInline(i + 1, end);
        return end;
    }

    private findStatementEnd(start: number): number {
        let depth = 0;
        for (let j = start; j < this.tokens.length; j += 1) {
            const token = this.tokens[j];
            if (token.type === TokenType.OpenParen) {
                depth += 1;
                continue;
            }
            if (token.type === TokenType.CloseParen) {
                if (depth === 0) {
                    return j; // this closes the group we are inside
                }
                depth -= 1;
                continue;
            }
            if (depth > 0) {
                continue;
            }
            if (token.type === TokenType.Semicolon || token.type === TokenType.BatchSeparator) {
                return j;
            }
            if (token.type === TokenType.Word) {
                if (
                    token.key === 'BEGIN' ||
                    token.key === 'END' ||
                    token.key === 'CASE' ||
                    token.key === 'ELSE'
                ) {
                    return j;
                }
                if (j > start && startsNewStatement(this.tokens, j, this.tokens[j - 1], true)) {
                    return j;
                }
            }
        }
        return this.tokens.length;
    }

    private emitBatchSeparator(i: number): void {
        this.endStatement(true);
        this.statementIndent = 0;
        this.frames.length = 0;
        this.singleStatementIndents.length = 0;
        this.printer.setIndent(0);
        this.emit(i);
        this.printer.newline();
        this.breakIndent = this.unit;
    }

    private emitElse(i: number): number {
        const wrap = this.opts.code.block.wrapElse;
        this.endStatement(true, !wrap);
        if (wrap) {
            this.breakLine(
                this.opts.code.block.indentThenAndElse
                    ? this.statementIndent + this.unit
                    : this.statementIndent,
                this.tokens[i],
            );
        }
        this.emit(i);
        this.pendingBody = true;
        this.forceStatementAt = i + 1;
        return i + 1;
    }

    private isBlockBegin(i: number): boolean {
        const next = this.tokens[i + 1];
        if (next === undefined || next.type !== TokenType.Word) {
            return true;
        }
        return !NON_BLOCK_BEGIN.has(next.key);
    }

    private openBlock(i: number): number {
        if (this.opts.code.block.collapseWhenShort) {
            const end = this.matchBlockEnd(i);
            if (end !== -1 && this.groupFitsOnLine(i, end)) {
                this.endStatement(true);
                this.breakLine(this.statementIndent, this.tokens[i]);
                this.emit(i);
                this.emitInline(i + 1, end + 1);
                this.statementHasContent = true;
                return end + 1;
            }
        }
        this.endStatement(true);
        const prev = this.tokens[i - 1];
        if (prev?.type === TokenType.Word && BLOCK_QUALIFIERS.has(prev.key)) {
            this.printer.clearPendingBlankLines();
        }
        this.pendingBody = false;
        this.breakLine(this.statementIndent, this.tokens[i]);
        this.emit(i);
        let next = i + 1;
        const qualifier = this.tokens[next];
        if (qualifier?.type === TokenType.Word && BLOCK_QUALIFIERS.has(qualifier.key)) {
            this.emit(next);
            next += 1;
        }
        this.frames.push({
            statementIndent: this.statementIndent,
            statementKeyword: this.statementKeyword,
        });
        if (this.opts.code.block.wrapInnerCode) {
            this.statementIndent += this.unit;
        }
        this.breakIndent = this.statementIndent + this.unit;
        this.printer.newline();
        this.printer.setIndent(this.statementIndent);
        this.statementHasContent = false;
        this.statementKeyword = null;
        return next;
    }

    private closeBlock(i: number): number {
        this.endStatement(true);
        this.printer.clearPendingBlankLines();
        const frame = this.frames.pop() as Frame;
        this.statementIndent = this.opts.code.block.indentEnd
            ? frame.statementIndent + this.unit
            : frame.statementIndent;
        this.printer.newline();
        this.printer.setIndent(this.statementIndent);
        this.emit(i);
        let next = i + 1;
        const qualifier = this.tokens[next];
        if (qualifier?.type === TokenType.Word && BLOCK_QUALIFIERS.has(qualifier.key)) {
            this.emit(next);
            next += 1;
        }
        this.statementIndent = frame.statementIndent;
        this.statementKeyword = frame.statementKeyword;
        this.breakIndent = this.statementIndent + this.unit;
        this.statementHasContent = true;
        return next;
    }

    // ------------------------------------------------------------------
    // Comments
    // ------------------------------------------------------------------

    private emitComment(i: number): void {
        const token = this.tokens[i];
        const ownLine = token.precedingNewlines > 0;
        if (ownLine) {
            const indent =
                this.opts.wrapping.commentAtFirstColumn && token.atLineStart
                    ? 0
                    : this.printer.currentLineIndent;
            this.breakLine(indent, token);
        }
        if (
            !ownLine &&
            this.commentAlignGroup !== null &&
            token.type === TokenType.LineComment
        ) {
            this.markAlign(this.commentAlignGroup, true);
        }
        this.printer.append(
            this.commentText(token, this.printer.currentLineIndent),
            !this.printer.isLineEmpty,
        );
        // A line comment always ends its line -- anything appended after it
        // would be commented out. The same goes for a block comment that
        // already spans lines.
        if (token.type === TokenType.LineComment || token.value.includes('\n')) {
            this.printer.newline();
        }
        this.statementHasContent = this.statementHasContent || !ownLine;
    }

    private commentText(token: Token, indentLevel: number): string {
        if (token.type !== TokenType.BlockComment || !token.value.includes('\n')) {
            return token.value;
        }
        const rawLines = token.value.split(/\r?\n/u);
        const rest = rawLines.slice(1);
        let common = Infinity;
        for (const line of rest) {
            if (line.trim().length === 0) {
                continue;
            }
            common = Math.min(common, line.length - line.trimStart().length);
        }
        if (!Number.isFinite(common)) {
            common = 0;
        }
        const unit = this.opts.indents.useTabCharacter
            ? '\t'
            : ' '.repeat(Math.max(1, this.opts.indents.indent));
        const pad = unit.repeat(Math.max(0, indentLevel));
        const out = [rawLines[0]];
        for (const line of rest) {
            out.push(line.trim().length === 0 ? '' : pad + line.slice(common).trimEnd());
        }
        return out.join(this.opts.newline);
    }

    // ------------------------------------------------------------------
    // Emitting and measuring
    // ------------------------------------------------------------------

    private emit(i: number): void {
        const token = this.tokens[i];
        this.keepAuthorBlankLine(token);
        if (!this.statementHasContent && token.type === TokenType.Word) {
            this.statementKeyword = token.key;
            if (token.key === 'CREATE' && this.tokens[i + 1]?.key === 'SCHEMA') {
                // Declarations written inside a CREATE SCHEMA are its contents.
                this.schemaIndent = this.opts.ddl.schema.indentContent ? this.unit : 0;
            }
        }
        const space = this.suppressSpace ? false : this.needsSpace(i);
        this.suppressSpace = false;
        this.printer.append(this.renderToken(i), space);
        this.statementHasContent = true;
        if (token.type === TokenType.Word && token.key === 'WITH' && !this.cteStatement) {
            this.cteStatement = this.isCteWith(i);
        }
    }

    /** Honours Code > "Keep blank lines in code" when a token opens a line. */
    private keepAuthorBlankLine(token: Token): void {
        if (!this.printer.isLineEmpty) {
            return;
        }
        // Two DDL declarations in a row are spaced by the Schema settings,
        // which can force a gap the author did not leave.
        if (
            !this.statementHasContent &&
            this.previousWasDeclaration &&
            token.type === TokenType.Word &&
            DDL_STATEMENTS.has(token.key)
        ) {
            this.spaceDeclarations(token);
            return;
        }
        if (!this.opts.wrapping.keepLineBreaks) {
            return;
        }
        const allowed = this.opts.code.statements.keepBlankLinesInCode;
        if (allowed > 0 && token.precedingNewlines > 1) {
            this.printer.requestBlankLines(Math.min(allowed, token.precedingNewlines - 1));
        }
    }

    private isCteWith(i: number): boolean {
        const name = this.tokens[i + 1];
        if (name === undefined) {
            return false;
        }
        if (name.type !== TokenType.Word && name.type !== TokenType.QuotedIdentifier) {
            return false;
        }
        const after = this.tokens[i + 2];
        if (after === undefined) {
            return false;
        }
        return (
            (after.type === TokenType.Word && after.key === 'AS') ||
            after.type === TokenType.OpenParen
        );
    }

    private breakLine(indent: number, token: Token): void {
        this.printer.newline();
        this.keepAuthorBlankLine(token);
        this.printer.setIndent(indent);
    }

    private rangeFits(from: number, to: number, startColumn: number): boolean {
        const flat = this.renderRange(from, to);
        return flat !== null && startColumn + flat.length <= this.opts.wrapping.rightMargin;
    }

    private groupFitsOnLine(start: number, groupEnd: number): boolean {
        const tail = this.nextBreakOpportunity(groupEnd + 1);
        const flat = this.renderRange(start, tail);
        if (flat === null) {
            return false;
        }
        const space = this.needsSpace(start) ? 1 : 0;
        return this.printer.column + space + flat.length <= this.opts.wrapping.rightMargin;
    }

    private nextBreakOpportunity(from: number): number {
        let depth = 0;
        for (let j = from; j < this.tokens.length; j += 1) {
            const token = this.tokens[j];
            if (token.type === TokenType.OpenParen) {
                depth += 1;
                continue;
            }
            if (token.type === TokenType.CloseParen) {
                if (depth === 0) {
                    return j;
                }
                depth -= 1;
                continue;
            }
            if (depth > 0) {
                continue;
            }
            if (
                token.type === TokenType.Comma ||
                token.type === TokenType.Semicolon ||
                token.type === TokenType.BatchSeparator ||
                token.type === TokenType.LineComment
            ) {
                return j;
            }
            if (token.type !== TokenType.Word) {
                continue;
            }
            if (token.key === 'END' || token.key === 'AND' || token.key === 'OR') {
                return j;
            }
            if (matchClause(this.tokens, j) !== null) {
                return j;
            }
            if (startsNewStatement(this.tokens, j, this.tokens[j - 1], true)) {
                return j;
            }
        }
        return this.tokens.length;
    }

    private renderRange(from: number, to: number): string | null {
        let out = '';
        for (let i = from; i < to; i += 1) {
            const token = this.tokens[i];
            if (token.type === TokenType.LineComment && i !== to - 1) {
                return null;
            }
            if (token.type === TokenType.BlockComment && token.value.includes('\n')) {
                return null;
            }
            if (i > from && this.needsSpace(i)) {
                out += ' ';
            }
            out += this.renderToken(i);
            if (out.length > this.opts.wrapping.rightMargin) {
                return out;
            }
        }
        return out;
    }

    private findClauseEnd(start: number): number {
        let depth = 0;
        let caseDepth = 0;
        for (let j = start; j < this.tokens.length; j += 1) {
            const token = this.tokens[j];
            if (token.type === TokenType.OpenParen) {
                depth += 1;
                continue;
            }
            if (token.type === TokenType.CloseParen) {
                if (depth === 0) {
                    return j;
                }
                depth -= 1;
                continue;
            }
            if (depth > 0) {
                continue;
            }
            if (token.type === TokenType.Semicolon || token.type === TokenType.BatchSeparator) {
                return j;
            }
            if (token.type !== TokenType.Word) {
                continue;
            }
            if (token.key === 'CASE') {
                caseDepth += 1;
                continue;
            }
            if (token.key === 'END') {
                if (caseDepth === 0) {
                    return j;
                }
                caseDepth -= 1;
                continue;
            }
            if (caseDepth > 0) {
                continue;
            }
            if (token.key === 'BEGIN' || token.key === 'ELSE') {
                return j;
            }
            if (matchClause(this.tokens, j) !== null) {
                return j;
            }
            if (startsNewStatement(this.tokens, j, this.tokens[j - 1], true)) {
                return j;
            }
        }
        return this.tokens.length;
    }

    // ------------------------------------------------------------------
    // Rendering one token
    // ------------------------------------------------------------------

    private renderToken(i: number): string {
        const token = this.tokens[i];
        if (token.type === TokenType.Word) {
            return this.renderWord(i);
        }
        if (token.type === TokenType.BatchSeparator) {
            return this.applyCase(token.value, this.opts.case.keyword);
        }
        if (token.type === TokenType.String) {
            return this.renderString(token);
        }
        return token.value;
    }

    private renderWord(i: number): string {
        const token = this.tokens[i];
        const key = token.key;
        const cases = this.opts.case;

        // A call is a call even when schema-qualified, so this is checked
        // before the "word after a dot is an identifier" rule.
        if (this.nextSignificant(i)?.type === TokenType.OpenParen) {
            if (this.dialect.functions.has(key)) {
                return this.applyCase(token.value, cases.builtInFunction);
            }
            if (!this.dialect.keywords.has(key) && !this.dialect.dataTypes.has(key)) {
                return this.applyCase(token.value, cases.customFunction);
            }
        }
        if (this.tokens[i - 1]?.type === TokenType.Dot) {
            return this.applyCase(token.value, cases.identifier);
        }
        if (this.isAlias(i)) {
            return this.applyCase(token.value, cases.alias);
        }
        if (this.dialect.keywords.has(key)) {
            return this.applyCase(token.value, cases.keyword);
        }
        if (this.dialect.dataTypes.has(key)) {
            return this.applyCase(token.value, cases.builtInType);
        }
        if (this.dialect.functions.has(key)) {
            return this.applyCase(token.value, cases.builtInFunction);
        }
        return this.applyCase(token.value, cases.identifier);
    }

    /** A word directly after `AS` is an alias. */
    private isAlias(i: number): boolean {
        const prev = this.tokens[i - 1];
        if (prev?.type !== TokenType.Word || prev.key !== 'AS') {
            return false;
        }
        const key = this.tokens[i].key;
        return !this.dialect.keywords.has(key) && !this.dialect.dataTypes.has(key);
    }

    private renderString(token: Token): string {
        const quote = token.value.indexOf("'");
        if (quote <= 0) {
            return token.value;
        }
        const prefix = token.value.slice(0, quote);
        if (!/^[A-Za-z]&?$/u.test(prefix)) {
            return token.value;
        }
        return this.applyCase(prefix, this.opts.case.keyword) + token.value.slice(quote);
    }

    private applyCase(value: string, style: CaseStyle): string {
        if (style === 'upper') {
            return value.toUpperCase();
        }
        if (style === 'lower') {
            return value.toLowerCase();
        }
        return value;
    }

    // ------------------------------------------------------------------
    // Spacing
    // ------------------------------------------------------------------

    private needsSpace(i: number): boolean {
        const expr = this.opts.expressions;
        const cur = this.tokens[i];
        const prev = this.tokens[i - 1];
        if (prev === undefined) {
            return false;
        }
        if (cur.type === TokenType.Dot || prev.type === TokenType.Dot) {
            return false;
        }
        if (cur.type === TokenType.Comma) {
            return expr.spaceBeforeComma;
        }
        if (prev.type === TokenType.Comma) {
            return expr.spaceAfterComma;
        }
        if (cur.type === TokenType.Semicolon) {
            return false;
        }
        if (cur.type === TokenType.CloseParen || prev.type === TokenType.OpenParen) {
            return this.parenSpaces.length > 0
                ? this.parenSpaces[this.parenSpaces.length - 1]
                : expr.spacesWithinParentheses;
        }
        if (cur.type === TokenType.Operator && cur.value === '::') {
            return false;
        }
        if (prev.type === TokenType.Operator) {
            if (prev.value === '::') {
                return false;
            }
            if (this.isUnary(i - 1)) {
                return false;
            }
            return expr.spacesAroundOperators;
        }
        if (cur.type === TokenType.Operator && !this.isUnary(i)) {
            return expr.spacesAroundOperators;
        }
        if (cur.type === TokenType.OpenParen) {
            return this.spaceBeforeOpenParen(prev, cur);
        }
        return true;
    }

    private isUnary(i: number): boolean {
        const token = this.tokens[i];
        if (token.type !== TokenType.Operator || !UNARY_OPERATORS.has(token.value)) {
            return false;
        }
        const prev = this.tokens[i - 1];
        if (prev === undefined) {
            return true;
        }
        switch (prev.type) {
            case TokenType.Operator:
            case TokenType.OpenParen:
            case TokenType.Comma:
            case TokenType.Semicolon:
                return true;
            case TokenType.Word:
                return this.dialect.keywords.has(prev.key) && !BOOLEAN_LITERAL_KEYS.has(prev.key);
            default:
                return false;
        }
    }

    private spaceBeforeOpenParen(prev: Token, cur: Token): boolean {
        if (prev.type === TokenType.Word) {
            if (this.dialect.functions.has(prev.key) || this.dialect.dataTypes.has(prev.key)) {
                return this.opts.expressions.spaceBeforeOpeningParenthesis;
            }
            if (this.dialect.keywords.has(prev.key)) {
                return true;
            }
            // Unknown word: honour the source so `t (NOLOCK)` keeps its space
            // while `MySchema.MyFunc(@x)` stays a call.
            return cur.precedingWhitespace || this.opts.expressions.spaceBeforeOpeningParenthesis;
        }
        if (prev.type === TokenType.QuotedIdentifier || prev.type === TokenType.Variable) {
            return cur.precedingWhitespace;
        }
        return true;
    }

    // ------------------------------------------------------------------
    // Token helpers
    // ------------------------------------------------------------------

    private nextSignificant(i: number): Token | undefined {
        for (let j = i + 1; j < this.tokens.length; j += 1) {
            const type = this.tokens[j].type;
            if (type !== TokenType.LineComment && type !== TokenType.BlockComment) {
                return this.tokens[j];
            }
        }
        return undefined;
    }

    private matchParen(i: number): number {
        let depth = 0;
        for (let j = i; j < this.tokens.length; j += 1) {
            const type = this.tokens[j].type;
            if (type === TokenType.OpenParen) {
                depth += 1;
            } else if (type === TokenType.CloseParen) {
                depth -= 1;
                if (depth === 0) {
                    return j;
                }
            }
        }
        return -1;
    }

    /** Index of the `END` that closes the `BEGIN` at `i`. */
    private matchBlockEnd(i: number): number {
        let depth = 0;
        for (let j = i; j < this.tokens.length; j += 1) {
            const token = this.tokens[j];
            if (token.type !== TokenType.Word) {
                continue;
            }
            if (token.key === 'BEGIN' && this.isBlockBegin(j)) {
                depth += 1;
            } else if (token.key === 'END') {
                depth -= 1;
                if (depth === 0) {
                    return j;
                }
            }
        }
        return -1;
    }

    private matchCaseEnd(i: number): number {
        let depth = 0;
        for (let j = i; j < this.tokens.length; j += 1) {
            const token = this.tokens[j];
            if (token.type !== TokenType.Word) {
                continue;
            }
            if (token.key === 'CASE') {
                depth += 1;
            } else if (token.key === 'END') {
                depth -= 1;
                if (depth === 0) {
                    return j;
                }
            }
        }
        return -1;
    }
}
