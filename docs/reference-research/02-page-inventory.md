# 02 — Page inventory

Public page surfaces of both reference products. Retrieval date for every row: **2026-07-30**.
Source column gives the register ID from `01-source-register.md`.

## 1. Right Bite — public page surface

### 1.1 Routing and localisation

| # | Claim | Classification | Source | Method |
| --- | --- | --- | --- | --- |
| RBP-01 | Every content route is prefixed with a combined language–region segment, `/en-ae/…` | `OBSERVED_PUBLIC` | RB-02 | webfetch |
| RBP-02 | A language control offers Arabic; its label is rendered in Arabic script | `OBSERVED_PUBLIC` | RB-04 | browser |
| RBP-03 | A region control offers two markets, UAE and KSA, as sibling options | `OBSERVED_PUBLIC` | RB-04 | browser |
| RBP-04 | The page title of a UAE-prefixed plan route referenced Saudi Arabia, indicating title templating that does not fully track the locale segment | `OBSERVED_PUBLIC` | RB-04 | browser |
| RBP-05 | Region and language are controls in a menu panel rather than URL-visible switches at the point of use | `INFERRED` (from the control's placement in the menu tree) | RB-04 | browser |
| RBP-06 | Whether region selection changes currency, catalogue or delivery rules | `UNKNOWN` — not exercisable in this session | RB-04 | browser |

### 1.2 Page inventory

| # | Page | Path | Purpose observed | Classification | Source |
| --- | --- | --- | --- | --- | --- |
| RBP-10 | Landing / home | `/en-ae/home` (and `/`) | Seasonal campaign, plan category entry points, popular meals, app promotion, how-it-works, testimonials, dietitian introductions, blog teasers, FAQ accordion | `OBSERVED_PUBLIC` | RB-02 |
| RBP-11 | Plan catalogue | `/en-ae/subscribe-to-a-plan` | Grid of plan cards; whole card is the link; no filter or sort control present | `OBSERVED_PUBLIC` | RB-03 |
| RBP-12 | Plan detail + configurator | `/en-ae/subscribe-to-a-plan/{plan}` | Single page combining marketing, sample imagery, the full subscription configurator, price summary and an FAQ accordion | `OBSERVED_PUBLIC` | RB-04 |
| RBP-13 | Plan-selection helper | `/en-ae/subscribe-to-a-plan/need-help` | Linked from the calorie selector as guidance for choosing a calorie range | `OBSERVED_PUBLIC` (link exists) / `UNKNOWN` (contents) | RB-04 |
| RBP-14 | Dietitian expertise | `/en-ae/dietitian-expertise` | Consultation proposition; entry to individual dietitian profiles | `OBSERVED_PUBLIC` | RB-02 |
| RBP-15 | Dietitian profile | `/en-ae/dietitian-expertise/{slug}` | Individual named practitioner pages | `OBSERVED_PUBLIC` (routes exist) / `UNKNOWN` (contents) | RB-02 |
| RBP-16 | Partners / business | `/en-ae/partners` | Corporate programmes, gym partnerships, event catering, affiliate programme; enquiry form | `OBSERVED_PUBLIC` | RB-06 |
| RBP-17 | Blog index and articles | `/en-ae/blog`, `/en-ae/blog/{slug}` | Nutrition editorial | `OBSERVED_PUBLIC` (routes) | RB-02 |
| RBP-18 | FAQs | `/en-ae/faqs` | Standalone FAQ surface, in addition to per-page FAQ accordions | `OBSERVED_PUBLIC` | RB-05 |
| RBP-19 | Contact | `/en-ae/contact-us` | Contact routes including a live-chat entry point and a telephone number | `OBSERVED_PUBLIC` | RB-02 |
| RBP-20 | Careers | `/en-ae/careers` | Recruitment | `OBSERVED_PUBLIC` (route) | RB-02 |
| RBP-21 | Privacy policy | `/en-ae/privacy-policy` | Legal | `OBSERVED_PUBLIC` (route) | RB-02 |
| RBP-22 | Terms and conditions | `/en-ae/terms-and-conditions` | Legal | `OBSERVED_PUBLIC` | RB-07 |
| RBP-23 | Authentication | no path — a control opens an in-page panel | Sign-in is a control in the header, not a distinct public route | `OBSERVED_PUBLIC` | RB-04 |
| RBP-24 | Checkout | no public path observed | The `Subscribe` control carries no hyperlink target and is script-driven | `REQUIRES_PERMISSION` | RB-04 |
| RBP-25 | Customer account area | none public | Stated by the vendor to live in the mobile application | `REQUIRES_PERMISSION` | RB-05 |

### 1.3 Plan routes enumerated

Fourteen plan detail routes are reachable from the catalogue. Their path segments are:
`weight-loss`, `athlete`, `lite`, `low-carb`, `express-lunch`, `basics`, `glp1`, `champ-plan`,
`barrys`, `republik`, `fuel`, `diabetic`, `balanced-mom`, `rightbite-plus`.

| # | Claim | Classification | Source |
| --- | --- | --- | --- |
| RBP-30 | Fourteen distinct plan routes exist under the catalogue | `OBSERVED_PUBLIC` | RB-03 |
| RBP-31 | Route segments mix goal-based (`weight-loss`, `low-carb`, `diabetic`), audience-based (`athlete`, `balanced-mom`), occasion-based (`express-lunch`), tier-based (`lite`, `basics`, `rightbite-plus`) and co-branded (`barrys`, `republik`, `champ-plan`) naming | `OBSERVED_PUBLIC` | RB-03 |
| RBP-32 | Co-branded routes represent partnerships with third-party fitness brands | `INFERRED` — the naming pattern differs from the goal-based routes; no page was retrieved to confirm | RB-03 |
| RBP-33 | Contents and configurator shape of the thirteen plan pages other than `weight-loss` | `UNKNOWN` — deliberately not retrieved (doc 01 §2) | RB-03 |

### 1.4 Page composition of the plan detail page

The plan detail page is a single scrolling document that interleaves marketing and transaction. Its
observed block order is:

1. Back control and plan title with a one-line proposition
2. Imagery strip (six named sample dishes, plus feature imagery)
3. Sample-menu document link
4. **Configurator**: package type → calories → duration → start-date notice
5. Nutrition breakdown (macro ranges with a variability caveat)
6. Price summary (subtotal) and the primary `Subscribe` control
7. Benefits grid (pause, multiple addresses, menu changes, delivery slots)
8. Social-proof counters and testimonials
9. Trust strip (free daily delivery, secure checkout)
10. FAQ accordion
11. Footer

| # | Claim | Classification | Source |
| --- | --- | --- | --- |
| RBP-40 | Configuration, nutrition summary and price summary are co-located on the plan detail page rather than split across a multi-step wizard | `OBSERVED_PUBLIC` | RB-04 |
| RBP-41 | Marketing content continues _below_ the transactional block on the same page | `OBSERVED_PUBLIC` | RB-04 |
| RBP-42 | An FAQ accordion appears both on the plan detail page and as a standalone route | `OBSERVED_PUBLIC` | RB-04, RB-05 |

## 2. Eat This Much — public page surface

### 2.1 Public versus application split

| # | Claim | Classification | Source | Method |
| --- | --- | --- | --- | --- |
| ETP-01 | The product is split into a public marketing/tools site at the root and an application under `/app/…` | `OBSERVED_PUBLIC` | ETM-02 | browser |
| ETP-02 | Registration and sign-in are `/app/registration` and `/app/login` | `OBSERVED_PUBLIC` | ETM-02 | browser |
| ETP-03 | The planner, tracking, grocery list, pantry and professional workflows all live behind `/app/…` | `DOCUMENTED_PUBLIC` | ETM-09, ETM-12, ETM-13 | webfetch |
| ETP-04 | The help centre is a separate host, `help.eatthismuch.com` | `OBSERVED_PUBLIC` | ETM-10 | webfetch |
| ETP-05 | The blog is a separate host, `blog.eatthismuch.com` | `OBSERVED_PUBLIC` | ETM-02 | browser |
| ETP-06 | No public page exposes the planner interface itself | `OBSERVED_PUBLIC` (absence across every public page consulted) | ETM-02…ETM-09 | webfetch |

### 2.2 Page inventory

| # | Page | Path | Purpose observed | Classification | Source |
| --- | --- | --- | --- | --- | --- |
| ETP-10 | Landing / home | `/` | Proposition, an inline public meal-plan generator, four feature blocks, awards and store ratings, testimonials with disclaimers, professional cross-sell, application store links | `OBSERVED_PUBLIC` | ETM-02 |
| ETP-11 | Calorie calculator | `/calculator` | A public tool: units, sex, height, weight, age, body fat, activity; six explanatory panels; cross-links to five sibling calculators | `OBSERVED_PUBLIC` | ETM-03 |
| ETP-12 | BMR calculator | `/bmr-calculator` | Sibling tool | `OBSERVED_PUBLIC` (link) / `UNKNOWN` (contents) | ETM-03 |
| ETP-13 | Calorie-deficit calculator | `/calorie-deficit-calculator` | Sibling tool | `OBSERVED_PUBLIC` (link) / `UNKNOWN` | ETM-03 |
| ETP-14 | Macro calculator | `/macro-calculator` | Sibling tool | `OBSERVED_PUBLIC` (link) / `UNKNOWN` | ETM-03 |
| ETP-15 | Protein calculator | `/protein-calculator` | Sibling tool | `OBSERVED_PUBLIC` (link) / `UNKNOWN` | ETM-03 |
| ETP-16 | TDEE calculator | `/tdee-calculator` | Sibling tool, also linked from the footer | `OBSERVED_PUBLIC` (link) / `UNKNOWN` | ETM-03 |
| ETP-17 | Diet hub | `/diet-plan` | Index of supported eating styles | `OBSERVED_PUBLIC` (link) / `UNKNOWN` | ETM-02 |
| ETP-18 | Diet landing pages | `/diet-plan/{keto,vegan,paleo,mediterranean,vegetarian}` | Five named diets promoted in the primary navigation | `OBSERVED_PUBLIC` (links) / `UNKNOWN` (contents) | ETM-02 |
| ETP-19 | Pricing | `/pricing` | Free, Premium and Professional tiers with a feature split | `OBSERVED_PUBLIC` | ETM-04 |
| ETP-20 | For professionals | `/professionals` | Two professional tiers, client limits, client access model, branding, admin dashboard | `OBSERVED_PUBLIC` | ETM-05 |
| ETP-21 | Partner API | `/partner-api` | Commercial API proposition, capability list, onboarding sequence, retention and cache terms | `OBSERVED_PUBLIC` | ETM-06 |
| ETP-22 | Food browser | `/food/browse` | Public food catalogue entry point | `OBSERVED_PUBLIC` (link) / `UNKNOWN` (deliberately not enumerated) | ETM-02 |
| ETP-23 | Nutrient glossary | `/glossary` | Reference content | `OBSERVED_PUBLIC` (link) / `UNKNOWN` | ETM-02 |
| ETP-24 | Resources | `/resources` | Reference content | `OBSERVED_PUBLIC` (link) / `UNKNOWN` | ETM-02 |
| ETP-25 | About / press / affiliate | `/about`, `/press`, `/affiliate-program` | Corporate | `OBSERVED_PUBLIC` (links) | ETM-02 |
| ETP-26 | Legal | `/privacy-policy`, `/terms`, `/copyright` | Legal, including a DMCA process | `OBSERVED_PUBLIC` | ETM-07, ETM-08 |
| ETP-27 | Gift codes | `/app/account/subscription/send-gift` | Footer link into the application | `OBSERVED_PUBLIC` (link) / `REQUIRES_PERMISSION` (contents) | ETM-02 |
| ETP-28 | How-to guide | `/how-to/` | Vendor's own description of the planner interface | `DOCUMENTED_PUBLIC` | ETM-09 |
| ETP-29 | Help centre | `help.eatthismuch.com/help/{slug}` | Category-organised articles, including an API reference | `DOCUMENTED_PUBLIC` | ETM-10…ETM-14 |
| ETP-30 | Application (planner, tracking, grocery, pantry, professional) | `/app/**` | Gated | `REQUIRES_PERMISSION` | — |

### 2.3 Navigation composition

| # | Claim | Classification | Source |
| --- | --- | --- | --- |
| ETP-40 | The primary navigation carries exactly three groups — a diets dropdown, pricing, and a professionals link — plus two authentication actions | `OBSERVED_PUBLIC` | ETM-02 |
| ETP-41 | The diets dropdown promotes five named diets and a "view all" entry, i.e. diet is treated as a top-level discovery axis | `OBSERVED_PUBLIC` | ETM-02 |
| ETP-42 | The footer is organised in three columns — resources/tools, business/corporate, legal — plus store badges and social links | `OBSERVED_PUBLIC` | ETM-03 |
| ETP-43 | Calculators are grouped as a family and cross-linked from one another, forming a tool cluster rather than isolated pages | `OBSERVED_PUBLIC` | ETM-03 |
| ETP-44 | Placing the Partner API in the footer's business column signals it is a commercial channel rather than a self-serve developer product | `INFERRED` — placement plus the absence of any self-serve signup control | ETM-02, ETM-06 |

## 3. Structural contrast between the two products

| # | Dimension | Right Bite | Eat This Much | Classification |
| --- | --- | --- | --- | --- |
| CMP-01 | Primary discovery axis | Goal- and audience-named meal plans | Diet classification and calculators | `OBSERVED_PUBLIC` |
| CMP-02 | Public depth | Ends at a subscription configurator | Ends at a set of tools plus a public generator | `OBSERVED_PUBLIC` |
| CMP-03 | Where the product lives | Predominantly a native mobile application after purchase | A web application at `/app/**`, with mobile applications alongside | `DOCUMENTED_PUBLIC` |
| CMP-04 | Transaction model | Subscription to a prepared-meal plan with delivery | Software subscription; the user cooks or logs their own food | `OBSERVED_PUBLIC` |
| CMP-05 | Professional surface | Consumer-facing dietitian consultations bundled into the plan | A separate paid professional tier managing client accounts | `OBSERVED_PUBLIC` |
| CMP-06 | Business channel | Corporate/gym/events enquiry form | A contracted Partner API | `OBSERVED_PUBLIC` |
| CMP-07 | Locale strategy | Language and region in the URL; two markets | No locale segment observed on public routes | `OBSERVED_PUBLIC` |
| CMP-08 | Marketing/transaction separation | None — the plan page is both | Clean — marketing at the root, product under `/app` | `OBSERVED_PUBLIC` |

## 4. Consequences recorded for our own information architecture

These are observations carried forward, not decisions. Decisions are made in
`17-original-product-recommendations.md`.

| # | Observation | Carried to |
| --- | --- | --- |
| CON-01 | Both products treat a public calculator as a top-of-funnel acquisition surface reachable without an account | Doc 17 §3 |
| CON-02 | Both products keep the working surface (planner, or post-purchase plan management) entirely behind authentication | Doc 17 §2 |
| CON-03 | A single page can carry catalogue, configuration and price summary without a wizard | Doc 17 §5 |
| CON-04 | Diet classification is strong enough to warrant its own route family | Doc 17 §3 |
| CON-05 | A calculator family (calorie, BMR, TDEE, macro, protein, deficit) cross-links into a cluster | Doc 17 §3 |
| CON-06 | Locale plus region in the route is a workable pattern for a multi-market GCC product | Doc 17 §3 |
