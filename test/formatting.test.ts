import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatSql } from '../src/formatter/formatter';
import type { DeepPartial, FormatOptions } from '../src/formatter/options';

const format = (sql: string, options: DeepPartial<FormatOptions> = {}): string =>
    formatSql(sql, options);

/** Compares against a template literal, ignoring its leading/trailing newline. */
function expectOutput(actual: string, expected: string): void {
    assert.equal(actual, expected.replace(/^\n/u, '').replace(/\n$/u, ''));
}

const SELECT_ABC = 'select a, b, c from t';

// ---------------------------------------------------------------------------
// Queries > Common
// ---------------------------------------------------------------------------

describe('Queries > Common', () => {
    it('aligns section elements under the first one by default', () => {
        expectOutput(format(SELECT_ABC), `
SELECT a,
       b,
       c
FROM t`);
    });

    it('keeps elements under the section header when asked', () => {
        expectOutput(
            format(SELECT_ABC, { queries: { common: { keepElementsUnderSectionHeader: true } } }),
            `
SELECT
    a,
    b,
    c
FROM t`,
        );
    });

    it('falls back to a plain indent when section alignment is off', () => {
        expectOutput(
            format(SELECT_ABC, { queries: { common: { alignSectionElements: false } } }),
            `
SELECT a,
    b,
    c
FROM t`,
        );
    });

    it('keeps clause elements on the keyword line when asked', () => {
        expectOutput(
            format(SELECT_ABC, { queries: { common: { placeClauseElementsOn: 'sameLine' } } }),
            `
SELECT a, b, c
FROM t`,
        );
    });

    it('hangs leading commas so the elements still line up', () => {
        expectOutput(format(SELECT_ABC, { queries: { common: { placeComma: 'toBegin' } } }), `
SELECT a
     , b
     , c
FROM t`);
    });

    it('anchors a nested broken group to its element column', () => {
        expectOutput(
            format('select a, (select max(x) from u where u.id = t.id) as m from t', {
                wrapping: { rightMargin: 40 },
            }),
            `
SELECT a,
       (
           SELECT MAX(x)
           FROM u
           WHERE u.id = t.id
       ) AS m
FROM t`,
        );
    });

    it('right-aligns the first word of each clause', () => {
        expectOutput(
            format('select a, b from t where x = 1 order by a', {
                queries: { common: { alignFirstWordOfClause: 'toRight' } },
            }),
            `
  SELECT a,
         b
    FROM t
   WHERE x = 1
ORDER BY a`,
        );
    });

    it('right-aligns joins along with the other clause keywords', () => {
        expectOutput(
            format('select o.id from o inner join c on c.id = o.cid where o.total > 100', {
                queries: { common: { alignFirstWordOfClause: 'toRight' } },
            }),
            `
    SELECT o.id
      FROM o
INNER JOIN c ON c.id = o.cid
     WHERE o.total > 100`,
        );
    });

    it('hangs the statement keyword out when aligning left with indent', () => {
        expectOutput(
            format('select a from t where x = 1', {
                queries: { common: { alignFirstWordOfClause: 'toLeftWithIndent' } },
            }),
            `
SELECT a
    FROM t
    WHERE x = 1`,
        );
    });
});

// ---------------------------------------------------------------------------
// Wrap modes
// ---------------------------------------------------------------------------

describe('Wrap elements', () => {
    it('chop puts every element on its own line', () => {
        expectOutput(format(SELECT_ABC, { queries: { select: { wrapElements: 'chop' } } }), `
SELECT a,
       b,
       c
FROM t`);
    });

    it('chopIfLong keeps a short list on one line', () => {
        expectOutput(
            format(SELECT_ABC, { queries: { select: { wrapElements: 'chopIfLong' } } }),
            `
SELECT a, b, c
FROM t`,
        );
    });

    it('chopIfLong chops a list that exceeds the right margin', () => {
        expectOutput(
            format('select aaaa, bbbb, cccc from t', {
                wrapping: { rightMargin: 20 },
                queries: { select: { wrapElements: 'chopIfLong' } },
            }),
            `
SELECT aaaa,
       bbbb,
       cccc
FROM t`,
        );
    });

    it('wrapIfLong fills each line up to the right margin', () => {
        expectOutput(
            format('select aaa, bbb, ccc, ddd, eee, fff, ggg, hhh from t', {
                wrapping: { rightMargin: 30 },
                queries: { select: { wrapElements: 'wrapIfLong' } },
            }),
            `
SELECT aaa, bbb, ccc, ddd,
       eee, fff, ggg, hhh
FROM t`,
        );
    });
});

