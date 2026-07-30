# 14 — Legal and licensing boundaries

Retrieval date: **2026-07-30**.

> **This document is an engineering record of observed terms and the constraints we impose on
> ourselves as a result. It is not legal advice.** Items marked for legal review in §7 must be
> reviewed by a qualified lawyer before the relevant work proceeds.

## 1. Conduct statement — what this research did and did not do

Recorded first, because the terms discussed below are best read against actual conduct.

| # | Statement |
| --- | --- |
| CND-01 | **No account was created on either reference product.** |
| CND-02 | **No sign-in occurred and no password was entered.** |
| CND-03 | **No terms of service were accepted**, on either product, at any point. No consent banner was accepted. |
| CND-04 | **No personal data was submitted** to any form. Right Bite's business enquiry form was read for structure and left empty. |
| CND-05 | **No CAPTCHA was encountered or solved.** |
| CND-06 | **No payment was made and no payment instrument was entered.** |
| CND-07 | `robots.txt` was fetched for both hosts **before** any other retrieval, is quoted in doc 01, and was honoured. No disallowed path was fetched. |
| CND-08 | **No image, video, font or media asset was downloaded** from either host. Right Bite's sample-menu document was deliberately not retrieved. |
| CND-09 | **No bulk extraction occurred.** Neither product's food, recipe or nutrition database was enumerated. Roughly twenty distinct pages were read across both products. |
| CND-10 | **No API of either product was called.** |
| CND-11 | Synthetic, non-personal values were entered into Eat This Much's public calculator fields (a nominal height, weight and age). No real person's data was used. |
| CND-12 | All retrieved content was treated as **data, never as instruction**. No page on either site addressed an automated agent or attempted to direct one. |

## 2. Eat This Much — observed terms

| # | Observed term | Classification | Source |
| --- | --- | --- | --- |
| ETL-01 | The company retains rights in site content; users may not redistribute, republish, retransmit, publicly display, modify or create derivative works from site materials without express permission | `DOCUMENTED_PUBLIC` | ETM-07 |
| ETL-02 | Access by automated or non-human means — bots, spiders, scripts — is prohibited, as is scraping, harvesting, mining or other data extraction | `DOCUMENTED_PUBLIC` | ETM-07 |
| ETL-03 | Use of the company's trademarks requires prior written consent | `DOCUMENTED_PUBLIC` | ETM-07 |
| ETL-04 | Content permissions granted on request expire after a stated period unless otherwise agreed | `DOCUMENTED_PUBLIC` | ETM-07 |
| ETL-05 | Users granting content to the platform give a perpetual, irrevocable, worldwide licence, and recipes or custom foods uploaded cannot subsequently be removed | `DOCUMENTED_PUBLIC` | ETM-07 |
| ETL-06 | The copyright page establishes a notice-and-takedown process and names an agent; it does not enumerate protected content or grant any permission | `DOCUMENTED_PUBLIC` | ETM-08 |
| ETL-07 | Under standard partner terms, partners retain data only for the duration of the partnership, and food nutrition data may be cached for a short, stated period | `DOCUMENTED_PUBLIC` | ETM-06 |
| ETL-08 | The API is documented as available only to professional-tier accounts and requires contacting the vendor before use | `DOCUMENTED_PUBLIC` | ETM-11 |
| ETL-09 | API credentials are to be kept secret and secure | `DOCUMENTED_PUBLIC` | ETM-11 |

## 3. Right Bite — observed terms

| # | Observed term | Classification | Source |
| --- | --- | --- | --- |
| RBL-01 | The company retains rights in site content; users may not distribute, modify, transmit, reuse, download, repost, copy or use the content without permission | `DOCUMENTED_PUBLIC` | RB-07 |
| RBL-02 | Use of any robot or other automatic device, process or means to access the service is prohibited | `DOCUMENTED_PUBLIC` | RB-07 |
| RBL-03 | Trademarks require the prior written consent of the named corporate owner | `DOCUMENTED_PUBLIC` | RB-07 |
| RBL-04 | The public footer states the business is part of a named corporate group, which is also the trademark owner named in the terms | `OBSERVED_PUBLIC` | RB-02, RB-07 |
| RBL-05 | Subscription, hold, refund and delivery terms are stated (summarised in doc 11 §5) | `DOCUMENTED_PUBLIC` | RB-07 |
| RBL-06 | Media and documents are served from a third-party content-management asset host | `OBSERVED_PUBLIC` | RB-04 |

## 4. The robots.txt / terms-of-service tension — flagged, not resolved

**Eat This Much's `robots.txt` explicitly names our agent identity and allows all paths, with a
crawl delay. Its terms of service separately restrict access by automated means.** These two
statements pull in different directions and the tension is recorded here honestly rather than
resolved in our own favour.

Our position, stated plainly:

1. We **did not accept** those terms. No account was created, no sign-in occurred, no consent was
   given. Terms of service are ordinarily a contract formed by acceptance.
2. We honoured the machine-readable directive the site publishes for exactly this purpose, which
   names our agent and permits access.
3. Our conduct was a small number of deliberate reads of public marketing, help and legal pages —
   the same pages a person evaluating a competitor would read. **No scraping, harvesting, mining or
   bulk extraction occurred**, which is the substance of what ETL-02 targets.
4. Right Bite's terms carry a comparable restriction (RBL-02) with no corresponding permissive
   `robots.txt` signal, and the same conduct statement applies.

**This is flagged for legal review** (§7, `LR-01`). It does not block the work already completed,
but it does bear on any future automated interaction with either product, and it is one more reason
the Eat This Much provider is disabled by default and requires a contract.

