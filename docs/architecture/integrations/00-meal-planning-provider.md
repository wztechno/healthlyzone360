# 00 — MealPlanningProvider: a provider-neutral contract

**Status:** Design documentation. **Not implemented.**
**Date:** 2026-07-30
**Related research:** `docs/reference-research/16-api-integration-options.md`
**Provider specifics:** `01-eat-this-much-provider.md`

> **This document contains no importable code.** The PHP shown is illustrative pseudocode written to
> communicate shape and intent. It is deliberately incomplete, lives only in this Markdown file, and
> must not be copied into the codebase as-is. No provider is implemented in this phase.

## 1. Purpose

Meal-plan generation is a capability our platform must own, and may optionally accelerate with a
third party for one bounded slice of the problem. The purpose of this contract is to make that
choice a **configuration decision rather than an architectural one**, and to ensure that adopting a
provider never leaks the provider's shape, identifiers, taxonomy or availability into our domain.

Two implementations are contemplated:

| Implementation | Status | Scope |
| --- | --- | --- |
| `InternalMealPlanningProvider` | **The default and the only enabled provider** | All generation: kitchen-delivered and home-prepared |
| `EatThisMuchPartnerProvider` | **Disabled by default. Documentation only in this phase** | Home-prepared recipe planning only, if ever adopted |

The research concluded (doc 16 §6) that the internal engine is the strategically correct primary,
because five of our defining capabilities — kitchen-prepared marketplace meals, delivery zones and
schedules, sales-channel rules, our six restriction kinds, and clinician-enforced restrictions
outranking preference — cannot be served by any external provider.

## 2. Non-negotiable policies

Every one is a requirement on any implementation of this contract.

| # | Policy | Rationale |
| --- | --- | --- |
| POL-01 | **Disabled by default.** No provider other than the internal one is active unless explicitly enabled by deployment configuration | A provider must never activate by accident |
| POL-02 | **Environment-based credentials.** Credentials come only from server-side environment configuration. They are never committed, never defaulted, never logged | Doc 16, TRM-07 |
| POL-03 | **Credentials never reach the frontend.** No token, key or username is serialised into any response, page payload, error message or client-visible configuration | The frontend is a universal application; anything it receives is public |
| POL-04 | **Laravel only.** All provider interaction happens server-side in the API application. There is no TypeScript provider client, and none may be written | A client-side implementation would place credentials in reach of the client by construction |
| POL-05 | **Respect contract restrictions.** Retention, caching, attribution and display obligations from the executed contract are enforced in code, not by convention | Doc 16, TRM-05, TRM-06 |
| POL-06 | **Timeouts.** Every provider call carries an explicit connect timeout and an explicit total timeout. There is no unbounded wait | A slow provider must not become a slow product |
| POL-07 | **Rate-limit handling.** Rate-limit responses are recognised, respected and never retried immediately or indefinitely | Doc 16, TRM-08 |
| POL-08 | **Circuit breaking.** Repeated failures open a circuit that fails fast until a cool-down elapses | Protects our latency and the provider's service |
| POL-09 | **Correlation identifiers.** Every call carries our correlation identifier, and any provider-returned identifier is retained for support | Cross-boundary debugging is otherwise guesswork |
| POL-10 | **No permanent storage where prohibited.** Provider data subject to a retention or cache limitation is stored with an explicit expiry and is purged on partnership termination | Doc 16, RSK-01 |
| POL-11 | **External identifiers are mapped, never adopted.** A provider identifier is stored in a mapping table and never becomes a primary key or a domain identifier | Doc 16, RSK-03, RSK-05 |
| POL-12 | **Provider data stays separate from internally owned data**, at the database, model and serialisation layers. The two are never merged into one entity | Doc 16, RSK-01, RSK-03 |
| POL-13 | **Log safe metadata only.** Provider name, operation, duration, outcome, status class, correlation identifiers, counts. **Never** credentials, request bodies, user-identifying content, or returned recipe or nutrition content | Doc 14, CND and privacy obligations |
| POL-14 | **Fall back only per explicit policy.** Fallback is configured per operation and per failure class. There is no implicit fallback | An unplanned fallback silently changes what the user receives |
| POL-15 | **Never silently change providers.** Any switch is explicit, recorded on the result, logged, and visible to the user where it affects what they see | Doc 16, POS-07 |
| POL-16 | **No live call without approved credentials.** No implementation, test or exploratory call is made against a provider API before a contract is executed and credentials provisioned | Doc 16, POS-03 |

## 3. Contract shape

Illustrative pseudocode. Not importable.

```php
<?php
// PSEUDOCODE — illustrative only. Not implemented. Do not copy into the codebase.

interface MealPlanningProvider
{
    public function identifier(): string;          // 'internal' | 'eat_this_much'
    public function isEnabled(): bool;             // POL-01
    public function capabilities(): CapabilitySet; // what this provider can actually do

    public function generateDay(GenerateDayRequest $request): ProviderResult;
    public function generateWeek(GenerateWeekRequest $request): ProviderResult;
    public function regenerateEntry(RegenerateEntryRequest $request): ProviderResult;
    public function buildGroceryList(GroceryListRequest $request): ProviderResult;
}
```

