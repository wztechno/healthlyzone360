# @healthy360/testing

Shared test scaffolding for the frontend workspace: `makeAccessState()` (re-exported from
`@healthy360/permissions/testing`, which physically owns it so the guard kernel's own suite can use
it without creating a dependency cycle) plus deterministic fixture factories for every foundation
domain shape — `makeSessionUser`, `makeProfile`, `makeOrganisation`, `makeBranch`, `makeMembership`,
`makeDevice`, `makeActiveContext`. Every fixture uses fixed UUIDv7-shaped identifiers and fixed
timestamps: no randomness, no `Date.now()`, so a failing assertion is reproducible from its message
alone. `@healthy360/testing/vitest` exports `createPackageVitestConfig()`, the one place the
node-environment Vitest defaults for pure-TypeScript packages are written down. React Native render
helpers are deliberately absent — RNTL runs under jest-expo, not Vitest, and those helpers arrive
with the design system in Phase 5b.
