# ADR-0013 — API-only repositories and build-time feature availability

## Status

Accepted — 2026-08-11. Supersedes ADR-0011.

## Context

ADR-0011 established the repository boundary with the mock as a permanent, strictly contained
first-class implementation, defended by four gates. That containment held — by 2026-08 the mock was
test-only (D-085), the product ran against the Laravel API, and the marketplace's fixture meals had
been ported into the seeders. What remained of the mock was ~26K lines of fixture world whose only
consumers were the Jest harness, the default Playwright projects, and a development banner — plus
five whole repository families (planner, nutrition, foods, virtual dietitian, professional) that
existed *only* as fixtures, rendered to users as honest-but-dead "not built yet" surfaces.

Maintaining two implementations of a 238-method surface purely for tests stopped paying for itself,
and showing users controls that can only apologise stopped being honest.

## Decision

- **The mock implementation is deleted.** The repository *contract* boundary stays exactly as
  ADR-0011 drew it — screens reach data only through hooks over the `Repositories` interface — but
  the interface now has one implementation. The contract surface is recorded as data in
  `packages/api-client/src/contracts/repository-surface.ts` (compile-checked against the contracts,
  runtime-checked against the api bundle), which feeds the test stub factory and the drift check.
- **`api/prototype-repositories.ts` remains as the dead-man's switch**: every contract family with
  no backend still resolves to a stub that rejects with `prototype.not_implemented`, naming the
  endpoint it would have called. A hidden screen that is ever reached fails honestly rather than
  rendering fiction.
- **Features without a backend are hidden, not apologised for.**
  `apps/universal/src/features/availability.ts` is the single source of truth: a build-time map
  consumed by the area shell, the two route-group layouts, navigation tables, tiles, footers and
  in-screen buttons. A key flips to `true` on the day its endpoints land — the same day its
  `prototype-repositories.ts` stubs are replaced. It is deliberately **not** `MODE_ROUTE_AREAS`
  (a packaging question, and `packages/permissions` stays backend-agnostic), **not**
  `Repositories.kind` (always `'api'` now — a branch on it is an unconditional branch in disguise),
  and **not** a runtime probe (a probed control flashes and vanishes, and the set only changes with
  a code change anyway).
- **Hidden routes redirect rather than 404.** A person typing `/customer/planner` lands on the
  customer home with the URL replaced — a 404 on a path that was live in the last preview build
  reads as breakage and advertises the removal.
- **Tests run against the real thing.** Jest screens render against typed stubs built from the
  surface table (`apps/universal/src/testing/stub-repositories.ts`); every Playwright project runs
  the api-mode export against the seeded Laravel stack. The seeded demo world carries the ported
  fixture kitchens, plans and meals, so the photographed marketplace survives the mock.

Of ADR-0011's four gates, one survives with its meaning inverted: production still refuses to boot
without a real API base URL (`MissingApiBaseUrlError`). The other three defended against a mock
that no longer exists.

## Consequences

- One implementation per contract method: adding an endpoint touches interface, api repository and
  the surface table — no fixture mirror to keep honest.
- The Jest layer gets thinner: per-test stubs assert that a screen handles the data it was handed,
  where the fixture world asserted behaviour a real state machine produced. The compensation is
  that every e2e project now exercises real HTTP against real Postgres.
- The e2e suite depends on a running stack; the specs probe it and skip with instructions when it
  is down, and CI provisions it per run.
- Un-hiding a feature is a deliberate, reviewable act: implement the endpoints, replace the stubs,
  flip the availability key, restore the tests from history — in that order.

## Review trigger

Re-examine when the first hidden family (likely nutrition or the dietitian directory) gains real
endpoints, to confirm the flip-the-key path works as designed — or if screen tests start missing
regressions the fixture world would have caught, which would argue for contract-level test doubles
richer than per-suite stubs.