### 3.1 Capability negotiation

A provider declares what it can do. The application asks before dispatching, and never assumes.

```php
<?php
// PSEUDOCODE

final class CapabilitySet
{
    public bool $supportsKitchenMeals;          // EatThisMuch: false
    public bool $supportsDeliveryZones;         // EatThisMuch: false
    public bool $supportsSalesChannelRules;     // EatThisMuch: false
    public bool $supportsEnforcedRestrictions;  // EatThisMuch: false
    public bool $supportsHomePreparedRecipes;   // EatThisMuch: true
    public bool $supportsGroceryAggregation;    // EatThisMuch: true
    public bool $supportsExplainableScoring;    // EatThisMuch: false
    public int  $maxDaysPerRequest;
}
```

**This is the mechanism that keeps the internal engine primary.** A request touching kitchen meals,
delivery zones, sales-channel rules or enforced restrictions is not routable to a provider that
declares those capabilities false. Routing is a capability match, not a preference.

### 3.2 Request and result

```php
<?php
// PSEUDOCODE

final class GenerateDayRequest
{
    public UserId          $userId;          // internal identifier; never sent to a provider
    public CorrelationId   $correlationId;   // POL-09
    public NutritionTarget $target;
    public MealLayout      $layout;
    public HardConstraints $hardConstraints; // allergies, enforced restrictions, diet class
    public SoftPreferences $softPreferences; // cuisine, dislikes, variety, cost, pantry
    public PlanScope       $scope;           // home_prepared | kitchen_delivered | mixed
}

final class ProviderResult
{
    public string          $providerIdentifier;   // POL-15 — always recorded on the result
    public bool            $isFallback;           // POL-14 — true only under explicit policy
    public ?string         $providerCorrelationId;// POL-09
    public ProviderOrigin  $origin;               // 'internally_owned' | 'externally_sourced'
    public ?CarbonImmutable $retainUntil;         // POL-10 — null only for internally owned data
    public array           $entries;              // domain objects, already translated
    public ?FailureReason  $failure;
}
```

**`$origin` and `$retainUntil` are the two fields that make POL-10 and POL-12 enforceable.** Every
result declares whether it is ours or borrowed, and borrowed data declares when it must be gone.

### 3.3 Translation boundary

A provider never returns our domain objects. It returns its own shape, and a translator converts it.

```php
<?php
// PSEUDOCODE

interface ProviderTranslator
{
    // Provider payload -> our domain objects. Unmappable concepts are dropped, never guessed.
    public function toDomain(array $providerPayload, CorrelationId $correlationId): array;

    // Our identifiers -> provider identifiers, via the mapping table. Never the reverse-by-adoption.
    public function mapExternalReference(string $externalId): ExternalReference; // POL-11
}
```

The translator is where the provider's diet taxonomy, meal types and nutrient model are converted
into ours — and where anything with no equivalent in our model is **dropped rather than
approximated**. Approximation is how a third party's semantics quietly become ours (POL-05, RSK-05).

## 4. Request sequence

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant App as Universal app
    participant API as Laravel API
    participant Reg as ProviderRegistry
    participant Int as InternalMealPlanningProvider
    participant CB as CircuitBreaker
    participant Ext as EatThisMuchPartnerProvider
    participant ETM as Eat This Much API

    User->>App: Generate my week
    App->>API: POST /api/v1/meal-plans/generate
    Note over App,API: The app never names a provider.<br/>Provider choice is server-side only.

    API->>Reg: resolve(request, scope)
    Reg->>Reg: match required capabilities
    alt scope needs kitchen meals, zones,<br/>channel rules or enforced restrictions
        Reg-->>API: InternalMealPlanningProvider (only capable provider)
    else home-prepared only, and partner enabled
        Reg->>CB: state for 'eat_this_much'
        alt circuit open
            CB-->>Reg: OPEN — fail fast
            Reg-->>API: internal, per explicit fallback policy (POL-14)
        else circuit closed
            CB-->>Reg: CLOSED
            Reg-->>API: EatThisMuchPartnerProvider
        end
    end

    alt internal provider selected
        API->>Int: generateWeek(request)
        Int-->>API: ProviderResult(origin=internally_owned, retainUntil=null)
    else partner provider selected
        API->>Ext: generateWeek(request)
        Ext->>Ext: load credentials from environment (POL-02, POL-03)
        Ext->>ETM: request + our correlation id, explicit timeouts (POL-06, POL-09)
        alt success
            ETM-->>Ext: provider payload + provider correlation id
            Ext->>Ext: translate; map external ids (POL-11)
            Ext->>Ext: stamp origin=externally_sourced, retainUntil per contract (POL-10)
            Ext-->>API: ProviderResult
        else rate limited
            ETM-->>Ext: rate-limit response
            Ext->>CB: record throttle (POL-07)
            Ext-->>API: FailureReason(rate_limited) — no immediate retry
        else timeout or error
            Ext->>CB: record failure (POL-08)
            Ext-->>API: FailureReason(unavailable)
        end
    end

    opt failure and explicit fallback configured for this operation
        API->>Int: generateWeek(request)
        Int-->>API: ProviderResult(isFallback=true)
        Note over API: Recorded and logged.<br/>Never silent (POL-14, POL-15).
    end

    API->>API: persist; provider data stored separately (POL-12)
    API->>API: log safe metadata only (POL-13)
    API-->>App: plan + provider attribution + fallback indicator
    App-->>User: plan, with provenance shown where it affects what they see
