import {
    ANSI_DATA_TYPES,
    ANSI_FUNCTIONS,
    ANSI_KEYWORDS,
    BOOLEAN_LITERALS,
    MYSQL_DATA_TYPES,
    MYSQL_FUNCTIONS,
    MYSQL_KEYWORDS,
    ORACLE_DATA_TYPES,
    ORACLE_FUNCTIONS,
    ORACLE_KEYWORDS,
    POSTGRES_DATA_TYPES,
    POSTGRES_FUNCTIONS,
    POSTGRES_KEYWORDS,
    SQLITE_DATA_TYPES,
    SQLITE_KEYWORDS,
    TSQL_DATA_TYPES,
    TSQL_FUNCTIONS,
    TSQL_KEYWORDS,
} from './keywords';

export type DialectName =
    | 'tsql'
    | 'postgresql'
    | 'mysql'
    | 'sqlite'
    | 'oracle'
    | 'standard';

/** A pair of characters that delimits a quoted identifier. */
export interface IdentifierQuote {
    open: string;
    close: string;
    /** Whether the close character is escaped by doubling it (`]]`, `""`). */
    escapeByDoubling: boolean;
}

export interface Dialect {
    name: DialectName;
    identifierQuotes: IdentifierQuote[];
    /** Letters that may prefix a string literal, e.g. `N'x'`, `E'x'`, `X'ff'`. */
    stringPrefixes: string[];
    /** PostgreSQL `$tag$ ... $tag$` literals. */
    dollarQuoting: boolean;
    /** MySQL treats a bare `#` as a line comment. */
    hashLineComment: boolean;
    /** T-SQL and PostgreSQL allow nested block comments. */
    nestedBlockComments: boolean;
    /** Backslash escapes inside single-quoted strings (MySQL). */
    backslashEscapes: boolean;
    /** Sigils that introduce a variable/parameter token. */
    variablePrefixes: string[];
    /** Extra characters allowed to *start* a bare identifier (`#temp`, `$x`). */
    extraIdentifierStart: string[];
    /** Extra characters allowed *inside* a bare identifier. */
    extraIdentifierPart: string[];
    /** Standalone batch separator that terminates a group of statements. */
    batchSeparator?: string;
    keywords: ReadonlySet<string>;
    functions: ReadonlySet<string>;
    dataTypes: ReadonlySet<string>;
}

const upperSet = (...groups: string[][]): ReadonlySet<string> => {
    const set = new Set<string>();
    for (const group of groups) {
        for (const word of group) {
            set.add(word.toUpperCase());
        }
    }
    return set;
};

const DOUBLE_QUOTE_IDENT: IdentifierQuote = {
    open: '"',
    close: '"',
    escapeByDoubling: true,
};
const BRACKET_IDENT: IdentifierQuote = {
    open: '[',
    close: ']',
    escapeByDoubling: true,
};
const BACKTICK_IDENT: IdentifierQuote = {
    open: '`',
    close: '`',
    escapeByDoubling: true,
};

