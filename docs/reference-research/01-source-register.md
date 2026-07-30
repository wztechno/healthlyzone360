# 01 — Source register

Every URL consulted during Wave 0, with retrieval date, method and robots status.
**Retrieval date for all rows: 2026-07-30.**

Methods: `websearch` · `webfetch` (retrieve and read page text/structure) · `browser` (in-app browser
— Document Object Model reading and layout measurement).

## 1. `robots.txt` — retrieved first, quoted, and honoured

### 1.1 Right Bite

Retrieved `https://rightbite.com/robots.txt` on 2026-07-30 (`webfetch`). The file is short. Its
directives are:

- `User-agent: *`
- `Disallow: */[`
- `Host: https://rightbite.com`
- `Sitemap: https://rightbite.com/index_sitemap.xml`

Interpretation: the only disallowed pattern is URLs containing an opening square bracket — in
practice a guard against templating artefacts. **No page consulted in this research contains `[` in
its path.** No disallowed path was fetched.

### 1.2 Eat This Much

Retrieved `https://www.eatthismuch.com/robots.txt` on 2026-07-30 (`webfetch`). Its directives are:

- `User-agent: ClaudeBot` / `Allow: /` / `Crawl-delay: 2`
- `User-agent: *` / `Allow: /`
- Thirteen `Sitemap:` lines, beginning `https://www.eatthismuch.com/sitemap.xml` and continuing with
  per-category sitemaps for basic foods, restaurant foods, recipes, quantities and branded foods
  (split alphabetically).

Interpretation: the file names our own agent identity explicitly and allows all paths, subject to a
two-second crawl delay. Retrieval in this research was a small number of deliberate page visits well
inside that budget; no crawl was performed.

**A tension must be recorded here and carried into doc 14.** Eat This Much's `robots.txt` explicitly
allows automated access, while its terms of service separately restrict access by automated means.
We did not accept those terms (no account, no sign-in). We consulted a limited number of public
pages and performed no bulk extraction. This tension is flagged for legal review in
`14-legal-and-licensing-boundaries.md` §4.

## 2. Right Bite — pages consulted

| # | URL | Method | Robots status | What it yielded |
| --- | --- | --- | --- | --- |
| RB-01 | `https://rightbite.com/robots.txt` | webfetch | n/a | Directives quoted above |
| RB-02 | `https://rightbite.com/` | webfetch | Allowed | Landing structure, navigation, section headings, plan categories, locale/region switchers, footer |
| RB-03 | `https://rightbite.com/en-ae/subscribe-to-a-plan` | webfetch | Allowed | Plan catalogue; card anatomy; full list of plan detail paths |
| RB-04 | `https://rightbite.com/en-ae/subscribe-to-a-plan/weight-loss` | webfetch + browser | Allowed | Plan detail and configurator in depth; option sets; nutrition ranges; subtotal; `Subscribe` checkpoint; responsive measurement at 390 / 768 / 1280 px |
| RB-05 | `https://rightbite.com/en-ae/faqs` | webfetch | Allowed | Pause window, delivery days and slots, address confirmation, in-app meal selection and rating, allergy handling, dietitian consultations |
| RB-06 | `https://rightbite.com/en-ae/partners` | webfetch | Allowed | Corporate / gym / events / affiliate propositions; enquiry-form field list (**not submitted**) |
| RB-07 | `https://rightbite.com/en-ae/terms-and-conditions` | webfetch | Allowed | Intellectual property, trademark ownership, automated-access restriction, 90-day subscription term, hold notice period, refund policy, delivery window |

Referenced but deliberately **not** retrieved:

| URL | Reason |
| --- | --- |
| `https://assets.ctfassets.net/.../RB_UPDATED_SAMPLE_MENUS_...pdf` | Sample-menu PDF; contains protected menu content we must not reproduce. Existence and location recorded only. |
| `https://rightbite.com/en-ae/subscribe-to-a-plan/{athlete, lite, low-carb, express-lunch, basics, glp1, champ-plan, barrys, republik, fuel, diabetic, balanced-mom, rightbite-plus}` | Thirteen sibling plan pages. One plan detail was examined in depth; enumerating the rest would be a crawl without adding structural insight. Paths recorded in doc 02; contents `UNKNOWN`. |
| `https://rightbite.com/en-ae/blog/**` | Marketing content; no product-structure value. |
| Right Bite iOS / Android applications | Installation and account required → `REQUIRES_PERMISSION`. |

## 3. Eat This Much — pages consulted

