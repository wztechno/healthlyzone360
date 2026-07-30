# 12 — Professional workflow analysis

Retrieval date: **2026-07-30**.

Two different models of the health professional appear across the references, and the contrast is
more useful than either model alone.

- **Eat This Much** sells software *to* the professional. The professional is a paying customer who
  manages clients. Documented in detail on public pages and the help centre.
- **Right Bite** bundles the professional *into* the consumer offer. The dietitian is a service the
  subscriber receives. Documented only as a consumer-facing benefit.

Our platform has both: dietitians who review and enforce, and consumers who receive that review.
Both models are therefore relevant.

## 1. Eat This Much Pro — the professional as customer

### 1.1 Commercial shape

| # | Finding | Classification | Source |
| --- | --- | --- | --- |
| PRO-01 | Two professional tiers are offered, both priced per month on a quarterly billing basis, both with a free trial | `OBSERVED_PUBLIC` | ETM-05 |
| PRO-02 | Both tiers carry the **same client limit** | `OBSERVED_PUBLIC` | ETM-05 |
| PRO-03 | The tiers are separated by a **single capability**: whether clients may access the application | `OBSERVED_PUBLIC` | ETM-05 |
| PRO-04 | The lower tier is professional-only management; the client never logs in | `OBSERVED_PUBLIC` | ETM-05 |
| PRO-05 | The higher tier grants client application access, per-client permission customisation, and lets the professional view the client's logs | `OBSERVED_PUBLIC` | ETM-05 |
| PRO-06 | Professional pricing is also referenced as per-client on the consumer pricing page | `OBSERVED_PUBLIC` | ETM-04 |

**PRO-03 is a striking product decision.** The entire tier boundary is *client agency* — whether the
client is a recipient of a document or a participant in the software. That is not a feature gate; it
is a model of the professional relationship, and the vendor charges for the difference.

Our platform faces the same question in a different form: a dietitian-enforced restriction implies
the professional has authority over the consumer's plan. **Our platform should implement client
agency explicitly** — the consumer always retains their own account and their own planner, and the
professional's authority is scoped to specific enforced restrictions and to review, never to
wholesale control. That is a deliberate divergence from the reference's lower tier, and it is the
right one for a consumer marketplace.

### 1.2 Client management

| # | Capability | What the public documentation states | Classification | Source |
| --- | --- | --- | --- | --- |
| CLI-01 | Central dashboard | Multiple clients are managed from one place, with quick switching between client accounts | `DOCUMENTED_PUBLIC` | ETM-05 |
| CLI-02 | Provisioning | Clients are added individually or in bulk | `OFFICIAL_API_AVAILABLE` | ETM-11 |
| CLI-03 | Invitations | An optional invitation may be sent on provisioning | `OFFICIAL_API_AVAILABLE` | ETM-11 |
| CLI-04 | Login access | Whether a client may log in is a per-client setting, exposed as an explicit parameter | `OFFICIAL_API_AVAILABLE` | ETM-11 |
| CLI-05 | Feature grants | Per-client feature enablement is exposed as an explicit parameter, including whether the weekly planner is available | `OFFICIAL_API_AVAILABLE` | ETM-11 |
| CLI-06 | Welcome messaging | A welcome message is a provisioning parameter | `OFFICIAL_API_AVAILABLE` | ETM-11 |
| CLI-07 | Removal | Clients are removed individually or in bulk | `OFFICIAL_API_AVAILABLE` | ETM-11 |
| CLI-08 | Eligibility | The API is documented as available only to professional-tier accounts, and requires contacting the vendor first | `DOCUMENTED_PUBLIC` | ETM-11 |
| CLI-09 | Every screen implementing CLI-01 | `REQUIRES_PERMISSION` | — |

**CLI-04 and CLI-05 are the most useful rows in this document.** Because the vendor exposes client
provisioning through a documented interface, the *permission model* is visible as named parameters
in a way the screens themselves never would be. Login access and individual feature grants are
per-client, not per-tier — the tier sets the ceiling, the professional sets each client's actual
access within it.

**Our platform should implement per-client access grants rather than a single professional-client
relationship flag.** Recorded as `DEC-PRO-01`.

### 1.3 Plan authoring, notes and distribution

