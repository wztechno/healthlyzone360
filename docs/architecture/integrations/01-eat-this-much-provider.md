# 01 — EatThisMuchPartnerProvider: provider specifics

**Status:** Design documentation. **Not implemented. Disabled by default. No credentials exist.**
**Date:** 2026-07-30
**Contract:** `00-meal-planning-provider.md`
**Research and resolution:** `docs/reference-research/16-api-integration-options.md`
**Legal boundaries:** `docs/reference-research/14-legal-and-licensing-boundaries.md`

> **No call has been made to any Eat This Much endpoint, and none will be made without an executed
> contract and approved credentials.** This document contains no importable code; the PHP shown is
> illustrative pseudocode.

## 1. Summary

Eat This Much publishes an official Partner API — classification `OFFICIAL_API_AVAILABLE`, resolved
in doc 16 §1 with citations. This document records what adopting it would require, cost, constrain
and risk, so the decision can be made on evidence rather than enthusiasm.

**The recommendation is not to adopt it in this phase, and to scope it narrowly if ever adopted.**
The reasoning is in §7.

## 2. Authorisation requirements

| # | Requirement | Classification | Consequence for us |
| --- | --- | --- | --- |
| AUT-01 | Access is **not self-serve**. The sequence is: describe the use case, agree an approach and contract, then the vendor provisions access | `DOCUMENTED_PUBLIC` | We cannot begin, prototype or spike against the real API. Every design decision must be provider-agnostic until a contract exists |
| AUT-02 | Credentials are a username and a key, passed as request parameters | `DOCUMENTED_PUBLIC` | Credentials travel in the request. They must be server-side only (POL-02, POL-03, POL-04) and must never appear in a logged URL |
| AUT-03 | Credentials must be kept secret and secure | `DOCUMENTED_PUBLIC` | Environment configuration only; never committed; never logged; rotation procedure required before go-live |
| AUT-04 | The documented client-provisioning interface is restricted to professional-tier accounts and requires contacting the vendor first | `DOCUMENTED_PUBLIC` | It is a **client-provisioning** interface, not a generation interface. The two must not be conflated |
| AUT-05 | Rate limits apply, signalled by a standard rate-limit response | `DOCUMENTED_PUBLIC` | POL-07 is mandatory, with backoff and circuit breaking |
| AUT-06 | Actual authorisation scope, service levels and permitted use | `UNKNOWN` | Only a contract establishes them. This is `LR-02` |

**AUT-02 deserves emphasis.** Credentials passed as request parameters are easy to leak into access
logs, error reports and traces. Our implementation must place them outside any logged surface and
must assert this in the credential-leak test (contract doc, TST-04, TST-09).

## 3. Contract dependency

| # | Dependency | Consequence |
| --- | --- | --- |
| CON-01 | No access without an executed contract (AUT-01) | The provider cannot be prototyped, spiked or load-tested in advance. **Nothing in our roadmap may assume it** |
| CON-02 | Early access, limited partners | We might not be accepted. Terms may change as the programme matures |
| CON-03 | Terms are per-partner, not standard | We cannot reason about our obligations from public pages; only from the executed contract |
| CON-04 | Contract termination | Retention rights end with the partnership (§5). Termination is a **data event**, not just a commercial one |
| CON-05 | Service levels, liability, indemnity, support | `UNKNOWN` until contracted. A dependency without service levels cannot sit on a user-facing critical path |

**CON-05 is decisive for placement.** Until service levels are known and acceptable, the provider
may not be on a path a user waits for synchronously. Any adoption starts asynchronous, cached where
permitted, and with the internal engine as the guaranteed answer.

## 4. Cost dependency

| # | Factor | Assessment |
| --- | --- | --- |
| CST-01 | Pricing is custom, tailored to use case and volume; no public rate card | **We cannot budget this integration today** |
| CST-02 | Cost scales with volume | Marginal cost grows with our success. The internal engine's cost is largely fixed |
| CST-03 | Caching is contractually restricted (§5) | We cannot amortise cost through aggressive caching. Repeat views may mean repeat calls |
| CST-04 | Generation is our highest-frequency operation | Planner regeneration is used repeatedly per session by design (doc 10, GEN-01 to GEN-04). **A per-call cost model interacts badly with a product that encourages regeneration** |
| CST-05 | Overlap with our inventory is partial | The corpus is home-cooking recipes. Kitchen-prepared marketplace meals — our core inventory — are absent entirely |

