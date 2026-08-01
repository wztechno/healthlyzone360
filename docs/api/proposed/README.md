# Proposed API contracts — DRAFT, NOT IMPLEMENTED

**Status: DRAFT.** Nothing described here is implemented. No Laravel route, controller, migration or
test exists behind any of these documents, and none is planned as part of the current phase.

These are design artefacts produced alongside the UI prototype (Prompt 2). They exist so that the
prototype's screens can be reviewed against a concrete wire contract, and so that whoever
implements the backend inherits a proposal to argue with rather than a blank page.

## What is authoritative, and what is not

| Document | Status | Authority |
|---|---|---|
| `apps/api/openapi/healthy360.v1.yaml` | Implemented | The contract of record (ADR-0005). Generates `packages/api-client/src/generated/**` |
| `docs/api/conventions.md` | Implemented | The conventions every endpoint follows, drafted or not |
| `docs/api/proposed/*.v1.draft.yaml` | **Draft** | A proposal. Binding on nobody |

Every draft carries `info.x-status: draft`, and every `info.description` opens with the same
warning. A parity test — `packages/api-client/src/contracts/proposed-drafts.test.ts` — asserts that
the marker is present, that every promised path appears, and that every operation has an
`operationId`.

## Why these are separate from the implemented contract

`scripts/gen-api.mjs` reads `apps/api/openapi/dist/healthy360.v1.yaml` and nothing else, and
`.github/workflows/backend.yml` lints `apps/api/openapi/healthy360.v1.yaml` with
`apps/api/openapi/redocly.yaml`. Neither reaches this directory, and this directory has its own
`redocly.yaml`. That separation is the point: a draft must never be able to change the generated
client, and a generated client must never make a draft look implemented.

## Linting

```
pnpm run api:lint:proposed
```

Runs `@redocly/cli lint` over all six drafts with `docs/api/proposed/redocly.yaml`. It is held to
the same blocking rules as the implemented contract: `struct`, `operation-operationId`,
`operation-operationId-unique`, `operation-4xx-response`, `operation-summary`, `path-params-defined`,
`security-defined` and `no-unused-components`. Zero errors is the standard.

To render one for reading:

```
npx --yes @redocly/cli preview-docs docs/api/proposed/marketplace.v1.draft.yaml --config docs/api/proposed/redocly.yaml
```

## Layout

| File | Covers | Paths / operations |
|---|---|---|
| `_shared/schemas.yaml` | Envelopes, error vocabulary, headers, pagination and the shared nutrition schemas. Not an API; deliberately absent from the `apis` map | — |
| `nutrition.v1.draft.yaml` | Calculating, storing and reviewing nutrition targets | 2 / 3 |
| `virtual-dietitian.v1.draft.yaml` | The guided interview, its draft plan and its escalation to a human | 4 / 4 |
| `marketplace.v1.draft.yaml` | Public kitchen, meal and meal-plan discovery | 6 / 6 |
| `meal-plans.v1.draft.yaml` | Generation, regeneration, locking, replacement, portions | 10 / 11 |
| `foods-recipes.v1.draft.yaml` | Food search, recipes, grocery list, pantry | 5 / 5 |
| `commerce.v1.draft.yaml` | Cart, priced previews, subscription lifecycle | 8 / 8 |
| **Total** | | **35 / 37** |

Each draft names its TypeScript counterpart in `packages/api-client/src/contracts/`. The two are
maintained together: the repository interface is what the screens compile against, and the draft is
what a backend implementer reads.

## Conventions these drafts follow

Everything in `docs/api/conventions.md` applies unchanged:

- `/api/v1/` prefix; additive changes only within a major version.
- Success is `{"data": …, "meta": {…}}`; failure is
  `{"error": {"code", "message", "details", "correlation_id"}}`.
- `meta.correlation_id` on every success; `X-Correlation-Id` on every response.
- Errors use only codes that already exist in `Healthy360\Support\Api\ErrorCode`. **No draft
  proposes a new error code**: adding one is a separate decision, taken against the implemented
  vocabulary rather than smuggled in through a design document.
- Collections paginate by opaque cursor, returned in `meta.next_cursor`. Cursors rather than page
  numbers because the marketplace and the planner both list data that changes while it is being
  scrolled, and offset pagination silently repeats and skips rows when that happens.

## Deliberate absences

These are decisions, not omissions:

- **No payment endpoint anywhere.** `commerce.v1.draft.yaml` previews prices and stops. There is no
  `confirmCheckout`, and no operation accepts a card, a token or a payment-provider reference. An
  endpoint that *could* take a payment is one somebody eventually wires to a live gateway by
  accident.
- **No B2B price in any consumer-facing schema.** Negotiated prices, volume tiers and minimum order
  quantities have no representation in `marketplace.v1.draft.yaml`. A consumer screen cannot leak a
  field that does not exist.
- **No language-model endpoint.** The Virtual Dietitian contract is shaped so that connecting one
  later changes nothing above the repository boundary, but no such integration is proposed here.
- **No new error codes**, as above.

## On the nutrition figures

The nutrition draft returns `prototype: true` on every result, together with the method used, an
echo of the inputs, and a step-by-step explanation citing the published equations
(Mifflin–St Jeor 1990; Katch–McArdle; the FAO/WHO/UNU activity bands; the Institute of Medicine DRI
fibre guidance; the Atwater factors). No reference product's formula is claimed or reproduced: the
internal algorithm of any such product is not publicly observable, and none was inferred. The
figures are not medical advice, and the contract carries a disclaimer field that is never optional.
