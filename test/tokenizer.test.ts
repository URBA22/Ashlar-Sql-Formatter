import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDialect } from '../src/formatter/dialects';
import { TokenType, tokenize } from '../src/formatter/tokenizer';

const tsql = getDialect('tsql');
const mysql = getDialect('mysql');
const postgres = getDialect('postgresql');

const values = (sql: string, dialect = tsql): string[] =>
    tokenize(sql, dialect).map((t) => t.value);

const types = (sql: string, dialect = tsql): TokenType[] =>
    tokenize(sql, dialect).map((t) => t.type);

describe('tokenizer: strings', () => {
    it('keeps doubled quotes inside a literal', () => {
        assert.deepEqual(values("'it''s'"), ["'it''s'"]);
    });

    it('reads an N prefix as part of the literal', () => {
        assert.deepEqual(types("N'x'"), [TokenType.String]);
    });

    it('does not mistake a trailing N of an identifier for a prefix', () => {
        assert.deepEqual(values("columnN'x'"), ['columnN', "'x'"]);
    });

    it('honours backslash escapes only where the dialect has them', () => {
        assert.deepEqual(values("'a\\'b'", mysql), ["'a\\'b'"]);
        assert.deepEqual(values("'a\\'", tsql), ["'a\\'"]);
    });

    it('reads PostgreSQL dollar quoting, including tags', () => {
        assert.deepEqual(values("$$a 'b' c$$", postgres), ["$$a 'b' c$$"]);
        assert.deepEqual(values('$tag$ body $tag$', postgres), ['$tag$ body $tag$']);
    });

    it('runs an unterminated literal to end of input without throwing', () => {
        assert.deepEqual(values("select 'oops"), ['select', "'oops"]);
    });
});

describe('tokenizer: identifiers', () => {
    it('reads bracketed identifiers with doubled closing brackets', () => {
        assert.deepEqual(values('[a]]b]'), ['[a]]b]']);
    });

    it('reads backticks only in MySQL', () => {
        assert.deepEqual(types('`a`', mysql), [TokenType.QuotedIdentifier]);
        assert.notDeepEqual(types('`a`', tsql), [TokenType.QuotedIdentifier]);
    });

    it('treats #temp and ##global as identifiers in T-SQL', () => {
        assert.deepEqual(types('#t ##g'), [TokenType.Word, TokenType.Word]);
    });

    it('reads T-SQL variables including @@', () => {
        assert.deepEqual(values('@x @@ROWCOUNT'), ['@x', '@@ROWCOUNT']);
    });
});

describe('tokenizer: comments', () => {
    it('reads a line comment up to but not including the newline', () => {
        assert.deepEqual(values('-- note\nx'), ['-- note', 'x']);
    });

    it('excludes the CR of a CRLF pair from the comment', () => {
        assert.deepEqual(values('-- note\r\nx'), ['-- note', 'x']);
    });

    it('nests block comments in T-SQL but not in MySQL', () => {
        assert.deepEqual(values('/* a /* b */ c */'), ['/* a /* b */ c */']);
        assert.deepEqual(values('/* a /* b */ c */', mysql), ['/* a /* b */', 'c', '*', '/']);
    });

    it('reads # as a comment only in MySQL', () => {
        assert.deepEqual(types('# note', mysql), [TokenType.LineComment]);
        assert.deepEqual(types('#note', tsql), [TokenType.Word]);
    });
});

describe('tokenizer: numbers and operators', () => {
    it('reads hex, exponent and decimal forms', () => {
        assert.deepEqual(values('0x1F 1.5 1e10 1E-3 .5'), ['0x1F', '1.5', '1e10', '1E-3', '.5']);
    });

    it('prefers the longest operator', () => {
        assert.deepEqual(values('a<=b'), ['a', '<=', 'b']);
        assert.deepEqual(values('a<>b'), ['a', '<>', 'b']);
        assert.deepEqual(values('a::b', postgres), ['a', '::', 'b']);
    });

    it('does not read :: as a bind parameter', () => {
        assert.deepEqual(types('a::int', postgres), [
            TokenType.Word,
            TokenType.Operator,
            TokenType.Word,
        ]);
    });
});

describe('tokenizer: batch separator', () => {
    it('recognises GO alone on a line', () => {
        assert.deepEqual(types('select 1\ngo\nselect 2'), [
            TokenType.Word,
            TokenType.Number,
            TokenType.BatchSeparator,
            TokenType.Word,
            TokenType.Number,
        ]);
    });

    it('leaves GO alone when it is used as an identifier', () => {
        assert.deepEqual(types('select go from t'), [
            TokenType.Word,
            TokenType.Word,
            TokenType.Word,
            TokenType.Word,
        ]);
    });
});

describe('tokenizer: whitespace bookkeeping', () => {
    it('records the number of newlines before a token', () => {
        const tokens = tokenize('a\n\n\nb', tsql);
        assert.equal(tokens[1].precedingNewlines, 3);
    });

    it('records whether any whitespace preceded a token', () => {
        const tokens = tokenize('f (x)', tsql);
        assert.equal(tokens[1].precedingWhitespace, true);
        const tight = tokenize('f(x)', tsql);
        assert.equal(tight[1].precedingWhitespace, false);
    });
});
