// Ordered groups, one per section of the style model.
// Metadata (type, values, default, description) is derived from package.json
// and DEFAULT_OPTIONS so the page cannot drift from the extension.

const SQL = {
  case: "Select c.Id, Count(*) As Total From dbo.Customer c Where c.Name Like 'A%'",
  indents: 'select alpha, beta, gamma from dbo.Orders where id = 1',
  wrapping: 'select alpha, beta from t\n\n\nwhere id = 1',
  common: 'select a, b, c from t where x = 1 order by a',
  select: 'select a, bb as beta, ccc as gamma from dbo.Orders',
  from: 'select a.x from dbo.a a inner join dbo.b b on b.id = a.id left join dbo.c c on c.id = b.id',
  where: 'select a from t where aaaaaaaaaa = 1 and bbbbbbbbbb = 2',
  orderGroupBy: 'select a from t group by alpha, bb, ccc order by alpha desc, bb asc, ccc desc',
  insert: 'insert into dbo.Target (alpha, beta, gamma) values (1, 2, 3)',
  update: 'update dbo.Target set alpha = 1, bb = 2, ccc = 3 where id = 1',
  with: 'with recent as (select id, name from dbo.People where active = 1) select r.id from recent r',
  subquery: 'select a from t where id in (select id from u where flag = 1)',
  expressions: 'select f(a, b), x + y from t where n in (1, 2) and m = 3',
  caseClause: "select case when a = 1 then 111 when bb = 2 then 22 else 3 end as Bucket from t",
  statements: "print 'one';\n\n\n\nprint 'two';\nprint 'three';",
  variables: "declare @a int = 1, @bbbb nvarchar(50) = 'x', @cc bit = 0;",
  routine: 'create procedure dbo.usp_Do @alpha int, @beta nvarchar(50) = null, @gamma bit = 0 as begin print 1; end',
  block: "if @x > 0 begin print 'a'; print 'b'; end else begin print 'c'; end",
  loops: 'while @i < 10 begin set @i = @i + 1; end',
  ddl: 'create table dbo.Widget (Id int not null, Name nvarchar(200) not null, Price decimal(18,2) null, Note varchar(50) default \'\' null)',
  ddlConstraint: 'create table dbo.Widget (Id int not null constraint PK_Widget primary key, OwnerId int not null constraint FK_Owner references dbo.Owner (Id) on delete cascade)',
  ddlView: 'create view dbo.vWidget as select Id, Name from dbo.Widget where Price > 0',
  ddlPostfix: 'create table dbo.Widget (Id int not null) with (data_compression = page, fillfactor = 80)',
};

const NARROW = { wrapping: { rightMargin: 44 } };
const NARROW30 = { wrapping: { rightMargin: 30 } };