const DIALECTS: Record<DialectName, Dialect> = {
    tsql: {
        name: 'tsql',
        identifierQuotes: [BRACKET_IDENT, DOUBLE_QUOTE_IDENT],
        stringPrefixes: ['N'],
        dollarQuoting: false,
        hashLineComment: false,
        nestedBlockComments: true,
        backslashEscapes: false,
        variablePrefixes: ['@@', '@'],
        extraIdentifierStart: ['#', '_'],
        extraIdentifierPart: ['#', '$', '_'],
        batchSeparator: 'GO',
        keywords: upperSet(ANSI_KEYWORDS, TSQL_KEYWORDS, BOOLEAN_LITERALS),
        functions: upperSet(ANSI_FUNCTIONS, TSQL_FUNCTIONS),
        dataTypes: upperSet(ANSI_DATA_TYPES, TSQL_DATA_TYPES),
    },
    postgresql: {
        name: 'postgresql',
        identifierQuotes: [DOUBLE_QUOTE_IDENT],
        stringPrefixes: ['E', 'U&', 'B', 'X'],
        dollarQuoting: true,
        hashLineComment: false,
        nestedBlockComments: true,
        backslashEscapes: false,
        variablePrefixes: [':', '$'],
        extraIdentifierStart: ['_'],
        extraIdentifierPart: ['$', '_'],
        keywords: upperSet(ANSI_KEYWORDS, POSTGRES_KEYWORDS, BOOLEAN_LITERALS),
        functions: upperSet(ANSI_FUNCTIONS, POSTGRES_FUNCTIONS),
        dataTypes: upperSet(ANSI_DATA_TYPES, POSTGRES_DATA_TYPES),
    },
    mysql: {
        name: 'mysql',
        identifierQuotes: [BACKTICK_IDENT, DOUBLE_QUOTE_IDENT],
        stringPrefixes: ['N', 'B', 'X'],
        dollarQuoting: false,
        hashLineComment: true,
        nestedBlockComments: false,
        backslashEscapes: true,
        variablePrefixes: ['@@', '@', '?'],
        extraIdentifierStart: ['_'],
        extraIdentifierPart: ['$', '_'],
        keywords: upperSet(ANSI_KEYWORDS, MYSQL_KEYWORDS, BOOLEAN_LITERALS),
        functions: upperSet(ANSI_FUNCTIONS, MYSQL_FUNCTIONS),
        dataTypes: upperSet(ANSI_DATA_TYPES, MYSQL_DATA_TYPES),
    },
    sqlite: {
        name: 'sqlite',
        identifierQuotes: [DOUBLE_QUOTE_IDENT, BRACKET_IDENT, BACKTICK_IDENT],
        stringPrefixes: ['X'],
        dollarQuoting: false,
        hashLineComment: false,
        nestedBlockComments: false,
        backslashEscapes: false,
        variablePrefixes: [':', '@', '$', '?'],
        extraIdentifierStart: ['_'],
        extraIdentifierPart: ['$', '_'],
        keywords: upperSet(ANSI_KEYWORDS, SQLITE_KEYWORDS, BOOLEAN_LITERALS),
        functions: upperSet(ANSI_FUNCTIONS),
        dataTypes: upperSet(ANSI_DATA_TYPES, SQLITE_DATA_TYPES),
    },
    oracle: {
        name: 'oracle',
        identifierQuotes: [DOUBLE_QUOTE_IDENT],
        stringPrefixes: ['N', 'Q'],
        dollarQuoting: false,
        hashLineComment: false,
        nestedBlockComments: false,
        backslashEscapes: false,
        variablePrefixes: [':'],
        extraIdentifierStart: ['_'],
        extraIdentifierPart: ['$', '#', '_'],
        keywords: upperSet(ANSI_KEYWORDS, ORACLE_KEYWORDS, BOOLEAN_LITERALS),
        functions: upperSet(ANSI_FUNCTIONS, ORACLE_FUNCTIONS),
        dataTypes: upperSet(ANSI_DATA_TYPES, ORACLE_DATA_TYPES),
    },
    standard: {
        name: 'standard',
        identifierQuotes: [DOUBLE_QUOTE_IDENT],
        stringPrefixes: ['N'],
        dollarQuoting: false,
        hashLineComment: false,
        nestedBlockComments: false,
        backslashEscapes: false,
        variablePrefixes: [':', '?'],
        extraIdentifierStart: ['_'],
        extraIdentifierPart: ['_'],
        keywords: upperSet(ANSI_KEYWORDS, BOOLEAN_LITERALS),
        functions: upperSet(ANSI_FUNCTIONS),
        dataTypes: upperSet(ANSI_DATA_TYPES),
    },
};

export function getDialect(name: string): Dialect {
    return DIALECTS[name as DialectName] ?? DIALECTS.tsql;
}