**CST-04 is the commercial insight most easily missed.** Our planner's central interaction is
"regenerate until it looks right". A metered generation dependency puts a meter on the product's
primary loop. Either we cap regeneration — degrading the product — or we accept unbounded cost.

## 5. Data-retention limitations

| # | Limitation | Classification | Consequence |
| --- | --- | --- | --- |
| RET-01 | Under standard terms, partners retain data only for the duration of the partnership | `DOCUMENTED_PUBLIC` | Every externally sourced row carries an expiry and a purge path (POL-10) |
| RET-02 | Termination obliges removal | inferred from RET-01, subject to contract | **A user's saved plan built from provider recipes could become unreadable history.** This must be designed for from day one |
| RET-03 | Backups | `UNKNOWN` | Do retention obligations reach backups and archives? `LR-03` |
| RET-04 | Derived data | `UNKNOWN` | If a nutrition total was computed from provider data, is the total itself subject to the obligation? `LR-03` |
| RET-05 | Audit and clinical records | `UNKNOWN` | If a dietitian approved a plan containing provider content, our clinical-record obligations may conflict with a deletion obligation. **This is a genuine conflict of duties.** `LR-03`, `LR-06` |

**RET-02 and RET-05 are the most serious findings in this document.**

Mitigation, if ever adopted: **snapshot the user-facing substance of a plan into our own storage at
the moment it is created**, as internally owned data, so that what the user sees survives
termination. Only the provider's *sourced content* remains subject to purge. Whether that snapshot
is itself permitted is a contract question (`LR-02`), and it must be answered **before**
implementation, not after.

## 6. Cache limitations

| # | Limitation | Classification | Consequence |
| --- | --- | --- | --- |
| CCH-01 | Food nutrition data may be cached only for a short, stated period | `DOCUMENTED_PUBLIC` | The cache window is set from the contract, never guessed |
| CCH-02 | Whether generated plans may be cached beyond that window | `UNKNOWN` | `LR-02` |
| CCH-03 | Offline capability | Our universal application has offline expectations. A short cache window conflicts with them for any provider-sourced content | Provider content may need to be marked unavailable offline |
| CCH-04 | Performance | Every cache expiry is a potential call on a user-facing path | Interacts with CON-05 and CST-03 |
| CCH-05 | Cache-key hygiene | A cache keyed on user-identifying data would extend the provider's data footprint into our cache | Cache keys must be derived, never raw personal data |

## 7. Provider lock-in risk

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| LCK-01 | Product substance becomes provider-dependent | **High** | Internal engine is the default and always capable; the provider is scoped to one slice |
| LCK-02 | Semantic coupling — their diet taxonomy, meal types or nutrient model entering our domain | **High** | Translation boundary; unmappable concepts dropped, never approximated (contract doc §3.3) |
| LCK-03 | Identifier coupling | Medium | External identifiers mapped, never adopted (POL-11) |
| LCK-04 | Data lock-in — leaving means losing history | **High** | RET-02 mitigation, subject to `LR-02` |
| LCK-05 | Commercial lock-in — pricing power grows with dependence | **High** | Keep the internal engine genuinely capable, not a stub. **A fallback that has never run in production is not a fallback** |
| LCK-06 | Correctness lock-in — accountable for a calculation we cannot inspect | **High** | Attribute provider-sourced values in the interface; keep clinical review on internally computed values |
| LCK-07 | Capability lock-in — our roadmap constrained by their roadmap | Medium | Capability negotiation makes the ceiling explicit |

**LCK-05 deserves operational emphasis.** If the internal engine exists only as a fallback path that
never executes, it will rot. Any adoption must keep the internal engine serving real traffic — which
it naturally would, since kitchen-delivered planning can never be routed externally (doc 16, ALT-02).

## 8. The internal-engine alternative

Full comparison in doc 16 §6. The decisive points:

