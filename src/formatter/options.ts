import type { DialectName } from './dialects';

/**
 * The style model.
 *
 * Settings are organised into sections -- Case, Tabs and Indents, Wrapping,
 * Queries, Expressions, Code, DDL -- and within them are built from a small set
 * of repeating primitives, so the same vocabulary describes a SELECT list, a
 * routine's argument list and a CREATE TABLE column list alike.
 */

// ---------------------------------------------------------------------------
// Primitives, shared by every tab
// ---------------------------------------------------------------------------

/** Casing applied to one kind of word. */
export type CaseStyle = 'upper' | 'lower' | 'preserve';

/** Whether a section's elements move onto their own lines. */
export type Placement = 'newLine' | 'sameLine' | 'asInCommon';

/** The same choice in Queries > Common, which has nothing to inherit from. */
export type CommonPlacement = 'newLine' | 'sameLine';

/** The comma choice in Queries > Common, which has nothing to inherit from. */
export type CommonComma = 'toBegin' | 'toEnd' | 'auto';

/**
 * How a list of elements is broken across lines.
 *  - `chop`        one element per line, always
 *  - `chopIfLong`  one element per line, but only once the list exceeds the margin
 *  - `wrapIfLong`  fill each line up to the margin, then continue on the next
 *  - `doNotChange` leave the author's line breaks alone
 */
export type WrapMode = 'chop' | 'chopIfLong' | 'wrapIfLong' | 'doNotChange';

/**
 * Where the separating comma sits.
 *  - `toEnd`   trails the element it follows
 *  - `toBegin` leads the element it precedes, hanging left of the column
 *  - `auto`    whichever of those the source already used
 *  - `inTheMiddle` not a break point at all: the list fills the line and the
 *                  comma lands wherever it falls
 *  - `asInCommon` inherits Queries > Common
 */
export type CommaPlacement = 'toBegin' | 'toEnd' | 'auto' | 'inTheMiddle' | 'asInCommon';

/** Where a group's opening parenthesis sits. */
export type OpeningParen = 'sameLine' | 'indented' | 'aligned';

/**
 * Where the contents of a parenthesised group sit relative to the parenthesis.
 *  - `sameLineAligned`   first element beside `(`, the rest under it
 *  - `wrappedUnindented` next line, level with the line holding `(`
 *  - `wrappedAligned`    next line, under the column just after `(`
 *  - `wrappedIndented`   next line, one indent in from the line holding `(`
 */
export type ParenElements =
    | 'sameLineAligned'
    | 'wrappedUnindented'
    | 'wrappedAligned'
    | 'wrappedIndented';

/**
 * Where a group's closing parenthesis sits.
 *  - `atTheEnd`       trailing the last element
 *  - `underOpening`   own line, level with the line holding `(`
 *  - `underElements`  own line, level with the elements
 */
export type ClosingParen = 'atTheEnd' | 'underOpening' | 'underElements';

/** How clause keywords line up against one another. */
export type ClauseAlignment = 'toLeft' | 'toLeftWithIndent' | 'toRight';

/**
 * How eagerly short constructs are joined onto one line.
 *  - `enabled`        whole statements and parenthesised groups
 *  - `subqueriesOnly` groups only; a statement always keeps its clause layout
 *  - `disabled`       neither
 */
export type CollapseMode = 'enabled' | 'subqueriesOnly' | 'disabled';

/**
 * What the `END` of a CASE lines up with.
 *  - `withCase` own line, level with the line holding `CASE`
 *  - `withWhen` own line, level with the `WHEN` branches
 *  - `lineEnd`  trailing the last branch instead of taking its own line
 */
export type EndAlignment = 'withCase' | 'withWhen' | 'lineEnd';

/** What a JOIN lines up under when the FROM holds only joins. */
export type JoinAnchor = 'table' | 'fromIndented' | 'from';

/** What `ON` and `USING` line up under. */
export type OnUsingAnchor = 'table' | 'tableIndented';

/** Whether a broken predicate leads or trails its AND / OR. */
export type BooleanOperatorPlacement = 'toBegin' | 'toEnd';

