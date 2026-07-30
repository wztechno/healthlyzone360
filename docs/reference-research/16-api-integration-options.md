# 16 — API integration options

Retrieval date: **2026-07-30**.

## 1. Resolution

The specification requires this question to resolve to exactly one classification.

> ### **`OFFICIAL_API_AVAILABLE`**
>
> Eat This Much publishes an official, contracted Partner API. Its existence, capabilities,
> onboarding process, commercial model and key restrictions are all stated on the vendor's own
> public pages.
>
> **Citations:** `https://www.eatthismuch.com/partner-api` (ETM-06) and
> `https://help.eatthismuch.com/help/eat-this-much-api-documentation` (ETM-11), both retrieved
> 2026-07-30 by `webfetch`. A further vendor-hosted API reference exists at
> `https://www.eatthismuch.com/g/docs`, surfaced by search; it was deliberately not retrieved
> (doc 01 §3), because the material fact — that an official API exists on contracted terms — is
> already established by the two pages above, and nothing in a full specification could be acted
> upon without a contract.

**No call has been made to any Eat This Much endpoint, and none will be made without an executed
contract and approved credentials.**

For completeness against the other permitted classifications:

| Classification | Applies? | Why |
| --- | --- | --- |
| `OFFICIAL_API_AVAILABLE` | **Yes** | An official partner API is publicly documented |
| `DOCUMENTED_PUBLIC` | superseded | The API's *terms* are documented publicly, but the stronger classification governs |
| `UNKNOWN` / `REQUIRES_PERMISSION` | no | Applies to the API's *detailed specification and behaviour*, not to its existence |

**Right Bite: no API of any kind was found.** No developer page, no partner API, no integration
documentation appears anywhere in the public surface examined, and no search result indicated one.
Classified `UNKNOWN`. Right Bite is not an integration candidate; it is a competitor and an operating
model to learn from.

## 2. What the Partner API publicly offers

All rows `DOCUMENTED_PUBLIC`, source ETM-06.

| # | Capability | Note |
| --- | --- | --- |
| CAP-01 | Plan generation at three scopes: a full week, a single day, or an individual meal | Corroborates the regeneration scopes in doc 10 §2 |
| CAP-02 | Generation against calorie and macro targets | — |
| CAP-03 | A recipe corpus in the thousands, with nutrition data and preparation instructions | The corpus, not the algorithm, is the substantive asset |
| CAP-04 | Diet presets — the same set promoted publicly — plus ingredient exclusions | — |
| CAP-05 | Grocery lists with ingredients aggregated across meals **and dates** | A genuine roll-up over a date range |
| CAP-06 | Output as structured data, or as rendered documents using vendor templates | Rendered output implies vendor-branded presentation — see `LR-02` |

A separate, narrower interface is documented for professional-tier accounts (ETM-11): credentials
passed as request parameters, endpoints for validating credentials and for adding and removing
clients individually or in bulk, with per-client options for login access, feature grants,
invitations and welcome messaging. It carries rate limits, is documented as available only to
professional accounts, and requires contacting the vendor first. **This is a client-provisioning
interface, not a meal-generation interface**, and the two should not be conflated.

## 3. Commercial and contractual terms as publicly stated

| # | Term | Classification |
| --- | --- | --- |
| TRM-01 | Access is **not self-serve**. The sequence is: describe the use case, agree an approach and contract terms, then the vendor provisions access | `DOCUMENTED_PUBLIC` |
| TRM-02 | Pricing is **custom**, tailored to each partner's use case and volume. No public rate card exists | `DOCUMENTED_PUBLIC` |
| TRM-03 | The vendor states it is onboarding a **limited number of partners** while the API is in early access | `DOCUMENTED_PUBLIC` |
| TRM-04 | Evaluation access is available by arrangement | `DOCUMENTED_PUBLIC` |
| TRM-05 | Under standard terms, partners **retain data only for the duration of the partnership** | `DOCUMENTED_PUBLIC` |
| TRM-06 | Food nutrition data may be **cached only for a short, stated period** | `DOCUMENTED_PUBLIC` |
| TRM-07 | Credentials are to be kept secret and secure | `DOCUMENTED_PUBLIC` |
| TRM-08 | The professional interface applies rate limits, signalled by a standard rate-limit response | `DOCUMENTED_PUBLIC` |
| TRM-09 | Actual contract terms, service levels, indemnities, liability and termination | `UNKNOWN` — only a contract would establish them |

## 4. Cost dependency

| # | Consideration | Assessment |
| --- | --- | --- |
| CST-01 | Pricing is unknowable before a commercial conversation (TRM-02) | **We cannot budget this integration today.** Any plan that assumes it is planning on an unknown number |
| CST-02 | Pricing scales with volume | Cost grows with our success. An internal engine's cost is largely fixed |
| CST-03 | Early access with limited partners (TRM-03) | Availability is not guaranteed. We might not be accepted, and terms may change as the programme matures |
| CST-04 | Caching is restricted (TRM-06) | We cannot amortise cost through aggressive caching. Repeat views may mean repeat calls |
| CST-05 | Our marketplace is kitchen-centric | The vendor's corpus is home-cooking recipes. **Much of what we sell — a specific kitchen's meal, on a specific day, in a delivery zone — is not in their data at all** |

**CST-05 is the decisive commercial observation.** The Partner API's core value is a recipe corpus
and a generator over it. Our marketplace's core inventory is kitchen-prepared meals with
availability, delivery zones, operating schedules and sales-channel rules. The overlap is real but
partial: the API could serve our **home-prepared** planning, and could not serve our
**kitchen-delivered** planning at all.

## 5. Data-retention, cache and lock-in risk