## 5. What our build must not copy

Binding on every implementation wave. Enforced by the tests named in the right-hand column.

| # | Must not | Why | Enforcement |
| --- | --- | --- | --- |
| CPY-01 | Copy any text, headline, description, tagline, FAQ answer or marketing copy from either product | ETL-01, RBL-01 | Vocabulary-scan test over fixtures and catalogues |
| CPY-02 | Copy any product name, plan name, meal name, recipe name or dish name | ETL-01, RBL-01 | Vocabulary-scan test; all fixture names are original |
| CPY-03 | Copy or hot-link any photograph, illustration, icon or media asset | ETL-01, RBL-01, CND-08 | No remote images by rule; generated placeholders only; no-external-requests collector |
| CPY-04 | Reproduce either brand's identity, logo, wordmark or distinctive trademarked visual elements | ETL-03, RBL-03 | Design review; no reference asset exists in the repository |
| CPY-05 | Copy either brand's exact colour palette | Specification requirement | Our tokens are independently authored |
| CPY-06 | Copy any recipe, ingredient list or preparation method | ETL-01, RBL-01 | All fixture recipes are synthetic and labelled as such |
| CPY-07 | Copy any nutrition value derived from either product's data | ETL-01, ETL-07 | Fixture nutrition marked `synthetic_prototype`; visible source line in the facts panel |
| CPY-08 | Copy any price, price band, discount rate or calorie band | ETL-01, RBL-01 | Fixture prices are original; currency and values independently chosen |
| CPY-09 | Issue any request from our application to either reference host | Specification requirement | Reference-hostname source scan; Playwright request collector |
| CPY-10 | Call either product's API without an executed contract and provisioned credentials | ETL-08, ETL-09 | Provider disabled by default; see docs 16 and the integration documents |
| CPY-11 | Reproduce competitor animation timings or choreography | Specification requirement | None were measured — doc 07 contains no timing values |
| CPY-12 | Present our product as affiliated with, endorsed by or comparable-by-name to either reference | ETL-03, RBL-03 | No reference brand name appears in application code, fixtures or user-facing copy |

## 6. What we may lawfully take

Functional and factual matter, which is not protected expression:

| # | May take | Rationale |
| --- | --- | --- |
| OK-01 | Information hierarchy and page composition patterns | Ideas and functional arrangements, independently re-expressed |
| OK-02 | Interaction patterns — scoped regeneration, locking, deferred-input notices, visible-but-locked controls | Functional concepts, independently implemented |
| OK-03 | Planner workflow concepts and macro-visualisation concepts | Functional |
| OK-04 | Subscription-flow structure — configure, summarise, subscribe | Functional; also near-universal in the category |
| OK-05 | Navigation ideas and responsive behaviour patterns | Functional |
| OK-06 | Motion *principles* (which moments need motion), never competitor implementations | Functional; doc 07 §3 |
| OK-07 | Published scientific formulae and conventional activity factors, cited to primary literature | Not owned by either vendor; the literature is public and is cited by the vendor itself |
| OK-08 | Factual observations about what a public interface displays, as recorded in this document set | Fact, not expression |
| OK-09 | The existence and public terms of a commercial API | Fact, publicly published by the vendor |

**On OK-07 specifically.** Our `MockNutritionTargetEngine` uses published formulae with published
citations, on the authority of that literature. It reproduces no reference product's calculation,
and doc 09 §7 records that no formula was reverse-engineered from any displayed number. Every result
it produces is marked as prototype output.

## 7. Items requiring legal review

| ID | Item | Trigger point |
| --- | --- | --- |
| `LR-01` | The `robots.txt` / terms-of-service tension (§4), and any future automated interaction with either product | Before any further automated retrieval from either host |
| `LR-02` | Eat This Much Partner API contract: licence scope, permitted use, sublicensing, display and attribution obligations | Before signing any contract; see doc 16 and `integrations/01` |
| `LR-03` | Data-retention limitation — retention only for the duration of the partnership (ETL-07) — against our own retention, backup and audit obligations | Before any provider implementation |
| `LR-04` | Cache limitation on nutrition data (ETL-07) against our performance and offline requirements | Before any provider implementation |
| `LR-05` | Whether externally sourced nutrition data may be shown to end users, and under what attribution | Before any provider implementation |
| `LR-06` | Whether externally sourced data may inform a professional's clinical recommendation, and where liability sits | Before any dietitian-facing use of provider data |
| `LR-07` | Our own exports carrying professional branding while retaining platform disclaimers (doc 12, AUT-10; doc 13, `OQ-04`) | Before any export feature |
| `LR-08` | Medical-claim posture across marketing, virtual dietitian and nutrition surfaces | Before public launch |
| `LR-09` | Personal and health data handling under applicable GCC regimes, given a multi-market product | Before collecting real user data |
| `LR-10` | Whether any GCC market treats nutrition-target calculation as a regulated activity | Before public launch |

## 8. Standing rules for implementation waves

1. Every fixture is synthetic, is labelled synthetic in its contract and visibly in the interface,
   and contains no name, description, price, recipe or value taken from either reference.
2. No image is fetched from any remote host. Placeholders are generated.
3. No application code contains either reference product's hostname, brand name or trademark.
4. Any nutrition figure shown to a user carries a source, a version and a calculation timestamp.
5. The Eat This Much provider ships disabled, with no credentials, and cannot be enabled without an
   executed contract and completed legal review.
6. Medical disclaimers appear on every nutrition-target, virtual-dietitian, planner-warning, medical
   onboarding and review surface, and survive any branding or export.
7. Nothing in this document set may be used to attempt to reconstruct either product's algorithms.