| # | Capability | What the public documentation states | Classification | Source |
| --- | --- | --- | --- | --- |
| AUT-01 | Plans are built against the client's calorie and macro goals, preferences and restrictions | `DOCUMENTED_PUBLIC` | ETM-05 |
| AUT-02 | Notes attach at **day level** and at **individual meal level**, through menus at each level | `DOCUMENTED_PUBLIC` | ETM-14 |
| AUT-03 | Notes are visible to the client in both web and mobile applications | `DOCUMENTED_PUBLIC` | ETM-14 |
| AUT-04 | Notes are included in exported documents and in emailed plans | `DOCUMENTED_PUBLIC` | ETM-14 |
| AUT-05 | Notes **persist across regeneration** of a meal, a day or a week | `DOCUMENTED_PUBLIC` | ETM-14 |
| AUT-06 | Notes transfer when a plan is copied | `DOCUMENTED_PUBLIC` | ETM-14 |
| AUT-07 | A note is removed by clearing its text; empty notes are not displayed | `DOCUMENTED_PUBLIC` | ETM-14 |
| AUT-08 | The documented purpose of notes is practical guidance — substitutions, brands, modifications not worth changing the recipe for | `DOCUMENTED_PUBLIC` | ETM-14 |
| AUT-09 | Plans are saved and regenerated from account history for reuse | `DOCUMENTED_PUBLIC` | ETM-05 |
| AUT-10 | Plans are distributed as documents or by email, carrying the professional's own branding, with vendor watermarking removable | `DOCUMENTED_PUBLIC` | ETM-05 |
| AUT-11 | On the higher tier the professional can view the client's logged intake | `DOCUMENTED_PUBLIC` | ETM-05 |
| AUT-12 | Every screen implementing AUT-01 to AUT-11 | `REQUIRES_PERMISSION` | — |

**AUT-05 is the single best design detail found in this research.** A note survives the plan it was
written against. That is exactly right: professional advice attaches to the *relationship and the
context*, not to a particular generated meal that a shuffle may replace a moment later. A product
that discarded notes on regeneration would be actively hostile to the professional's work.

**AUT-02's two levels are also deliberate** — a day-level note carries guidance about the day's
shape, a meal-level note carries a substitution. Our planner should offer both, plus a plan-level
note, which the reference does not appear to document.

**AUT-10 raises a governance point for our own build.** White-labelling means a document can leave
the platform bearing the professional's identity and none of the vendor's. Any equivalent export we
build must still carry the medical disclaimer and the synthetic-data marking, because removing
platform branding must not remove platform safety statements.

### 1.4 Client-side view

| # | Capability | What the public documentation states | Classification | Source |
| --- | --- | --- | --- | --- |
| CSV-01 | On the higher tier, clients use web and mobile applications to select foods, track nutrition and use shopping lists | `DOCUMENTED_PUBLIC` | ETM-05 |
| CSV-02 | Clients see professional notes in the application | `DOCUMENTED_PUBLIC` | ETM-14 |
| CSV-03 | The professional can monitor client logging and usage | `DOCUMENTED_PUBLIC` | ETM-05 |
| CSV-04 | On the lower tier the client receives documents or emails and has no application access | `DOCUMENTED_PUBLIC` | ETM-05 |
| CSV-05 | What a client sees about *which* professional set a restriction, or that a value was overridden | `UNKNOWN` — no public material addresses it | — |
| CSV-06 | Whether a client can decline or override professional guidance | `UNKNOWN` | — |
| CSV-07 | Whether the client is told their logs are visible to the professional | `UNKNOWN` | — |

**CSV-05, CSV-06 and CSV-07 are unaddressed by the reference and are consequential for us.** Our
model has clinician-enforced restrictions that outrank user preference. A user must be able to see
*that* a restriction is enforced, *who* enforced it, and *what to do* if they disagree. And a
consumer whose activity is visible to a professional must be told so. **No reference precedent
exists; design from first principles**, and treat CSV-07 as a privacy requirement rather than a
feature.

## 2. Right Bite — the professional as a bundled service

