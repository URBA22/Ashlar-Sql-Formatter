## What this changes

<!-- One or two sentences. Link the issue it fixes: "Fixes #12". -->

## Formatting change

<!--
Delete this section for changes that cannot alter output (docs, CI, refactors).
Otherwise show the difference, so a reviewer can see the intent at a glance.
-->

Input:

```sql

```

Before / after:

```sql

```

## Checklist

- [ ] `npm test` passes.
- [ ] `npm run build:page` succeeds — it fails if a new setting is missing from
      a style-page group or demonstrates a value equal to its default.
- [ ] A bug fix adds its SQL to the regressions section of `test/corpus.ts`, so
      token preservation and idempotence cover it from now on.
- [ ] A new setting or enum value is registered in `package.json`, defaulted in
      `src/formatter/options.ts`, and added to `tools/style-page/`.
- [ ] A new setting's default keeps existing output unchanged.
