# Product specs

Behaviour-first product specs in Gherkin prose. This directory is the source of
truth for **what the product does**, independent of implementation. It is plain
Markdown — there is no Cucumber runner; tests trace back to scenarios by ID.

## Convention

- One file per capability (`onboarding.md`, `auth.md`, `library.md`, …).
- Each scenario is a heading with a stable backtick-wrapped ID:

  ```
  ### `library/save-resource`
  One-line behaviour summary.

  - **Given** …
  - **When** …
  - **Then** …

  _Verified at: web_
  ```

- The ID is `<capability>/<slug>` and never changes once written (rename = new ID).
- `_Verified at:_` names the cheapest layer that proves it: `domain`, `usecase`,
  `web`, `api`, or `e2e`. A product scenario is verified at the cheapest layer that
  can — NOT everything becomes a slow E2E.

## Traceability

Every scenario's home test carries `[spec: <id>]` in its name, e.g.

```ts
it('saving an unsaved item marks it saved [spec: library/save-resource]', …)
```

`spec/spec-coverage.test.ts` parses every scenario ID here and fails if any has no
matching test — so the spec can't silently drift from the suite (the "living
documentation" guarantee, without the Cucumber tax).

If a non-technical audience ever needs to *run* the Gherkin, the escalation path is
`playwright-bdd` (compiles `.feature` → Playwright, keeps the native runner) — these
prose specs already use Gherkin wording, so the migration is mechanical.