| # | URL | Method | Robots status | What it yielded |
| --- | --- | --- | --- | --- |
| ETM-01 | `https://www.eatthismuch.com/robots.txt` | webfetch | n/a | Directives quoted above |
| ETM-02 | `https://www.eatthismuch.com/` | webfetch + browser | Allowed | Landing structure; public meal-plan generator field inventory; navigation; disclaimers; responsive measurement at 390 / 768 px |
| ETM-03 | `https://www.eatthismuch.com/calculator` | webfetch + browser | Allowed | Complete calorie-calculator field inventory including activity-factor option values; stated calculation method with citations; six explanatory panels |
| ETM-04 | `https://www.eatthismuch.com/pricing` | webfetch | Allowed | Free / Premium / Professional tiers and the feature split between them |
| ETM-05 | `https://www.eatthismuch.com/professionals` | webfetch | Allowed | Professional tiers, client limits, client access-control model, branding, admin dashboard |
| ETM-06 | `https://www.eatthismuch.com/partner-api` | webfetch | Allowed | Partner API capabilities, onboarding sequence, commercial model, retention and cache limits |
| ETM-07 | `https://www.eatthismuch.com/terms` | webfetch | Allowed | Intellectual property, user-content licence, automated-access restriction, trademark, permission expiry |
| ETM-08 | `https://www.eatthismuch.com/copyright` | webfetch | Allowed | DMCA notice-and-takedown process only |
| ETM-09 | `https://www.eatthismuch.com/how-to/` | webfetch | Allowed | Planner interface description: shuffle/regenerate, favourite/block, Food Bank drag-and-drop, weekly generator, nutrition totals versus targets, grocery list |
| ETM-10 | `https://help.eatthismuch.com/` | webfetch | Allowed (help centre host) | Help-centre category and article index |
| ETM-11 | `https://help.eatthismuch.com/help/eat-this-much-api-documentation` | webfetch | Allowed | API authentication scheme, base URL, endpoint list, optional parameters, rate limiting, eligibility restriction |
| ETM-12 | `https://help.eatthismuch.com/help/changing-the-number-of-meals` | webfetch | Allowed | Meal count ceiling, meal-layout editor, per-day-of-week layouts, custom meal types, drag-to-reorder |
| ETM-13 | `https://help.eatthismuch.com/help/how-do-i-track-what-ive-eaten-or-lock-meals-in-place` | webfetch | Allowed | Locking control and semantics; interaction between locking, eaten-tracking and the grocery list |
| ETM-14 | `https://help.eatthismuch.com/help/etm-professional-adding-notes-to-client-meal-plans` | webfetch | Allowed | Note attachment levels, client visibility, export behaviour, persistence across regeneration |

Referenced but deliberately **not** retrieved:

| URL | Reason |
| --- | --- |
| `https://www.eatthismuch.com/app/**` (planner, registration, login) | Authentication boundary → `REQUIRES_PERMISSION`. |
| `https://www.eatthismuch.com/api/**` | Live API. No credentials, no contract. Calling it is prohibited by this project. |
| `https://www.eatthismuch.com/food/browse`, `/diet-plan/*`, `/glossary`, sitemaps | Food, recipe and diet catalogue surfaces. Enumerating them would constitute the bulk extraction both parties' terms forbid and our purpose does not need. |
| `https://www.eatthismuch.com/g/docs` (API reference, surfaced by search) | Vendor API reference. Its existence is the material fact for doc 16 and is already established by ETM-06 and ETM-11; retrieving the full specification adds nothing we may lawfully act on without a contract. |
| `https://blog.eatthismuch.com/**` | Tutorial posts; the same behaviour is documented on the help centre, which was used instead. |

## 4. Web searches performed

| Query | Method | Purpose | Outcome |
| --- | --- | --- | --- |
| `Eat This Much API developer partner integration documentation` | websearch | Establish whether an official API exists (doc 16) | Confirmed an official Partner API and a help-centre API reference; led to ETM-06 and ETM-11 |
| `Eat This Much help centre lock meal swap regenerate portion size meal plan` | websearch | Locate authoritative vendor documentation of planner interactions | Led to ETM-09 and ETM-13 |

Search-result snippets were used only as signposts to primary vendor pages. No finding in this
document set rests on a search snippet alone.

## 5. Attempted but not obtained

| Item | Attempt | Result | Classification |
| --- | --- | --- | --- |
| Eat This Much calculator result values | `browser` — synthetic non-personal inputs (male, 5 ft 9 in, 165 lb, age 30, medium body fat, sedentary) entered into the numeric fields; `Submit` activated | Result step never rendered: the browser pane could not composite frames, so activation did not reach the page. **No values were estimated to fill this gap.** | `UNKNOWN` |
| Eat This Much unit toggle behaviour (U.S. Standard ⇄ Metric) | `browser` — toggle activated | Field labels did not re-render; the state change did not take effect | `UNKNOWN` |
| Right Bite subtotal recalculation on option change | `browser` — a discounted duration option activated | Subtotal unchanged; the state change did not take effect | `UNKNOWN` |
| Right Bite behaviour beyond the `Subscribe` control | Not attempted past the checkpoint | The control carries no hyperlink target; it is script-driven. Everything beyond it is gated. | `REQUIRES_PERMISSION` |
| Screenshots of either product | `browser` | Unavailable in this session (pane not displayed). In any case, screenshots are for reading only and are never written into this repository. | n/a |

## 6. Assets and third parties observed in passing

| Observation | Where | Classification | Note |
| --- | --- | --- | --- |
| Right Bite serves media and documents from a Contentful asset host (`assets.ctfassets.net`) | RB-04 | `OBSERVED_PUBLIC` | Indicates a headless content-management system behind the marketing site. No asset was downloaded. |
| Right Bite "Download App" links route through an Adjust attribution link with a `rightbite://` deep-link fallback | RB-02, RB-04 | `OBSERVED_PUBLIC` | Confirms a native application is the primary post-purchase surface. Link not followed. |
| Right Bite footer states the business is part of Kitopi Catering Services LLC | RB-02, RB-07 | `OBSERVED_PUBLIC` | Relevant to trademark ownership in doc 14. |
| Eat This Much names Instacart, AmazonFresh and Walmart as grocery-delivery integrations | ETM-02, ETM-04 | `DOCUMENTED_PUBLIC` | Recorded as a category of integration our platform may later need; no endpoint examined. |

## 7. Statement on conduct

- `robots.txt` was fetched for both hosts before any other retrieval, is quoted above, and was
  honoured.
- No disallowed path was fetched.
- No account was created, no credential was entered, no personal data was submitted, no CAPTCHA was
  solved, and no terms of service were accepted.
- No image or media asset was downloaded from either host.
- No page on either site addressed an automated agent or attempted to issue instructions. All
  retrieved content was treated as data.