// ---------------------------------------------------------------------------
// Alignment options
// ---------------------------------------------------------------------------

describe('Alignment', () => {
    it('aligns AS in the select list', () => {
        expectOutput(
            format('select a as alpha, bb as beta, ccc as gamma from t', {
                queries: { select: { alignAs: true } },
            }),
            `
SELECT a   AS alpha,
       bb  AS beta,
       ccc AS gamma
FROM t`,
        );
    });

    it('aligns ASC and DESC in ORDER BY', () => {
        expectOutput(
            format('select a from t order by alpha desc, bb asc, ccc desc', {
                queries: { orderGroupBy: { alignAscDesc: true, wrapElements: 'chop' } },
            }),
            `
SELECT a
FROM t
ORDER BY alpha DESC,
         bb    ASC,
         ccc   DESC`,
        );
    });

    it('aligns the equal signs of an UPDATE', () => {
        expectOutput(
            format('update t set a = 1, bbbb = 2, cc = 3 where id = 1', {
                queries: { update: { alignEqualSign: true, wrapElements: 'chop' } },
            }),
            `
UPDATE t
SET a    = 1,
    bbbb = 2,
    cc   = 3
WHERE id = 1`,
        );
    });

    it('aligns DDL types, defaults and nullabilities', () => {
        expectOutput(
            format(
                'create table T (Id int not null, Name nvarchar(200) not null, Price decimal(18,2) null);',
                {
                    wrapping: { rightMargin: 40 },
                    ddl: { alignTypes: true, alignNullabilities: true, alignDefaults: true },
                },
            ),
            `
CREATE TABLE T (
    Id    INT            NOT NULL,
    Name  NVARCHAR(200)  NOT NULL,
    Price DECIMAL(18, 2) NULL
);`,
        );
    });
});

// ---------------------------------------------------------------------------
// Queries > From
// ---------------------------------------------------------------------------

describe('Queries > From', () => {
    it('indents joins under FROM and keeps ON inline by default', () => {
        expectOutput(format('select a.x from a inner join b on b.id = a.id'), `
SELECT a.x
FROM a
    INNER JOIN b ON b.id = a.id`);
    });

    it('wraps ON onto its own line when asked', () => {
        expectOutput(
            format('select a.x from a inner join b on b.id = a.id', {
                queries: { from: { wrapOnUsing: true } },
            }),
            `
SELECT a.x
FROM a
    INNER JOIN b
        ON b.id = a.id`,
        );
    });

    it('places ON under the table when asked', () => {
        expectOutput(
            format('select a.x from a inner join b on b.id = a.id', {
                queries: { from: { wrapOnUsing: true, placeOnUsingUnder: 'table' } },
            }),
            `
SELECT a.x
FROM a
    INNER JOIN b
    ON b.id = a.id`,
        );
    });

    it('does not indent joins when indentJoin is off', () => {
        expectOutput(
            format('select a.x from a inner join b on b.id = a.id', {
                queries: { from: { indentJoin: false } },
            }),
            `
SELECT a.x
FROM a
INNER JOIN b ON b.id = a.id`,
        );
    });

    it('keeps the first join on the FROM line when wrapFirstJoin is off', () => {
        assert.match(
            format('select a.x from a inner join b on b.id = a.id', {
                queries: { from: { wrapFirstJoin: false } },
            }),
            /FROM a INNER JOIN b ON b\.id = a\.id/u,
        );
    });
});

// ---------------------------------------------------------------------------
// Queries > Where
// ---------------------------------------------------------------------------

describe('Queries > Where', () => {
    it('breaks before AND when the predicate is long', () => {
        expectOutput(
            format('select a from t where aaaaaaaaaa = 1 and bbbbbbbbbb = 2', {
                wrapping: { rightMargin: 30 },
            }),
            `
SELECT a
FROM t
WHERE aaaaaaaaaa = 1
    AND bbbbbbbbbb = 2`,
        );
    });

    it('leaves AND at the end of the line when asked', () => {
        expectOutput(
            format('select a from t where aaaaaaaaaa = 1 and bbbbbbbbbb = 2', {
                wrapping: { rightMargin: 30 },
                queries: { where: { placeTopLevelBooleanOperator: 'toEnd' } },
            }),
            `
SELECT a
FROM t
WHERE aaaaaaaaaa = 1 AND
    bbbbbbbbbb = 2`,
        );
    });

    it('never breaks the AND of a BETWEEN', () => {
        expectOutput(format('select a from t where x between 1 and 10'), `
SELECT a
FROM t
WHERE x BETWEEN 1 AND 10`);
    });
});

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

