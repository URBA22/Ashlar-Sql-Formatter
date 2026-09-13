import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDialect } from '../src/formatter/dialects';
import { formatSql } from '../src/formatter/formatter';
import { TokenType, tokenize, type Token } from '../src/formatter/tokenizer';
import type { DialectName } from '../src/formatter/dialects';
import { MYSQL_CORPUS, POSTGRES_CORPUS, TSQL_CORPUS } from './corpus';

/**
 * Reduces a token to the part formatting is allowed to change nothing about.
 * Word casing is excluded because re-casing keywords is the point; comment
 * whitespace is normalised because block comments are re-indented.
 */
function signature(token: Token): string {
    switch (token.type) {
        case TokenType.Word:
        case TokenType.BatchSeparator:
            return `${token.type}:${token.key}`;
        case TokenType.String:
            // Only the optional prefix is re-cased; contents must be identical.
            return `${token.type}:${normalizeStringPrefix(token.value)}`;
        case TokenType.LineComment:
        case TokenType.BlockComment:
            return `${token.type}:${token.value.replace(/\s+/gu, ' ').trim()}`;
        default:
            return `${token.type}:${token.value}`;
    }
}

function normalizeStringPrefix(value: string): string {
    const quote = value.indexOf("'");
    if (quote <= 0) {
        return value;
    }
    return value.slice(0, quote).toUpperCase() + value.slice(quote);
}

function signatures(sql: string, dialect: DialectName): string[] {
    return tokenize(sql, getDialect(dialect)).map(signature);
}

const SUITES: Array<{ dialect: DialectName; corpus: string[] }> = [
    { dialect: 'tsql', corpus: TSQL_CORPUS },
    { dialect: 'postgresql', corpus: POSTGRES_CORPUS },
    { dialect: 'mysql', corpus: MYSQL_CORPUS },
];

/**
 * The corpus runs under several styles, not just the default one. A narrow
 * margin forces every group, list and predicate to break; turning the alignment
 * options on exercises the element writers, which take their own path through
 * the token stream. Both are where layout bugs live.
 */
const STYLES: Array<{ name: string; options: Record<string, unknown> }> = [
    { name: 'default style', options: { wrapping: { rightMargin: 120 } } },
    { name: 'narrow width', options: { wrapping: { rightMargin: 30 } } },
    {
        name: 'everything aligned',
        options: {
            queries: {
                common: { alignLineCommentsAtRightOfElements: true },
                select: { alignAs: true },
                update: { alignEqualSign: true },
                orderGroupBy: { alignAscDesc: true },
                with: { alignAs: true },
                insert: { alignMultiRowValues: true, collapseShortMultiRowValues: false },
            },
            expressions: { alignOperandsInBinaryExpressions: true, caseClause: { alignThen: true } },
            code: {
                declaredVariables: { alignTypes: true, alignAssignments: true, alignExpressions: true },
            },
            ddl: { alignTypes: true, alignDefaults: true, alignNullabilities: true },
        },
    },
];

for (const { dialect, corpus } of SUITES) {
    for (const { name, options: style } of STYLES) {
        const options = { dialect, ...style };

        describe(`${dialect} at ${name}: formatting preserves meaning`, () => {
            for (const [index, sql] of corpus.entries()) {
                it(`keeps every token of case ${index + 1}`, () => {
                    const formatted = formatSql(sql, options);
                    assert.deepEqual(
                        signatures(formatted, dialect),
                        signatures(sql, dialect),
                        `token stream changed:\n--- input ---\n${sql}\n--- output ---\n${formatted}`,
                    );
                });
            }
        });

        describe(`${dialect} at ${name}: formatting is idempotent`, () => {
            for (const [index, sql] of corpus.entries()) {
                it(`reformats case ${index + 1} to itself`, () => {
                    const once = formatSql(sql, options);
                    const twice = formatSql(once, options);
                    assert.equal(
                        twice, once,
                        `second pass differed:\n${once}\n=== vs ===\n${twice}`,
                    );
                });
            }
        });
    }
}

describe('output hygiene', () => {
    for (const { dialect, corpus } of SUITES) {
        for (const [index, sql] of corpus.entries()) {
            it(`${dialect} case ${index + 1} has no trailing whitespace`, () => {
                const formatted = formatSql(sql, { dialect });
                for (const line of formatted.split('\n')) {
                    assert.equal(line, line.trimEnd(), `trailing whitespace in: ${JSON.stringify(line)}`);
                }
                assert.equal(formatted, formatted.trimEnd());
            });
        }
    }

    it('returns an empty string for blank input', () => {
        assert.equal(formatSql(''), '');
        assert.equal(formatSql('   \n\t '), '');
    });

    it('does not throw on unterminated constructs', () => {
        assert.doesNotThrow(() => formatSql("select 'unterminated"));
        assert.doesNotThrow(() => formatSql('select /* unterminated'));
        assert.doesNotThrow(() => formatSql('select (((('));
        assert.doesNotThrow(() => formatSql('select ))))'));
        assert.doesNotThrow(() => formatSql('select [unclosed'));
        assert.doesNotThrow(() => formatSql('end end end'));
    });
});