| # | Risk | Detail | Severity |
| --- | --- | --- | --- |
| RSK-01 | Retention limited to the partnership's duration (TRM-05) | If the partnership ends, retained provider data must go. **Any user plan built from provider data could become unreadable history.** This must be designed for from day one, not discovered at termination | **High** |
| RSK-02 | Short cache window on nutrition data (TRM-06) | Constrains performance strategy and offline capability, and increases call volume | Medium |
| RSK-03 | Provider lock-in | If provider-generated plans become the product's substance, leaving is a data-migration problem as well as a commercial one | **High** |
| RSK-04 | Availability risk | Early access, limited partners, custom terms — the programme's shape may change | Medium |
| RSK-05 | Semantic coupling | Adopting the provider's diet taxonomy, meal types or nutrient model into our own domain would embed a third party in our core contracts | **High** — mitigated by the provider-neutral interface |
| RSK-06 | Attribution and display obligations | Unknown until contracted; may constrain how nutrition data is presented (`LR-05`) | Medium |
| RSK-07 | Clinical-liability transfer | If a dietitian relies on provider-supplied nutrition data, where does responsibility sit? (`LR-06`) | **High** |
| RSK-08 | Correctness dependency | We would be accountable to our users for a calculation we neither perform nor can inspect | **High** |

**RSK-01 and RSK-03 together produce the central architectural requirement:** externally sourced
data must be **kept separate from internally owned data at every layer**, mapped by external
identifier, and never merged into our own entities. That requirement is specified in
`docs/architecture/integrations/00-meal-planning-provider.md`.

## 6. The internal-engine alternative

| # | Dimension | Eat This Much provider | Internal engine |
| --- | --- | --- | --- |
| ALT-01 | Recipe corpus | Thousands of curated recipes, immediately | Ours to build; smaller at first |
| ALT-02 | Kitchen-prepared marketplace meals | **Not supported at all** | Native — it is our core inventory |
| ALT-03 | Delivery zones, operating schedules, availability | Not supported | Native |
| ALT-04 | Sales-channel rules and business eligibility | Not supported | Native |
| ALT-05 | Our six restriction kinds | Not supported; the provider does not distinguish them | Native, and a genuine differentiator |
| ALT-06 | Clinician-enforced restrictions outranking preference | Not supported | Native |
| ALT-07 | Explainable scoring — telling a user *why* a meal was chosen | Not available; the algorithm is not inspectable | Native, and a differentiator |
| ALT-08 | Multi-currency GCC commerce | Not applicable | Native |
| ALT-09 | Arabic and right-to-left content | `UNKNOWN` | Native |
| ALT-10 | Time to first useful result | Fast, subject to contracting | Slower |
| ALT-11 | Marginal cost at scale | Grows with volume, unknown | Largely fixed |
| ALT-12 | Data ownership | Constrained by TRM-05 | Complete |
| ALT-13 | Correctness accountability | Cannot inspect | Ours, and inspectable |
| ALT-14 | Lock-in | High | None |

**Assessment.** The internal engine is the strategically correct primary, because five of our
product's defining capabilities (ALT-02 to ALT-06) simply cannot be served by the provider, and two
more (ALT-07, ALT-13) are foreclosed by using it. The provider is a credible **accelerator for
home-prepared recipe planning specifically** — a bounded slice where the corpus is the value and our
differentiators do not apply.

This is why the architecture is provider-neutral with an internal default, rather than
provider-first.

## 7. Position for this phase

| # | Position |
| --- | --- |
| POS-01 | The primary implementation is the **internal engine**. `InternalMealPlanningProvider` is the default and the only enabled provider |
| POS-02 | The Eat This Much provider is **documented, not implemented**. It ships disabled, with no credentials present |
| POS-03 | **No call will be made to any Eat This Much endpoint without an executed contract and approved credentials.** This is unconditional |
| POS-04 | Enabling the provider requires: an executed contract; provisioned credentials in server-side environment configuration; completed legal review (`LR-02` to `LR-06`); and an explicit deployment decision |
| POS-05 | The interface is provider-neutral so that adopting or dropping a provider is a configuration change, not a rewrite |
| POS-06 | Provider data is stored separately from internally owned data, mapped by external identifier, and never merged |
| POS-07 | A provider is **never silently substituted**. Any switch is explicit, logged and visible |
| POS-08 | If the provider is ever adopted, it is scoped to home-prepared recipe planning. Kitchen-delivered marketplace planning stays internal permanently |

## 8. Decisions required before any adoption

| # | Decision | Owner |
| --- | --- | --- |
| DEC-01 | Do we open a commercial conversation at all, given CST-05 and ALT-02 to ALT-06? | Product owner |
| DEC-02 | If yes, is the scope limited to home-prepared planning? | Product owner |
| DEC-03 | Legal review `LR-02` to `LR-06` (doc 14 §7) | Legal |
| DEC-04 | How is user-visible history preserved if the partnership ends (RSK-01)? | Architecture |
| DEC-05 | Who is accountable for a nutrition figure our platform displays but did not compute (RSK-07, RSK-08)? | Product owner and legal |
| DEC-06 | Does a short cache window meet our performance and offline requirements (RSK-02)? | Architecture |

**None of these decisions is needed for the current phase**, because the provider is documentation
only. They are needed before any line of provider-calling code is written.

## 9. Where the detail lives

- `docs/architecture/integrations/00-meal-planning-provider.md` — the provider-neutral contract,
  its operational policies, and the sequence of a provider-mediated request
- `docs/architecture/integrations/01-eat-this-much-provider.md` — provider specifics: authorisation,
  contract, cost, retention, cache, lock-in, the internal alternative, and required legal review