// groups: {id, tab, name, blurb, settings: [path | [path, overrides]]}
// overrides: {sql, demo (value to show as "after"), options (applied to both sides)}
const GROUPS = [
  {
    id: 'case', tab: 'Case', name: 'Case',
    blurb: 'Word case per element kind. Quoted identifiers and string contents are never re-cased.',
    sql: SQL.case,
    settings: [
      'case.keyword', ['case.builtInType', { sql: 'declare @x Int;\nselect cast(a as VarChar(10)) from t' }], 'case.builtInFunction',
      ['case.customFunction', { sql: 'select dbo.MyFunc(a), count(*) as N from t' }], 'case.identifier', 'case.alias',
    ],
  },
  {
    id: 'indents', tab: 'Tabs and Indents', name: 'Tabs and Indents',
    blurb: 'Indentation. By default the extension takes tab width and tabs-vs-spaces from the editor.',
    sql: SQL.indents,
    options: { queries: { common: { keepElementsUnderSectionHeader: true } } },
    settings: [
      ['indents.useEditorIndentation', { note: 'Applied by the editor, not the engine' }],
      'indents.useTabCharacter',
      ['indents.smartTabs', { demo: true, options: { indents: { useTabCharacter: true }, queries: { common: { keepElementsUnderSectionHeader: false } } }, sql: 'select alpha, beta from t' }],
      ['indents.tabSize', { demo: 8, sql: 'select alpha, beta from t', options: { indents: { useTabCharacter: true }, queries: { common: { keepElementsUnderSectionHeader: false } } } }],
      ['indents.indent', { demo: 2 }],
      ['indents.continuationIndent', { demo: 8, sql: 'select a from t where alpha = 1 and beta = 2', options: { wrapping: { rightMargin: 24 }, queries: { common: { keepElementsUnderSectionHeader: false } } } }],
      ['indents.keepIndentsOnEmptyLines', { sql: "begin\nprint 'a';\n\nprint 'b';\nend" }],
    ],
  },
  {
    id: 'wrapping', tab: 'Wrapping', name: 'Wrapping',
    blurb: 'What survives a reformat, and the column everything wraps against.',
    sql: SQL.wrapping,
    settings: [
      ['wrapping.rightMargin', { demo: 24, sql: 'select a from t where alpha = 1 and beta = 2' }],
      'wrapping.keepLineBreaks',
      ['wrapping.commentAtFirstColumn', { sql: "begin\n-- note\nprint 1;\nend" }],
    ],
  },
  {
    id: 'queries-common', tab: 'Queries', name: 'Queries › Common',
    blurb: 'Defaults every clause inherits. A clause set to "asInCommon" follows these.',
    sql: SQL.common,
    settings: [
      ['queries.common.alignFirstWordOfClause', { demo: 'toRight' }],
      'queries.common.placeClauseElementsOn',
      ['queries.common.placeComma', { demo: 'auto', sql: 'select a\n, b\n, c from t' }],
      ['queries.common.collapseShortStatements', { demo: 'enabled', sql: 'select a from t where id in (select id from u)' }],
      'queries.common.keepElementsUnderSectionHeader',
      'queries.common.alignSectionElements',
      ['queries.common.alignLineCommentsAtRightOfElements', { sql: 'select a, -- first\n bb, -- second\n ccc from t' }],
    ],
  },
  {
    id: 'queries-select', tab: 'Queries', name: 'Queries › Select',
    blurb: 'The SELECT list.', sql: SQL.select,
    settings: [
      ['queries.select.placeElementsOn', { demo: 'sameLine' }],
      ['queries.select.wrapElements', { demo: 'chopIfLong' }],
      ['queries.select.placeComma', { demo: 'toBegin' }],
      ['queries.select.newLineAfterAllDistinct', { sql: 'select distinct a, bb from t' }],
      ['queries.select.keepElementsOnOneLineIfUpTo', { demo: 3 }],
      ['queries.select.useAs', { sql: 'select a alpha, bb beta from t' }],
      'queries.select.alignAs',
    ],
  },
  {
    id: 'queries-from', tab: 'Queries', name: 'Queries › From',
    blurb: 'Tables and joins.', sql: SQL.from,
    settings: [
      ['queries.from.placeElementsOn', { demo: 'sameLine', sql: 'select a from dbo.alpha a, dbo.beta b, dbo.gamma c', options: NARROW30 }],
      ['queries.from.wrapElements', { demo: 'chop', sql: 'select a from dbo.alpha a, dbo.beta b, dbo.gamma c' }],
      ['queries.from.placeComma', { demo: 'toBegin', sql: 'select a from dbo.alpha a, dbo.beta b, dbo.gamma c', options: NARROW30 }],
      'queries.from.wrapFirstJoin', 'queries.from.wrapNextJoin', 'queries.from.indentJoin',
      ['queries.from.placeJoinInJoinOnlyQueriesUnder', { demo: 'from' }],
      'queries.from.alignJoinedTables', 'queries.from.alignTableAliases',
      'queries.from.wrapOnUsing',
      ['queries.from.placeOnUsingUnder', { demo: 'table', options: { queries: { from: { wrapOnUsing: true } } } }],
    ],
  },
  {
    id: 'queries-where', tab: 'Queries', name: 'Queries › Where',
    blurb: 'WHERE and HAVING predicates.', sql: SQL.where, options: NARROW30,
    settings: [
      ['queries.where.placeElementsOn', { demo: 'sameLine' }], ['queries.where.wrapElements', { demo: 'doNotChange' }],
      ['queries.where.placeTopLevelBooleanOperator', { demo: 'toEnd' }],
      ['queries.where.alignAs', { sql: 'select a from t where alpha = cast(x as int) and bb = cast(y as int)' }],
    ],
  },
  {
    id: 'queries-order', tab: 'Queries', name: 'Queries › Group By / Order By',
    blurb: 'GROUP BY and ORDER BY share one section.', sql: SQL.orderGroupBy,
    settings: [
      ['queries.orderGroupBy.placeElementsOn', { demo: 'sameLine', options: { queries: { orderGroupBy: { wrapElements: 'chop' } } } }],
      ['queries.orderGroupBy.wrapElements', { demo: 'chop' }],
      ['queries.orderGroupBy.placeComma', { demo: 'toBegin', options: { queries: { orderGroupBy: { wrapElements: 'chop' } } } }],
      ['queries.orderGroupBy.alignAscDesc', { options: { queries: { orderGroupBy: { wrapElements: 'chop' } } } }],
    ],
  },
  {
    id: 'queries-insert', tab: 'Queries', name: 'Queries › Insert',
    blurb: 'INSERT and its VALUES rows.', sql: 'insert into dbo.Target (alphaCol, betaCol, gammaCol) values (1, 2, 3)', options: NARROW30,
    settings: [
      'queries.insert.placeIntoOnNewLine', ['queries.insert.placeIntoClauseElementsOn', { demo: 'newLine', sql: 'insert into dbo.Target (alphaCol, betaCol) values (1, 2)' }],
      ['queries.insert.placeValuesRowsOn', { demo: 'sameLine', sql: 'insert into dbo.T (a, b) values (1, 2), (3, 4), (5, 6)', options: { queries: { insert: { collapseShortMultiRowValues: false } } } }],
      ['queries.insert.openingParenthesis', { demo: 'indented' }],
      ['queries.insert.elements', { demo: 'wrappedUnindented' }],
      ['queries.insert.closingParenthesis', { demo: 'underElements' }],
      ['queries.insert.wrapColumnsOrValues', { demo: 'chop', options: { wrapping: { rightMargin: 120 } } }],
      ['queries.insert.placeComma', { demo: 'toBegin' }],
      'queries.insert.spacesWithinParentheses',
      ['queries.insert.collapseShortMultiRowValues', { sql: 'insert into dbo.T (a, b) values (1, 2), (3, 4)', options: { wrapping: { rightMargin: 120 } } }],
      ['queries.insert.alignMultiRowValues', { sql: 'insert into dbo.T (a, b) values (1, 200), (30000, 4), (5, 60)', options: { queries: { insert: { collapseShortMultiRowValues: false } } } }],
    ],
  },
  {
    id: 'queries-update', tab: 'Queries', name: 'Queries › Update',
    blurb: 'The SET list of an UPDATE.', sql: SQL.update,
    settings: [
      ['queries.update.placeElementsOn', { demo: 'sameLine' }], ['queries.update.wrapElements', { demo: 'chopIfLong' }],
      ['queries.update.placeComma', { demo: 'toBegin' }],
      ['queries.update.alignEqualSign', { options: { queries: { update: { wrapElements: 'chop' } } } }],
    ],
  },
  {
    id: 'queries-with', tab: 'Queries', name: 'Queries › With',
    blurb: 'Common table expressions.', sql: 'with alpha as (select 1 as n), beta as (select 2 as n) select * from alpha', options: NARROW30,
    settings: [
      ['queries.with.placeElementsOn', { demo: 'sameLine' }], ['queries.with.wrapSubqueries', { demo: 'doNotChange' }],
      ['queries.with.placeComma', { demo: 'inTheMiddle', sql: 'with actor_info as (select first_name from actor), film_info as (select title from film) select * from actor_info', options: { wrapping: { rightMargin: 120 } } }],
      ['queries.with.alignAs', { sql: 'with alpha as (select 1 as n), betaLong as (select 2 as n) select * from alpha' }],
    ],
  },
  {
    id: 'queries-subquery', tab: 'Queries', name: 'Queries › Subquery',
    blurb: 'Parenthesised subqueries.', sql: SQL.subquery, options: NARROW,
    settings: [
      ['queries.subquery.openingParenthesis', { demo: 'indented' }],
      ['queries.subquery.elements', { demo: 'wrappedUnindented' }],
      ['queries.subquery.closingParenthesis', { demo: 'underElements' }],
      ['queries.subquery.spacesWithinParentheses', { sql: 'select a from t where id in (select id from u)', options: {} }],
    ],
  },
  {
    id: 'expressions', tab: 'Expressions', name: 'Expressions',
    blurb: 'Spacing inside expressions.', sql: SQL.expressions,
    options: { queries: { common: { placeClauseElementsOn: 'sameLine' } } },
    settings: [
      'expressions.spaceBeforeOpeningParenthesis', 'expressions.spacesWithinParentheses',
      ['expressions.placeCommaToBegin', { sql: 'select dbo.f(alpha, beta, gamma) from t', options: { wrapping: { rightMargin: 24 } } }],
      'expressions.spaceBeforeComma',
      'expressions.spaceAfterComma', 'expressions.spacesAroundOperators',
      ['expressions.alignOperandsInBinaryExpressions', { sql: 'select a from t where alpha = 1 and b = 2 and ccccc = 3', options: { wrapping: { rightMargin: 30 }, queries: { common: { placeClauseElementsOn: 'newLine' } } } }],
      ['expressions.spaceBetweenParenthesizedSubExpressions', { sql: 'select a from t where (x = 1 or y = 2) and z = 3' }],
    ],
  },
  {
    id: 'expressions-case', tab: 'Expressions', name: 'Expressions › Case',
    blurb: 'The CASE expression.', sql: SQL.caseClause, options: NARROW,
    settings: [
      'expressions.caseClause.wrapWhen', 'expressions.caseClause.indentWhenIfWrapped',
      'expressions.caseClause.wrapThen', 'expressions.caseClause.alignThen',
      ['expressions.caseClause.alignElseUnderThenWhenThenAligned', { options: { expressions: { caseClause: { alignThen: true } } } }],
      ['expressions.caseClause.alignEnd', { demo: 'withWhen' }],
      ['expressions.caseClause.keepNewLineAfterThenElse', { sql: 'select case when a = 1 then\n 111 else\n 3 end as x from t' }],
      ['expressions.caseClause.collapseShortClause', { sql: 'select case when a = 1 then 2 else 3 end as x from t', options: { wrapping: { rightMargin: 120 } } }],
    ],
  },
  {
    id: 'code-statements', tab: 'Code', name: 'Code › Statements',
    blurb: 'Statement separation.', sql: SQL.statements,
    settings: [
      ['code.statements.wrapEveryStatement', { sql: "print 'one'; print 'two';" }],
      ['code.statements.keepBlankLinesInCode', { demo: 0 }],
      'code.statements.newLineAroundSemicolon',
    ],
  },
  {
    id: 'code-variables', tab: 'Code', name: 'Code › Declared Variables',
    blurb: 'DECLARE sections.', sql: SQL.variables,
    settings: [
      'code.declaredVariables.wrapSection',
      ['code.declaredVariables.wrapVariables', { demo: 'chopIfLong' }],
      'code.declaredVariables.alignTypes',
      ['code.declaredVariables.alignAssignments', { options: { code: { declaredVariables: { alignTypes: true } } } }],
      ['code.declaredVariables.alignExpressions', { options: { code: { declaredVariables: { alignTypes: true } } } }],
    ],
  },
  {
    id: 'code-routine', tab: 'Code', name: 'Code › Routine Arguments',
    blurb: 'Parameter lists of procedures and functions.', sql: 'create function dbo.fnRate (@alpha int, @beta nvarchar(50)) returns int as begin return 1; end', options: { wrapping: { rightMargin: 46 } },
    settings: [
      ['code.routineArguments.openingParenthesis', { demo: 'indented' }],
      ['code.routineArguments.elements', { demo: 'wrappedUnindented' }],
      ['code.routineArguments.closingParenthesis', { demo: 'underElements' }],
      ['code.routineArguments.wrapElements', { demo: 'chop', sql: SQL.routine, options: { wrapping: { rightMargin: 90 } } }],
      ['code.routineArguments.placeComma', { demo: 'toBegin', sql: SQL.routine, options: { wrapping: { rightMargin: 60 } } }],
      ['code.routineArguments.newLineAfterComma', { sql: SQL.routine, options: { wrapping: { rightMargin: 60 } } }],
      'code.routineArguments.spacesWithinParentheses',
    ],
  },
  {
    id: 'code-block', tab: 'Code', name: 'Code › Blocks',
    blurb: 'IF, BEGIN and END.', sql: SQL.block,
    settings: [
      ['code.block.wrapThen', { sql: 'if x > 0 then raise notice 1; end if;', options: { dialect: 'postgresql' } }],
      'code.block.wrapElse', 'code.block.wrapInnerCode',
      'code.block.indentThenAndElse', 'code.block.indentEnd',
      ['code.block.collapseWhenShort', { sql: "if @x > 0 begin print 'a'; end" }],
    ],
  },
  {
    id: 'code-loops', tab: 'Code', name: 'Code › Loops',
    blurb: 'Loop bodies.', sql: 'while i < 10 loop raise notice 1; end loop;', options: { dialect: 'postgresql' },
    settings: [
      'code.loops.wrapLoop',
      ['code.loops.indentLoop', { options: { dialect: 'postgresql', code: { loops: { wrapLoop: true } } } }],
      'code.loops.indentEndLoop', 'code.loops.collapseWhenShort',
    ],
  },
  {
    id: 'ddl', tab: 'DDL', name: 'DDL',
    blurb: 'CREATE and ALTER.', sql: SQL.ddl, options: NARROW,
    settings: [
      ['ddl.openingParenthesis', { demo: 'indented' }],
      ['ddl.elements', { demo: 'wrappedUnindented' }],
      ['ddl.closingParenthesis', { demo: 'underElements' }],
      ['ddl.spacesWithinParentheses', { sql: 'create table dbo.T (a int, b int)', options: { wrapping: { rightMargin: 120 } } }],
      'ddl.alignTypes', 'ddl.alignDefaults', 'ddl.alignNullabilities',
      ['ddl.collapseWhenShort', { sql: 'create table dbo.T (a int, b int)', options: { wrapping: { rightMargin: 120 } } }],
      ['ddl.wrapAlterInstructions', { sql: 'alter table dbo.T add alpha int null, beta int null' }],
      ['ddl.alignAlterInstructions', { sql: 'alter table dbo.T add alpha int null, beta int null' }],
    ],
  },
  {
    id: 'ddl-constraints', tab: 'DDL', name: 'DDL › Constraints',
    blurb: 'Table constraints.', sql: SQL.ddlConstraint, options: { wrapping: { rightMargin: 70 } },
    settings: [
      'ddl.constraints.wrapConstraint', 'ddl.constraints.wrapKeyCheck',
      'ddl.constraints.wrapReferences', 'ddl.constraints.wrapCascadeAndDeferrability',
    ],
  },
  {
    id: 'ddl-schema', tab: 'DDL', name: 'DDL › Schema',
    blurb: 'Declarations and the space between them.',
    sql: 'create table dbo.A (id int);\ncreate table dbo.B (id int);\n\n\n\ncreate table dbo.C (id int);',
    settings: [
      ['ddl.schema.indentContent', { sql: 'create schema reporting\ncreate table Widget (id int)\ncreate table Gadget (id int);' }],
      ['ddl.schema.minBlankLinesBetweenDeclarations', { demo: 1 }],
      ['ddl.schema.maxBlankLinesBetweenDeclarations', { demo: 0 }],
    ],
  },
  {
    id: 'ddl-view', tab: 'DDL', name: 'DDL › Views',
    blurb: 'View definitions.', sql: SQL.ddlView,
    settings: ['ddl.view.wrapAs', 'ddl.view.wrapQueryBeginning', 'ddl.view.indentQuery'],
  },
  {
    id: 'ddl-postfix', tab: 'DDL', name: 'DDL › Postfix Options',
    blurb: 'Trailing storage and index options.', sql: 'create table dbo.T (Id int) with (data_compression = page, fillfactor = 80)', options: { wrapping: { rightMargin: 50 } },
    settings: [
      ['ddl.postfix.wrapFirstOption', { options: { wrapping: { rightMargin: 90 } } }],
      ['ddl.postfix.wrapNextOption', { options: { wrapping: { rightMargin: 50 } } }],
      'ddl.postfix.indentOptions', 'ddl.postfix.alignOptions',
    ],
  },
];

module.exports = { GROUPS };