| # | Finding | Classification | Source |
| --- | --- | --- | --- |
| RBP-01 | Dietitians occupy a **primary navigation position**, level with meal plans | `OBSERVED_PUBLIC` | RB-02 |
| RBP-02 | Individual practitioners are presented by name with their own profile routes | `OBSERVED_PUBLIC` | RB-02 |
| RBP-03 | The public copy states consultations are included free with every plan, in person at a clinic or online | `DOCUMENTED_PUBLIC` | RB-05 |
| RBP-04 | A premium tier is stated to include unlimited consultations and a dedicated support line | `DOCUMENTED_PUBLIC` | RB-05 |
| RBP-05 | The public copy positions the dietitian as the authority who selects the calorie band, sets realistic targets and adjusts the plan as goals evolve | `DOCUMENTED_PUBLIC` | RB-05 |
| RBP-06 | The macro breakdown carries an explicit caveat that it varies with the dietitian's recommendations | `OBSERVED_PUBLIC` | RB-04 |
| RBP-07 | Complex dietary requirements are routed to customer service rather than handled in the interface | `DOCUMENTED_PUBLIC` | RB-05 |
| RBP-08 | The plans are described as dietitian-designed | `DOCUMENTED_PUBLIC` | RB-02 |
| RBP-09 | Any professional-facing interface | `REQUIRES_PERMISSION` — **none is publicly visible; there is no practitioner sign-in, no professional pricing, no professional marketing** | — |
| RBP-10 | Booking flow, consultation records, how a dietitian's recommendation reaches the subscriber's plan | `REQUIRES_PERMISSION` | — |

**RBP-05 and RBP-06 together describe a professional-override model without any interface for it.**
The vendor's copy makes the dietitian authoritative over the subscriber's numbers, and the
configurator admits the displayed macros bend to that authority — but nothing publicly shows a
subscriber which of their values a practitioner set, or when.

**This is precisely the gap our `ProfessionalOverride` contract and professional-override indicator
are meant to close.** The reference validates that the *relationship* exists and is commercially
central; it offers no precedent for *surfacing* it. We design that from first principles.

## 3. Contrast, and what each model teaches

| Dimension | Eat This Much | Right Bite | Our position |
| --- | --- | --- | --- |
| Who pays for the professional | The professional pays for software | The consumer pays; the professional is bundled | Both: dietitians are platform actors; review may be bundled or paid |
| Client agency | A paid tier boundary | Not addressed publicly | Always retained by the consumer |
| Where advice attaches | Notes on days and meals, surviving regeneration | Not publicly visible | Notes at plan, day and entry level, surviving regeneration |
| Professional authority over values | Not publicly addressed | Asserted in copy, invisible in interface | Explicit, attributed and visible |
| Restriction enforcement | Not distinguished from preference | Complex cases escalated to a human | Six distinct restriction kinds; enforced ones outrank preference |
| Distribution | Branded documents and email | Not publicly visible | Export placeholder; disclaimers survive branding |
| Escalation to a human | Not publicly addressed | Explicit — customer service | Explicit — safety escalation and review-request states |
| Provisioning | Documented, including through an interface | Not publicly visible | Our own dietitian review queue |

## 4. Requirements our professional experience takes from this

| # | Our platform should implement… | Justified by |
| --- | --- | --- |
| PRQ-01 | …notes at plan, day and entry level, persisting across regeneration at every scope, and included in any export | AUT-02, AUT-05, AUT-06 |
| PRQ-02 | …per-client access grants rather than a single relationship flag | CLI-04, CLI-05 |
| PRQ-03 | …a visible professional-override indicator naming who set a value and when | RBP-05, RBP-06, CSV-05 |
| PRQ-04 | …a client-facing explanation of any enforced restriction, and a defined route to question it | CSV-06 |
| PRQ-05 | …explicit disclosure to the consumer when a professional can see their activity | CSV-07 |
| PRQ-06 | …an explicit human-escalation route for requirements the interface must not absorb | RBP-07 |
| PRQ-07 | …practitioner profiles surfaced publicly by name and credential before any commitment | RBP-01, RBP-02 |
| PRQ-08 | …a review queue and review-detail surface for the dietitian, since neither reference exposes one | §1, §2 |
| PRQ-09 | …medical disclaimers and synthetic-data marking that survive any branding or export | AUT-10 |
| PRQ-10 | …plan templates saved and reused across clients | AUT-09 |

## 5. Gaps

| Item | Classification |
| --- | --- |
| Every Eat This Much professional screen | `REQUIRES_PERMISSION` |
| Every Right Bite dietitian-facing screen | `REQUIRES_PERMISSION` — none publicly visible |
| Right Bite consultation booking flow | `REQUIRES_PERMISSION` |
| How a Right Bite dietitian's recommendation propagates into a subscriber's plan | `UNKNOWN` |
| Whether either product has a review queue, an approval state or an audit trail | `UNKNOWN` |
| Whether either product distinguishes clinician-enforced restrictions from user preferences | `UNKNOWN` — no public material distinguishes them |
| Client consent and data-visibility disclosure in either product | `UNKNOWN` |