| # | Capability | Provider | Internal |
| --- | --- | --- | --- |
| ALT-01 | Kitchen-prepared marketplace meals | **not supported** | native — our core inventory |
| ALT-02 | Delivery zones, operating schedules, availability | **not supported** | native |
| ALT-03 | Sales-channel rules, business eligibility | **not supported** | native |
| ALT-04 | Six restriction kinds | **not supported** | native, and a differentiator |
| ALT-05 | Clinician-enforced restrictions outranking preference | **not supported** | native |
| ALT-06 | Explainable scoring | **not available** — algorithm not inspectable | native, and a differentiator |
| ALT-07 | Multi-currency GCC commerce, Arabic content | not applicable / `UNKNOWN` | native |
| ALT-08 | Recipe corpus at launch | thousands, immediately | ours to build |
| ALT-09 | Marginal cost at scale | grows, unknown | largely fixed |
| ALT-10 | Data ownership and retention | constrained | complete |

**Six of our defining capabilities cannot be served by the provider at all.** The provider's genuine
advantage is exactly one thing: a large home-cooking recipe corpus, available immediately.

**Assessment.** The internal engine is the product. The provider is a possible accelerator for
**home-prepared recipe planning only**, and only if the corpus gap proves to be a real constraint on
adoption rather than an assumed one.

## 9. Required legal review

Cross-referenced to `docs/reference-research/14-legal-and-licensing-boundaries.md` §7.

| ID | Item | Must complete before |
| --- | --- | --- |
| `LR-01` | The `robots.txt` / terms-of-service tension, and any future automated interaction | Any further automated retrieval from the host |
| `LR-02` | Contract licence scope: permitted use, sublicensing, display and attribution obligations, and **whether a plan snapshot into our own storage is permitted** (§5) | Signing any contract |
| `LR-03` | Retention obligations against our own retention, backup, audit and clinical-record duties — including the RET-05 conflict | Any implementation |
| `LR-04` | Cache limitation against our performance and offline requirements | Any implementation |
| `LR-05` | Whether externally sourced nutrition data may be shown to end users, and under what attribution | Any implementation |
| `LR-06` | Whether externally sourced data may inform a professional's clinical recommendation, and where liability sits | Any dietitian-facing use |
| `LR-11` | Health-data flows to a third-party processor under applicable GCC regimes — including whether user constraints may be transmitted at all | Any implementation |

**`LR-11` is specific to this provider and may be dispositive on its own.** Generation requires
sending the user's constraints — which include allergies and may include self-declared medical
information — to a third party. That is a health-data transfer, and it may be restricted or
prohibited independently of anything in the commercial contract.

## 10. Preconditions for enabling

All must hold. Any one failing means the provider stays disabled.

| # | Precondition |
| --- | --- |
| PRE-01 | An executed contract exists |
| PRE-02 | Legal review `LR-02` to `LR-06` and `LR-11` is complete and favourable |
| PRE-03 | Credentials are provisioned in server-side environment configuration only |
| PRE-04 | Retention and cache windows are configured **from the contract**, not from any default |
| PRE-05 | Purge-on-termination is implemented and tested |
| PRE-06 | The RET-02 snapshot mitigation is implemented, and permitted under `LR-02` |
| PRE-07 | Scope is limited to home-prepared planning (doc 16, POS-08) |
| PRE-08 | Timeouts, rate-limit handling and circuit breaking are implemented and tested against a fake |
| PRE-09 | Credential-leak and log-safety tests pass |
| PRE-10 | The internal engine remains fully capable and serves real traffic |
| PRE-11 | Provider attribution is visible in the interface wherever provider content is shown |
| PRE-12 | An explicit deployment decision is recorded, with a named owner |
| PRE-13 | `LR-11` confirms the health-data transfer is lawful in every market we operate in |

## 11. Position for this phase

| # | Position |
| --- | --- |
| POS-01 | The provider is **documented, not implemented** |
| POS-02 | It is **disabled by default**; no credentials exist anywhere in the repository or environment |
| POS-03 | **No call will be made without an executed contract and approved credentials** |
| POS-04 | The internal engine is the default and the only enabled provider |
| POS-05 | The provider-neutral contract exists so this remains a configuration decision |
| POS-06 | No decision on adoption is required in this phase. The decisions are enumerated in doc 16 §8 |

## 12. Recommendation

**Do not adopt in this phase.** Revisit only if a corpus gap in home-prepared recipe planning proves
to be a real constraint on adoption, measured against real users, rather than an assumed one.

If it is revisited, the questions to answer first are: does the metered cost model survive a product
whose primary loop is regeneration (CST-04); can user-visible plan history survive termination
(RET-02); and is the health-data transfer lawful in every market we operate in (`LR-11`)?

**If the answer to any of those three is no, the provider is not viable regardless of its corpus.**