```

## 5. Failure policy

| Failure class | Behaviour | Fallback |
| --- | --- | --- |
| Provider disabled | Never selected | n/a — internal handles everything |
| Capability mismatch | Never selected; not a failure | n/a |
| Circuit open | Fail fast, no call attempted | Per explicit policy only |
| Connect or total timeout | Abort, record failure, open circuit on threshold | Per explicit policy only |
| Rate limited | Respect the signal; no immediate retry; back off | Per explicit policy only |
| Authentication failure | **Disable the provider and raise an operational alert.** Never retry with different credentials | Internal, and the incident is surfaced |
| Malformed or untranslatable payload | Reject the result. **Do not partially adopt it** | Per explicit policy only |
| Partial result | Reject unless the operation explicitly permits partial results | Per explicit policy only |

**A failed provider call never degrades silently into a worse plan.** Either an explicit fallback
policy applies and the result is marked as a fallback, or the operation fails visibly.

## 6. Data separation

| Concern | Requirement |
| --- | --- |
| Storage | Externally sourced entities live in their own tables, never mixed into internally owned entities |
| Identity | Provider identifiers live in a mapping table keyed by our own identifier. A provider identifier is never a primary key (POL-11) |
| Retention | Externally sourced rows carry an expiry. A scheduled purge enforces it. Termination triggers a full purge (POL-10) |
| Serialisation | API responses mark externally sourced data explicitly so the frontend can attribute it |
| Aggregation | A nutrition total mixing internal and external sources records both origins |
| Backup | Retention obligations apply to backups. This is a legal review item (`LR-03`) |

## 7. Observability

Logged for every call: provider identifier, operation, our correlation identifier, provider
correlation identifier, duration, outcome class, status class, retry count, circuit state, result
counts, fallback flag.

**Never logged:** credentials or any part of them; request or response bodies; recipe, food or
nutrition content; user-identifying content; provider content of any kind (POL-13).

Metrics: call rate, error rate by class, latency distribution, circuit transitions, fallback rate,
rate-limit incidence, cache-expiry purge volume.

**Alerts:** authentication failure; circuit opening; fallback rate above threshold; purge failure.

## 8. Configuration shape

```php
<?php
// PSEUDOCODE — config/meal-planning.php

return [
    'default' => 'internal',            // POL-01

    'providers' => [
        'internal' => [
            'enabled' => true,
        ],
        'eat_this_much' => [
            'enabled'  => false,        // POL-01 — requires an explicit deployment decision
            'username' => null,         // from environment only; never defaulted (POL-02)
            'key'      => null,         // from environment only
            'scope'    => ['home_prepared'],   // doc 16, POS-08
            'timeouts' => ['connect_ms' => null, 'total_ms' => null],
            'circuit'  => ['failure_threshold' => null, 'cooldown_s' => null],
            'retention'=> ['nutrition_cache_s' => null], // set from the executed contract only
        ],
    ],

    'fallback' => [
        // POL-14 — per operation and per failure class. Empty means no fallback.
    ],
];
```

Values are deliberately null. **They come from an executed contract and from deployment
configuration, not from this document.**

## 9. Testing without a provider

| # | Test | Purpose |
| --- | --- | --- |
| TST-01 | Contract test run against every implementation | One behavioural contract, many implementations |
| TST-02 | Capability-routing test | A kitchen-scoped request is never routed to a provider declaring `supportsKitchenMeals` false |
| TST-03 | Disabled-by-default test | With no configuration, only the internal provider resolves |
| TST-04 | Credential-leak test | No credential appears in any serialised response, log line or client payload |
| TST-05 | Timeout, rate-limit and circuit tests | Against a fake provider; never against a live API (POL-16) |
| TST-06 | Fallback-marking test | Any fallback result carries `isFallback` and is logged |
| TST-07 | Retention test | Externally sourced rows carry an expiry and are purged |
| TST-08 | Separation test | No query joins internally owned and externally sourced entities into one entity |
| TST-09 | Log-safety test | Log output contains no credential, body or content |
| TST-10 | No-live-call test | The suite makes no request to any reference hostname |

**Every test uses a fake provider.** No test calls a live provider API, in any environment.

## 10. Status

Nothing in this document is implemented. It exists so that when the question is asked, the answer is
already designed — and so that the answer does not require restructuring the domain.

The internal engine is the product. A provider, if ever adopted, is an accelerator for one bounded
slice, behind a contract that keeps it replaceable.