/** A parenthesised group's three placement settings, used by several tabs. */
export interface ParenStyle {
    openingParenthesis: OpeningParen;
    elements: ParenElements;
    closingParenthesis: ClosingParen;
    spacesWithinParentheses: boolean;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

/** Case section: one entry per kind of word. */
export interface CaseOptions {
    keyword: CaseStyle;
    builtInType: CaseStyle;
    builtInFunction: CaseStyle;
    customFunction: CaseStyle;
    identifier: CaseStyle;
    alias: CaseStyle;
}

/** Tabs and Indents section. */
export interface IndentOptions {
    /** Take tab width and tabs-vs-spaces from the editor instead of these values. */
    useEditorIndentation: boolean;
    useTabCharacter: boolean;
    smartTabs: boolean;
    tabSize: number;
    indent: number;
    continuationIndent: number;
    keepIndentsOnEmptyLines: boolean;
}

/** Wrapping section, plus the right margin everything wraps against. */
export interface WrappingOptions {
    rightMargin: number;
    keepLineBreaks: boolean;
    commentAtFirstColumn: boolean;
}

/** Queries > Common: the defaults every clause inherits. */
export interface CommonQueryOptions {
    alignFirstWordOfClause: ClauseAlignment;
    placeClauseElementsOn: CommonPlacement;
    placeComma: CommonComma;
    collapseShortStatements: CollapseMode;
    keepElementsUnderSectionHeader: boolean;
    alignSectionElements: boolean;
    alignLineCommentsAtRightOfElements: boolean;
}

export interface SelectOptions {
    placeElementsOn: Placement;
    wrapElements: WrapMode;
    placeComma: CommaPlacement;
    newLineAfterAllDistinct: boolean;
    keepElementsOnOneLineIfUpTo: number;
    useAs: boolean;
    alignAs: boolean;
}

export interface FromOptions {
    placeElementsOn: Placement;
    wrapElements: WrapMode;
    placeComma: CommaPlacement;
    wrapFirstJoin: boolean;
    wrapNextJoin: boolean;
    indentJoin: boolean;
    placeJoinInJoinOnlyQueriesUnder: JoinAnchor;
    alignJoinedTables: boolean;
    alignTableAliases: boolean;
    wrapOnUsing: boolean;
    placeOnUsingUnder: OnUsingAnchor;
}

export interface WhereOptions {
    placeElementsOn: Placement;
    wrapElements: WrapMode;
    placeTopLevelBooleanOperator: BooleanOperatorPlacement;
    alignAs: boolean;
}

/** GROUP BY and ORDER BY share one section. */
export interface OrderGroupByOptions {
    placeElementsOn: Placement;
    wrapElements: WrapMode;
    placeComma: CommaPlacement;
    alignAscDesc: boolean;
}

export interface InsertOptions extends ParenStyle {
    placeIntoOnNewLine: boolean;
    placeIntoClauseElementsOn: Placement;
    placeValuesRowsOn: Placement;
    wrapColumnsOrValues: WrapMode;
    placeComma: CommaPlacement;
    collapseShortMultiRowValues: boolean;
    alignMultiRowValues: boolean;
}

export interface UpdateOptions {
    placeElementsOn: Placement;
    wrapElements: WrapMode;
    placeComma: CommaPlacement;
    alignEqualSign: boolean;
}

export interface WithOptions {
    placeElementsOn: Placement;
    wrapSubqueries: WrapMode;
    placeComma: CommaPlacement;
    alignAs: boolean;
}

export interface QueryOptions {
    common: CommonQueryOptions;
    select: SelectOptions;
    from: FromOptions;
    where: WhereOptions;
    orderGroupBy: OrderGroupByOptions;
    insert: InsertOptions;
    update: UpdateOptions;
    with: WithOptions;
    subquery: ParenStyle;
}

export interface CaseClauseOptions {
    wrapWhen: boolean;
    indentWhenIfWrapped: boolean;
    wrapThen: boolean;
    alignThen: boolean;
    alignElseUnderThenWhenThenAligned: boolean;
    alignEnd: EndAlignment;
    keepNewLineAfterThenElse: boolean;
    collapseShortClause: boolean;
}

/** Expressions section. */
export interface ExpressionOptions {
    spaceBeforeOpeningParenthesis: boolean;
    spacesWithinParentheses: boolean;
    placeCommaToBegin: boolean;
    spaceBeforeComma: boolean;
    spaceAfterComma: boolean;
    spacesAroundOperators: boolean;
    alignOperandsInBinaryExpressions: boolean;
    spaceBetweenParenthesizedSubExpressions: boolean;
    caseClause: CaseClauseOptions;
}

export interface StatementOptions {
    wrapEveryStatement: boolean;
    keepBlankLinesInCode: number;
    newLineAroundSemicolon: boolean;
}

export interface DeclaredVariableOptions {
    wrapSection: boolean;
    wrapVariables: WrapMode;
    alignTypes: boolean;
    alignAssignments: boolean;
    alignExpressions: boolean;
}

export interface RoutineArgumentOptions extends ParenStyle {
    wrapElements: WrapMode;
    placeComma: CommaPlacement;
    newLineAfterComma: boolean;
}

export interface BlockOptions {
    wrapThen: boolean;
    wrapElse: boolean;
    wrapInnerCode: boolean;
    indentThenAndElse: boolean;
    indentEnd: boolean;
    collapseWhenShort: boolean;
}

export interface LoopOptions {
    wrapLoop: boolean;
    indentLoop: boolean;
    indentEndLoop: boolean;
    collapseWhenShort: boolean;
}

/** Code section. */
export interface CodeOptions {
    statements: StatementOptions;
    declaredVariables: DeclaredVariableOptions;
    routineArguments: RoutineArgumentOptions;
    block: BlockOptions;
    loops: LoopOptions;
}

/** DDL > Schema declarations. */
export interface SchemaOptions {
    indentContent: boolean;
    minBlankLinesBetweenDeclarations: number;
    maxBlankLinesBetweenDeclarations: number;
}

export interface ConstraintOptions {
    wrapConstraint: boolean;
    wrapKeyCheck: boolean;
    wrapReferences: boolean;
    wrapCascadeAndDeferrability: boolean;
}

export interface ViewOptions {
    wrapAs: boolean;
    wrapQueryBeginning: boolean;
    indentQuery: boolean;
}

export interface PostfixOptions {
    wrapFirstOption: boolean;
    wrapNextOption: boolean;
    indentOptions: boolean;
    alignOptions: boolean;
}

/** DDL section. */
export interface DdlOptions extends ParenStyle {
    alignTypes: boolean;
    alignDefaults: boolean;
    alignNullabilities: boolean;
    collapseWhenShort: boolean;
    wrapAlterInstructions: boolean;
    alignAlterInstructions: boolean;
    constraints: ConstraintOptions;
    schema: SchemaOptions;
    view: ViewOptions;
    postfix: PostfixOptions;
}

export interface FormatOptions {
    dialect: DialectName;
    case: CaseOptions;
    indents: IndentOptions;
    wrapping: WrappingOptions;
    queries: QueryOptions;
    expressions: ExpressionOptions;
    code: CodeOptions;
    ddl: DdlOptions;
    /** Line terminator written to the output. Taken from the document, not a style choice. */
    newline: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_OPTIONS: FormatOptions = {
    dialect: 'tsql',
    case: {
        keyword: 'upper',
        builtInType: 'upper',
        builtInFunction: 'upper',
        customFunction: 'preserve',
        identifier: 'preserve',
        alias: 'preserve',
    },
    indents: {
        useEditorIndentation: true,
        useTabCharacter: false,
        smartTabs: false,
        tabSize: 4,
        indent: 4,
        continuationIndent: 4,
        keepIndentsOnEmptyLines: false,
    },
    wrapping: {
        rightMargin: 120,
        keepLineBreaks: true,
        commentAtFirstColumn: true,
    },
    queries: {
        common: {
            alignFirstWordOfClause: 'toLeft',
            placeClauseElementsOn: 'newLine',
            placeComma: 'toEnd',
            collapseShortStatements: 'subqueriesOnly',
            keepElementsUnderSectionHeader: false,
            alignSectionElements: true,
            alignLineCommentsAtRightOfElements: false,
        },
        select: {
            placeElementsOn: 'asInCommon',
            wrapElements: 'chop',
            placeComma: 'asInCommon',
            newLineAfterAllDistinct: false,
            keepElementsOnOneLineIfUpTo: 1,
            useAs: false,
            alignAs: false,
        },
        from: {
            placeElementsOn: 'asInCommon',
            wrapElements: 'chopIfLong',
            placeComma: 'asInCommon',
            wrapFirstJoin: true,
            wrapNextJoin: true,
            indentJoin: true,
            placeJoinInJoinOnlyQueriesUnder: 'fromIndented',
            alignJoinedTables: false,
            alignTableAliases: false,
            wrapOnUsing: false,
            placeOnUsingUnder: 'tableIndented',
        },
        where: {
            placeElementsOn: 'asInCommon',
            wrapElements: 'chopIfLong',
            placeTopLevelBooleanOperator: 'toBegin',
            alignAs: false,
        },
        orderGroupBy: {
            placeElementsOn: 'asInCommon',
            wrapElements: 'chopIfLong',
            placeComma: 'asInCommon',
            alignAscDesc: false,
        },
        insert: {
            placeIntoOnNewLine: false,
            placeIntoClauseElementsOn: 'asInCommon',
            placeValuesRowsOn: 'asInCommon',
            openingParenthesis: 'sameLine',
            elements: 'sameLineAligned',
            closingParenthesis: 'atTheEnd',
            wrapColumnsOrValues: 'chopIfLong',
            placeComma: 'asInCommon',
            spacesWithinParentheses: false,
            collapseShortMultiRowValues: true,
            alignMultiRowValues: false,
        },
        update: {
            placeElementsOn: 'asInCommon',
            wrapElements: 'chop',
            placeComma: 'asInCommon',
            alignEqualSign: false,
        },
        with: {
            placeElementsOn: 'asInCommon',
            wrapSubqueries: 'chop',
            placeComma: 'asInCommon',
            alignAs: false,
        },
        subquery: {
            openingParenthesis: 'sameLine',
            elements: 'wrappedIndented',
            closingParenthesis: 'underOpening',
            spacesWithinParentheses: false,
        },
    },
    expressions: {
        spaceBeforeOpeningParenthesis: false,
        spacesWithinParentheses: false,
        placeCommaToBegin: false,
        spaceBeforeComma: false,
        spaceAfterComma: true,
        spacesAroundOperators: true,
        alignOperandsInBinaryExpressions: false,
        spaceBetweenParenthesizedSubExpressions: false,
        caseClause: {
            wrapWhen: true,
            indentWhenIfWrapped: true,
            wrapThen: false,
            alignThen: false,
            alignElseUnderThenWhenThenAligned: false,
            alignEnd: 'withCase',
            keepNewLineAfterThenElse: true,
            collapseShortClause: true,
        },
    },
    code: {
        statements: {
            wrapEveryStatement: true,
            keepBlankLinesInCode: 1,
            newLineAroundSemicolon: false,
        },
        declaredVariables: {
            wrapSection: true,
            wrapVariables: 'chop',
            alignTypes: false,
            alignAssignments: false,
            alignExpressions: false,
        },
        routineArguments: {
            openingParenthesis: 'sameLine',
            elements: 'sameLineAligned',
            closingParenthesis: 'atTheEnd',
            wrapElements: 'chopIfLong',
            placeComma: 'toEnd',
            newLineAfterComma: true,
            spacesWithinParentheses: false,
        },
        block: {
            wrapThen: false,
            wrapElse: true,
            wrapInnerCode: true,
            indentThenAndElse: false,
            indentEnd: false,
            collapseWhenShort: false,
        },
        loops: {
            wrapLoop: false,
            indentLoop: false,
            indentEndLoop: false,
            collapseWhenShort: false,
        },
    },
    ddl: {
        openingParenthesis: 'sameLine',
        elements: 'wrappedIndented',
        closingParenthesis: 'underOpening',
        spacesWithinParentheses: false,
        alignTypes: false,
        alignDefaults: false,
        alignNullabilities: false,
        collapseWhenShort: true,
        wrapAlterInstructions: true,
        alignAlterInstructions: false,
        schema: {
            indentContent: true,
            minBlankLinesBetweenDeclarations: 0,
            maxBlankLinesBetweenDeclarations: 1,
        },
        constraints: {
            wrapConstraint: true,
            wrapKeyCheck: false,
            wrapReferences: false,
            wrapCascadeAndDeferrability: false,
        },
        view: {
            wrapAs: false,
            wrapQueryBeginning: true,
            indentQuery: true,
        },
        postfix: {
            wrapFirstOption: true,
            wrapNextOption: true,
            indentOptions: true,
            alignOptions: false,
        },
    },
    newline: '\n',
};

/** Deep-merges a partial style over the defaults. */
export function resolveOptions(partial: DeepPartial<FormatOptions>): FormatOptions {
    return mergeDeep(DEFAULT_OPTIONS, partial) as FormatOptions;
}

export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function mergeDeep<T>(base: T, override: DeepPartial<T>): T {
    const out = { ...base } as Record<string, unknown>;
    for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
        if (value === undefined) {
            continue;
        }
        const current = out[key];
        if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            current !== null &&
            typeof current === 'object' &&
            !Array.isArray(current)
        ) {
            out[key] = mergeDeep(current, value as DeepPartial<unknown>);
        } else {
            out[key] = value;
        }
    }
    return out as T;
}

/** Resolved indentation: one level of indent, as a literal string. */
export function indentUnit(options: FormatOptions): string {
    if (options.indents.useTabCharacter) {
        return '\t';
    }
    return ' '.repeat(Math.max(1, options.indents.indent));
}

/** Width in columns of one indent level. */
export function indentWidth(options: FormatOptions): number {
    return options.indents.useTabCharacter
        ? Math.max(1, options.indents.tabSize)
        : Math.max(1, options.indents.indent);
}