describe('Expressions', () => {
    it('adds spaces within parentheses when asked', () => {
        assert.match(
            format('select f(a,b) from t where x in (1,2)', {
                expressions: { spacesWithinParentheses: true },
            }),
            /WHERE x IN \( 1, 2 \)/u,
        );
    });

    it('removes spaces around operators when asked', () => {
        assert.match(
            format('select a + b from t where x = 1', {
                expressions: { spacesAroundOperators: false },
            }),
            /WHERE x=1/u,
        );
    });

    it('adds a space before the comma when asked', () => {
        assert.match(
            format(SELECT_ABC, {
                expressions: { spaceBeforeComma: true },
                queries: { common: { placeClauseElementsOn: 'sameLine' } },
            }),
            /SELECT a , b , c/u,
        );
    });

    it('writes function calls without a space before the paren', () => {
        assert.match(format('select count( * ) from t'), /SELECT COUNT\(\*\)/u);
    });

    it('honours the source when an unknown word precedes a paren', () => {
        assert.match(format('select * from t (nolock)'), /FROM t \(NOLOCK\)/u);
        assert.match(format('select dbo.fn(1) from t'), /dbo\.fn\(1\)/u);
    });

    it('does not space a unary minus away from its operand', () => {
        assert.match(
            format('select -1, a - 1, -x.y from t', {
                queries: { common: { placeClauseElementsOn: 'sameLine' } },
            }),
            /SELECT -1, a - 1, -x\.y/u,
        );
    });
});

// ---------------------------------------------------------------------------
// Expressions > CASE
// ---------------------------------------------------------------------------

describe('Expressions > CASE', () => {
    const CASE_SQL = 'select case when a = 1 then 111 when bb = 2 then 22 else 3 end as x from t';
    const narrow = { wrapping: { rightMargin: 30 } };

    it('collapses a short CASE', () => {
        assert.match(
            format('select case when a = 1 then 2 else 3 end as x from t'),
            /CASE WHEN a = 1 THEN 2 ELSE 3 END AS x/u,
        );
    });

    it('breaks a long CASE onto one line per branch', () => {
        expectOutput(format(CASE_SQL, narrow), `
SELECT CASE
    WHEN a = 1 THEN 111
    WHEN bb = 2 THEN 22
    ELSE 3
END AS x
FROM t`);
    });

    it('aligns THEN when asked', () => {
        expectOutput(
            format(CASE_SQL, { ...narrow, expressions: { caseClause: { alignThen: true } } }),
            `
SELECT CASE
    WHEN a = 1  THEN 111
    WHEN bb = 2 THEN 22
    ELSE 3
END AS x
FROM t`,
        );
    });

    it('wraps THEN onto its own line when asked', () => {
        expectOutput(
            format(CASE_SQL, { ...narrow, expressions: { caseClause: { wrapThen: true } } }),
            `
SELECT CASE
    WHEN a = 1
        THEN 111
    WHEN bb = 2
        THEN 22
    ELSE 3
END AS x
FROM t`,
        );
    });

    it('aligns END with WHEN when asked', () => {
        assert.match(
            format(CASE_SQL, { ...narrow, expressions: { caseClause: { alignEnd: 'withWhen' } } }),
            /\n {4}END AS x/u,
        );
    });

    it('does not indent WHEN when indentWhenIfWrapped is off', () => {
        assert.match(
            format(CASE_SQL, {
                ...narrow,
                expressions: { caseClause: { indentWhenIfWrapped: false } },
            }),
            /\nWHEN a = 1 THEN 111/u,
        );
    });
});

// ---------------------------------------------------------------------------
// Parentheses, subqueries and DDL
// ---------------------------------------------------------------------------

