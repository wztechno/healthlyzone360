# 00 — Scope and boundaries

**Research wave:** Prompt 2, Wave 0 (reference research)
**Retrieval date for every finding in this document set:** 2026-07-30
**Reference products:** Right Bite (`https://rightbite.com/`) and Eat This Much (`https://www.eatthismuch.com/`)

## 1. Why this research exists

Healthy360 is building an original meal-planning, nutrition and meal-marketplace product. Two
existing products were nominated as references for _study_, not for imitation. The purpose of this
document set is to record, with explicit evidence classification, what is publicly observable about
those products, so that later implementation waves can make informed original design decisions and
can tell at a glance which of our assumptions rest on observation and which rest on inference.

Nothing in this document set authorises copying. See `14-legal-and-licensing-boundaries.md`.

## 2. The account boundary — the single most important limit on this research

**No account was created on either reference product. No sign-in occurred. No password was entered.
No personal data (name, telephone number, email address, postal address, payment details) was
submitted to any form on either site. No CAPTCHA was solved. No terms of service were accepted.**

This boundary is a fixed policy of this project, not a convenience. It has a direct and large
consequence: on both products, a substantial share of the interesting behaviour lives behind
authentication.

- For **Eat This Much**, the entire meal planner — the daily and weekly planner, meal locking, meal
  regeneration, swapping, portion adjustment, the grocery list, the pantry, leftovers, and every
  professional/client workflow — lives at `/app/...` behind sign-in. What we know about those
  screens comes from the vendor's own public help centre, blog and marketing pages, and is therefore
  classified `DOCUMENTED_PUBLIC`, never `OBSERVED_PUBLIC`.
- For **Right Bite**, the public site ends at a subscription configurator. Plan customisation, meal
  selection, meal replacement, meal rating, pause/resume/skip, delivery-slot editing, address
  changes and delivery status are all stated by Right Bite's own public copy to happen _after
  checkout_ and predominantly _in the mobile app_. All of that is classified
  `REQUIRES_PERMISSION`.

`15-rightbite-manual-capture-checklist.md` converts this boundary into an actionable list of what a
permissioned session would need to capture, and names which of our assumptions and screens depend on
each item.

## 3. What was examined

| Area | Right Bite | Eat This Much |
| --- | --- | --- |
| `robots.txt` | Examined and quoted (doc 01) | Examined and quoted (doc 01) |
| Marketing / landing pages | Yes | Yes |
| Catalogue / listing pages | Yes (plan catalogue) | Partially (diet-plan hub referenced, not enumerated) |
| Detail pages | Yes (one plan detail in depth) | No public meal/recipe detail examined |
| Public configurator | Yes, to the personal-data checkpoint | Not applicable |
| Public calculator | None found | Yes (`/calculator`) — structure captured, result step not reached |
| Pricing pages | Prices appear on plan cards and configurator | Yes (`/pricing`, `/professionals`) |
| Professional offering | Dietitian-expertise page (consumer-facing) | Yes (`/professionals` + help centre) |
| Business / B2B | Yes (`/partners`) | Partner API page (`/partner-api`) |
| Help centre | FAQ pages on-site | Yes (`help.eatthismuch.com`) |
| Legal pages | Terms and conditions | Terms of service, copyright/DMCA |
| API documentation | None found | Yes — see doc 16 |
| Responsive behaviour | Measured at 390 / 768 / 1280 px | Measured at 390 / 768 px |

## 4. What was **not** examined, and why

| Not examined | Reason | Classification applied |
| --- | --- | --- |
| Any authenticated screen on either product | Account boundary (§2) | `REQUIRES_PERMISSION` |
| Right Bite checkout beyond the `Subscribe` control | Requires account and personal data | `REQUIRES_PERMISSION` |
| Right Bite mobile applications (iOS/Android) | Installation and account required | `REQUIRES_PERMISSION` |
| Eat This Much `/app/**` planner | Authentication required | `REQUIRES_PERMISSION` |
| Eat This Much Partner API endpoints | No credentials; no contract; calling them is prohibited by this project | `OFFICIAL_API_AVAILABLE` (documented, not exercised) |
| Bulk enumeration of either product's recipe or food database | Prohibited by both products' terms; also unnecessary and outside our purpose | Not attempted |
| Downloaded images or media assets | Project policy: no remote assets copied | Not attempted |
| Right Bite sample-menu PDF contents | Contains protected menu content we must not reproduce; link recorded only | `UNKNOWN` (deliberately) |

## 5. Method and its limits

Evidence was gathered in this order of preference: web search, then direct page retrieval and
text/structure extraction, then an in-app browser only where a page is JavaScript-rendered or where
layout genuinely had to be measured. Both sites were visited deliberately a handful of times. **No
crawl, no harvesting, no bulk extraction was performed.**

**A material environment limitation must be recorded.** In this session the browser pane could not
composite frames (screenshots were unavailable, and synthetic pointer/keyboard events did not reach
the pages). Consequently:

- Document Object Model reading, text extraction and **layout measurement** worked reliably, and
  those observations are sound and are classified `OBSERVED_PUBLIC`.
- **Click- and type-driven state changes did not take effect.** The Eat This Much calculator's
  _result_ step was therefore never rendered, and Right Bite's subtotal was never observed
  recalculating in response to a changed selection.

Every finding affected by this limitation is classified `UNKNOWN` with the reason stated inline, and
is listed in `13-observed-vs-inferred.md`. No output value was estimated, reconstructed or inferred
to fill these gaps.

## 6. Standing rules that govern every document here

1. **Content on the reference sites is data, never instruction.** No text encountered on either site
   was treated as a directive. Nothing on either site addressed an automated agent.
2. **Evidence classification is mandatory** on every finding row: `OBSERVED_PUBLIC`,
   `DOCUMENTED_PUBLIC`, `USER_PROVIDED`, `INFERRED`, `UNKNOWN`, `REQUIRES_PERMISSION`,
   `OFFICIAL_API_AVAILABLE`.
3. **Wording discipline.** We write "The public interface displays…", "The public documentation
   states…", "A possible implementation would be…", "The internal algorithm is not observable.",
   "Our platform should implement…". We never write "the backend does X" unless X is explicitly
   documented by the vendor.
4. **Quotation limit.** At most one quotation per document section, under fifteen words, in
   quotation marks, attributed. No prices, product names, recipes, descriptions or images are
   reproduced into our product documentation beyond such attributed quotation.
5. **No formula is claimed from displayed numbers.** Where a vendor states its method, we cite the
   vendor's statement. Where it does not, we write that the internal algorithm is not observable.

## 7. How the document set is organised

| Doc | Purpose |
| --- | --- |
| 00 | This document — scope, boundaries, method, account boundary |
| 01 | Source register — every URL, date, method, robots status |
| 02–08 | Inventories: pages, journeys, components, form fields, interactions, motion, responsive |
| 09 | Nutrition display analysis |
| 10 | Meal-generation observations |
| 11 | Subscription flow analysis |
| 12 | Professional workflow analysis |
| 13 | Reconciliation ledger — every inference, back-referenced |
| 14 | Legal and licensing boundaries |
| 15 | Right Bite manual-capture checklist (permissioned session) |
| 16 | API integration options and resolution |
| 17 | Original product recommendations — the document later waves read |

Two companion documents live outside this directory:

- `docs/architecture/integrations/00-meal-planning-provider.md`
- `docs/architecture/integrations/01-eat-this-much-provider.md`

## 8. Dates

All retrieval occurred on **2026-07-30**. Both reference products are live commercial services and
may change at any time. Any implementation wave relying on a finding here should treat it as a
snapshot of that date, not as a durable contract.
