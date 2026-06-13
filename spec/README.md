# Product specs

Behaviour-first product specs in Gherkin `.feature` files. This directory is the
source of truth for **what the product does**, independent of implementation.
There is **no Cucumber runner** — the `.feature` files are documentation, and tests
trace back to scenarios by id.

## Convention

- One `.feature` file per capability (`onboarding.feature`, `auth.feature`, …).
- Each scenario carries two tags: the **id** `@<capability>/<slug>` and the **layer**
  that proves it (`@domain` / `@usecase` / `@web` / `@api` / `@e2e`):

  ```gherkin
  @library/save-resource @web
  Scenario: Saving an unsaved item marks it as saved
    Given an authenticated user and an item not in their library
    When they save the item
    Then the item is listed as saved
  ```

- The id never changes once written (rename = new id).
- Verify each scenario at the **cheapest layer that can prove it** — most land in
  usecase/web/api; reserve `@e2e` for genuinely cross-stack, hermetic journeys.
  BDD-lite must not turn every scenario into a slow E2E.

## Traceability

Each scenario's home test carries `[spec: <id>]` in its name, so you can trace a
scenario to the test that proves it (and back):

```ts
it('saving an unsaved item marks it saved [spec: library/save-resource]', …)
```

## Escalation

If a non-technical audience ever needs to *run* the Gherkin, wire `playwright-bdd`
(compiles `.feature` → Playwright, keeps the native runner). These are already real
`.feature` files, so that step is drop-in — no rewrite.