describe('Parentheses', () => {
    it('keeps a subquery inline when it fits', () => {
        expectOutput(format('select a from t where id in (select id from u)'), `
SELECT a
FROM t
WHERE id IN (SELECT id FROM u)`);
    });

    it('breaks a subquery that does not fit', () => {
        expectOutput(
            format('select a from t where id in (select id from u where flag = 1)', {
                wrapping: { rightMargin: 30 },
            }),
            `
SELECT a
FROM t
WHERE id IN (
    SELECT id
    FROM u
    WHERE flag = 1
)`,
        );
    });

    it('keeps a short CTE body inline and breaks a long one', () => {
        expectOutput(format('with c as (select 1 as n) select n from c'), `
WITH c AS (SELECT 1 AS n)
SELECT n
FROM c`);
        expectOutput(
            format('with c as (select 1 as n) select n from c', { wrapping: { rightMargin: 20 } }),
            `
WITH c AS (
    SELECT 1 AS n
)
SELECT n
FROM c`,
        );
    });

    it('hangs a leading comma between CTEs', () => {
        expectOutput(
            format(
                'with a as (select 1 as n), bb as (select 2 as n) select * from a',
                { queries: { with: { placeComma: 'toBegin' } } },
            ),
            `
WITH a AS (SELECT 1 AS n)
   , bb AS (SELECT 2 AS n)
SELECT *
FROM a`,
        );
    });

    it('honours the DDL opening parenthesis placement', () => {
        expectOutput(
            format('create table T (a int, b int, c int);', {
                wrapping: { rightMargin: 20 },
                ddl: { openingParenthesis: 'indented' },
            }),
            `
CREATE TABLE T
    (
        a INT,
        b INT,
        c INT
    );`,
        );
    });

    it('honours the DDL closing parenthesis placement', () => {
        expectOutput(
            format('create table T (a int, b int, c int);', {
                wrapping: { rightMargin: 20 },
                ddl: { closingParenthesis: 'underElements' },
            }),
            `
CREATE TABLE T (
    a INT,
    b INT,
    c INT
    );`,
        );
    });
});

// ---------------------------------------------------------------------------
// Case tab
// ---------------------------------------------------------------------------

describe('Case', () => {
    it('uppercases keywords and preserves identifiers by default', () => {
        assert.equal(format('select MyCol from MyTable'), 'SELECT MyCol\nFROM MyTable');
    });

    it('lowercases keywords on request', () => {
        assert.equal(
            format('SELECT MyCol FROM MyTable', { case: { keyword: 'lower' } }),
            'select MyCol\nfrom MyTable',
        );
    });

    it('cases aliases separately from identifiers', () => {
        assert.match(
            format('select col as MyAlias from t', { case: { alias: 'upper' } }),
            /col AS MYALIAS/u,
        );
    });

    it('cases built-in types separately from keywords', () => {
        assert.match(
            format('declare @x Int;', { case: { builtInType: 'lower' } }),
            /DECLARE @x int;/u,
        );
    });

    it('never re-cases quoted identifiers', () => {
        assert.match(format('select [My Col] from t', { case: { identifier: 'upper' } }), /\[My Col\]/u);
    });

    it('never re-cases string contents', () => {
        assert.match(format("select 'Keep Me' from t"), /'Keep Me'/u);
    });

    it('treats a word after a dot as an identifier, not a keyword', () => {
        assert.match(format('select t.Order from t'), /t\.Order/u);
    });
});

// ---------------------------------------------------------------------------
// Tabs and Indents, Wrapping, Code
// ---------------------------------------------------------------------------

describe('Tabs and Indents', () => {
    it('indents with tabs when asked', () => {
        assert.match(
            format(SELECT_ABC, {
                indents: { useTabCharacter: true },
                queries: { common: { keepElementsUnderSectionHeader: true } },
            }),
            /\n\ta,\n\tb/u,
        );
    });

    it('honours a custom indent width', () => {
        assert.match(
            format(SELECT_ABC, {
                indents: { indent: 2 },
                queries: { common: { keepElementsUnderSectionHeader: true } },
            }),
            /\n {2}a,\n {2}b/u,
        );
    });
});

