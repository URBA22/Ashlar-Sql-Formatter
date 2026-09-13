/**
 * Representative SQL used by the property tests. Everything here must survive
 * formatting with its token stream intact and must format identically on a
 * second pass.
 */
export const TSQL_CORPUS: string[] = [
    `select 1;`,
    `SELECT a.id, a.name, b.total FROM dbo.orders a INNER JOIN dbo.order_lines b ON b.order_id = a.id WHERE a.status = 'open' AND a.created_at >= '2024-01-01' ORDER BY a.id DESC;`,
    `declare @x int = 5; set @y = @x + 1; print 'hello';`,
    `select id, case when status=1 then 'new' when status=2 then 'done' else 'unknown' end as label, count(*) as n from dbo.tickets group by id, status having count(*)>3;`,
    `if @x > 0 print 'pos' else print 'neg';`,
    `if not exists (select 1 from dbo.t where id=@id) begin insert into dbo.t (id) values (@id); end else begin update dbo.t set seen = 1 where id = @id; end`,
    `begin try insert into dbo.t (a,b) values (1,2); end try begin catch print error_message(); end catch`,
    `with cte as (select id, name from dbo.people where active=1) select c.id, c.name from cte c;`,
    `select * from t1 -- trailing note\nwhere x = 1 /* inline */ and y = 2;`,
    `select n'unicode ''quoted''' as s, [weird column], 0x1F, -1, a.* from [dbo].[My Table] t (nolock);`,
    `select a from t1 union all select a from t2 union select a from t3 order by a;`,
    `select p.id, (select count(*) from dbo.orders o where o.person_id = p.id and o.total > 100 and o.created_at > '2024-01-01') as order_count from dbo.people p;`,
    `select id, row_number() over (partition by dept_id order by salary desc) as rn from dbo.employees;`,
    `create table dbo.Widget (Id int identity(1,1) not null primary key, Name nvarchar(200) not null, Price decimal(18,2) null, CreatedAt datetime2 not null default sysutcdatetime());`,
    `merge dbo.Target as t using dbo.Source as s on t.id = s.id when matched then update set t.val = s.val when not matched then insert (id, val) values (s.id, s.val);`,
    `select * from dbo.t where id in (1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33);`,
    `select case when a = 1 then case when b = 1 then 'x' else 'y' end else 'z' end as nested from dbo.t;`,
    `select 1;\ngo\nselect 2;\ngo`,
    `update dbo.Inventory set Quantity = Quantity - @taken, UpdatedAt = sysutcdatetime() output inserted.Id, deleted.Quantity where WarehouseId = @wh and Quantity >= @taken;`,
    `delete from dbo.Log where CreatedAt < dateadd(day, -30, getutcdate());`,
    `exec dbo.usp_DoThing @a = 1, @b = N'two', @c = @someVar output;`,
    `select top (10) percent Name from dbo.Customer order by newid();`,
    `select convert(varchar(10), getdate(), 120) as d, cast(x as int) as i, isnull(y, 0) as z from dbo.t;`,
    `/* leading block\n   comment */\nselect 1;`,
    `select a\n\n\nfrom t;`,
    `select b.x from a join b on a.id=b.id left outer join c on c.id=b.id cross apply dbo.fn(b.x) f;`,
    `declare @t table (id int, name nvarchar(50)); insert into @t (id, name) values (1, 'a'), (2, 'b');`,
    `select x from t where a between 1 and 10 and b between 20 and 30;`,
    `select -1 + -2 as a, 3 - 4 as b, -x.y as c from t x;`,
    // --- regressions -------------------------------------------------------
    `create table dbo.T (\n-- internal columns\nId decimal(9) not null, -- surrogate\nKind char(1) not null\n);`,
    `declare\n-- locals\n@a int = 1,\n@bbbb nvarchar(50) = 'x';`,
    `select dbo.fn(alpha, beta, gamma) from t;`,
    `select a, (select max(x) from u where u.id = t.id) as m from t;`,
    `with alpha as (select 1 as n), beta as (select 2 as n) select * from alpha;`,
    `grant select on dbo.T to reader;`,
    `set nocount on; set xact_abort on;`,
    `create index IX_a on dbo.T (a, b);`,
    `merge dbo.A as a using dbo.B as b on a.id = b.id when matched then update set a.v = b.v when not matched then insert (id, val) values (b.id, b.v) when not matched by source then delete;`,
    `begin update dbo.t set seen = 1 where id = @id; end`,
    `insert into dbo.T (a, b) select x, y from dbo.S where z = 1;`,
    `select a -- why\nfrom t;`,
    `create procedure dbo.usp_Get @CustomerId int, @FromDate date = null as\nbegin\nset nocount on;\ndeclare @Now datetime2 = sysutcdatetime();\nif @FromDate is null set @FromDate = dateadd(month, -3, @Now);\n;with recent as (\nselect o.OrderId, sum(ol.Quantity * ol.UnitPrice) as LineTotal from dbo.Orders o inner join dbo.OrderLines ol on ol.OrderId = o.OrderId where o.CustomerId = @CustomerId group by o.OrderId\n)\nselect r.OrderId, case when r.LineTotal >= 1000 then 'large' else 'small' end as Bucket, rank() over (order by r.LineTotal desc) as Ranking from recent r where r.LineTotal > 0 order by r.LineTotal desc;\nend\ngo`,
];

export const POSTGRES_CORPUS: string[] = [
    `select id::text, name from public."User" where created_at > now() - interval '7 days';`,
    `insert into t (a) values ($1) on conflict (a) do nothing returning id;`,
    `select $$dollar 'quoted' string$$ as s;`,
    `select array_agg(x order by x) from generate_series(1, 10) as g(x);`,
];

export const MYSQL_CORPUS: string[] = [
    "select `weird col`, a from `db`.`tbl` where a = 'x' # hash comment\n;",
    `select group_concat(name separator ', ') from users where id in (1,2,3);`,
    `select 'back\\\\slash \\' escaped' as s;`,
];