describe('Wrapping and Code > Statements', () => {
    it('collapses runs of blank lines to the configured maximum', () => {
        assert.equal(format('print 1;\n\n\n\nprint 2;'), 'PRINT 1;\n\nPRINT 2;');
    });

    it('drops blank lines when none are allowed', () => {
        assert.equal(
            format('print 1;\n\n\nprint 2;', { code: { statements: { keepBlankLinesInCode: 0 } } }),
            'PRINT 1;\nPRINT 2;',
        );
    });

    it('drops blank lines when line breaks are not preserved', () => {
        assert.equal(
            format('print 1;\n\n\nprint 2;', { wrapping: { keepLineBreaks: false } }),
            'PRINT 1;\nPRINT 2;',
        );
    });

    it('puts the semicolon on its own line when asked', () => {
        assert.equal(
            format('print 1; print 2;', { code: { statements: { newLineAroundSemicolon: true } } }),
            'PRINT 1\n;\nPRINT 2\n;',
        );
    });

    it('uses CRLF when asked', () => {
        assert.equal(format('select a from t', { newline: '\r\n' }), 'SELECT a\r\nFROM t');
    });
});

describe('Code > Blocks and batches', () => {
    it('indents the body of a BEGIN block', () => {
        expectOutput(format('begin print 1; print 2; end'), `
BEGIN
    PRINT 1;
    PRINT 2;
END`);
    });

    it('leaves the block body unindented when wrapInnerCode is off', () => {
        expectOutput(format('begin print 1; end', { code: { block: { wrapInnerCode: false } } }), `
BEGIN
PRINT 1;
END`);
    });

    it('indents the closing END when asked', () => {
        expectOutput(format('begin print 1; end', { code: { block: { indentEnd: true } } }), `
BEGIN
    PRINT 1;
    END`);
    });

    it('does not treat BEGIN TRANSACTION as a block', () => {
        expectOutput(format('begin transaction; print 1; commit;'), `
BEGIN TRANSACTION;
PRINT 1;
COMMIT;`);
    });

    it('indents an IF body written without BEGIN', () => {
        expectOutput(format("if @x > 0 print 'pos' else print 'neg';"), `
IF @x > 0
    PRINT 'pos'
ELSE
    PRINT 'neg';`);
    });

    it('puts GO at column zero', () => {
        expectOutput(format('select 1\ngo\nselect 2\ngo'), `
SELECT 1
GO
SELECT 2
GO`);
    });
});

// ---------------------------------------------------------------------------
// Statement context regressions
// ---------------------------------------------------------------------------

describe('Statement context', () => {
    it('does not lay out GRANT as a SELECT clause', () => {
        assert.equal(format('grant select on dbo.T to reader;'), 'GRANT SELECT ON dbo.T TO reader;');
    });

    it('treats a leading SET as T-SQL SET, not an UPDATE clause', () => {
        assert.equal(format('set nocount on;'), 'SET NOCOUNT ON;');
    });

    it('keeps ON attached to CREATE INDEX rather than a join', () => {
        assert.equal(format('create index IX_a on dbo.T (a, b);'), 'CREATE INDEX IX_a ON dbo.T (a, b);');
    });

    it('recognises the SET clause of an UPDATE inside a block', () => {
        expectOutput(format('begin update dbo.t set seen = 1 where id = @id; end'), `
BEGIN
    UPDATE dbo.t
    SET seen = 1
    WHERE id = @id;
END`);
    });

    it('dedents set operators to the statement level', () => {
        expectOutput(format('select a from t1 union all select a from t2'), `
SELECT a
FROM t1
UNION ALL
SELECT a
FROM t2`);
    });

    it('indents MERGE actions under their WHEN', () => {
        expectOutput(
            format(
                'merge dbo.A as a using dbo.B as b on a.id = b.id when matched then update set a.v = b.v when not matched then insert (id, val) values (b.id, b.v);',
            ),
            `
MERGE dbo.A AS a
USING dbo.B AS b
    ON a.id = b.id
WHEN MATCHED THEN
    UPDATE
    SET a.v = b.v
WHEN NOT MATCHED THEN
    INSERT (id, val)
    VALUES (b.id, b.v);`,
        );
    });
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

describe('Comments', () => {
    it('keeps a trailing comment on the line it annotated', () => {
        assert.match(format('select a -- why\nfrom t'), /SELECT a -- why\nFROM t/u);
    });

    it('keeps an own-line comment on its own line', () => {
        expectOutput(format('-- header\nselect a from t'), `
-- header
SELECT a
FROM t`);
    });

    it('never lets code follow a line comment', () => {
        const formatted = format('select a, -- first\n b from t');
        for (const line of formatted.split('\n')) {
            const comment = line.indexOf('--');
            if (comment !== -1) {
                assert.equal(line.slice(comment).includes('\n'), false);
            }
        }
        assert.match(formatted, /-- first\n/u);
    });
});
