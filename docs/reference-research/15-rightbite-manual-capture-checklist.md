# 15 — Right Bite manual-capture checklist

Retrieval date: **2026-07-30**.

## 1. What this document is for

Research stopped at the `Subscribe` control on Right Bite's plan configurator (doc 11 §4). Beyond it
lies an account, a checkout and a mobile application, and our policy forbids the agent creating an
account, signing in, entering personal data or making a payment — on request or otherwise.

Everything beyond that checkpoint is classified `REQUIRES_PERMISSION`. **This checklist converts
that classification into an actionable list**, so that if a person with a legitimate account chooses
to capture this material themselves, they know exactly what to record and why.

**Nothing here is a request that anyone subscribe, pay or share personal data.** Each item is
useful only if a legitimate account already exists for independent reasons. Any capture must
redact personal data — names, addresses, telephone numbers, payment details, order identifiers —
before it reaches this repository.

**How to record a captured item.** Add a row to the relevant table in documents 02 to 12 classified
`USER_PROVIDED`, with the capture date and a note of what was redacted. `USER_PROVIDED` never
becomes `OBSERVED_PUBLIC`: the distinction is that the observation came from a permissioned session,
not from a public surface.

## 2. Priority summary

| Priority | Items | Why |
| --- | --- | --- |
| **P1 — highest value** | 3.1 checkout sequence · 3.2 allergy and preference capture · 3.5 pause, resume and skip | Each resolves an open question that currently blocks or weakens a design decision |
| **P2 — high value** | 3.3 delivery scheduling · 3.4 meal selection and replacement · 3.7 account and plan overview | Each would replace an assumption with an observation on a screen we are building |
| **P3 — useful** | 3.6 meal rating · 3.8 delivery status · 3.9 mobile application patterns · 3.10 the subscription-model question | Each would refine rather than redirect a design |

## 3. The checklist

### 3.1 Checkout sequence — P1

**What to record.** The ordered list of steps between the `Subscribe` control and a completed
subscription. For each step: its purpose, its fields, whether it is skippable, whether it can be
returned to, and whether the price summary remains visible. Specifically: at which step is delivery
address first requested; at which step is serviceability of that address confirmed; at which step
are allergies or dietary preferences first requested; at which step is the start date chosen; at
which step is payment requested; and whether any step warns that a configured plan cannot be
fulfilled.

**Which of our assumptions rest on it.** Doc 11 §3 — that delivery-area and allergy checks fall
*after* the pricing decision (`DEF-04`, `DEF-06`). Our recommendation to move both *before* the
price summary (`DEC-SUB-01`, open question `OQ-02`) is currently argued from principle rather than
from an observed counter-example.

**Which of our screens would change.** The subscription configurator, the checkout preview, and the
ordering of the plan-configuration steps. If serviceability turns out to be checked earlier than the
public copy implies, our recommendation softens from "move it" to "keep it where it is".

### 3.2 Allergy and dietary-preference capture — P1

**What to record.** The screen or screens where allergies, intolerances and dietary preferences are
declared. Which categories are offered; whether allergy is distinguished from preference or dislike;
whether severity is captured; what happens when a declared allergy conflicts with the chosen plan;
whether a warning, a block or a human handoff results; and the exact wording of any safety message.
Record the escalation route when a requirement exceeds what the interface accepts.

**Which of our assumptions rest on it.** `UNK-10` — that no reference distinguishes our six
restriction kinds. Doc 05, `FLD-08`. Doc 10, `REQ-10`. This is the largest precedent gap in the
entire document set.

**Which of our screens would change.** Onboarding steps 12 to 14 (allergies, medical and
dietitian-enforced restrictions, disliked ingredients); the allergy-warning state in the planner;
the restriction-conflict and safety-escalation states in the Virtual Dietitian; the allergen
difference preview in the replacement drawer.

### 3.3 Delivery scheduling — P2

**What to record.** How delivery days are chosen and changed; how delivery slots are presented and
selected; whether slots vary by area or day; how multiple addresses are managed and whether an
address is per-subscription or per-delivery; the notice period enforced by the interface for an
address change, and whether it matches the published terms; and how the interface presents a
non-delivery day and the meals that arrive early to cover it.

**Which of our assumptions rest on it.** Open question `OQ-01` — whether a delivery day and a
consumption day can differ, and what "skip" therefore means. `RB-INC-01` — the two conflicting
notice periods.

**Which of our screens would change.** The delivery-day and delivery-slot steps of the subscription
configurator; the change-address and change-slot prototypes; and potentially the planner itself, if
delivery days and eating days must be shown as distinct axes.

### 3.4 Meal selection and replacement — P2

**What to record.** How the rotating menu is browsed; what a meal card shows in the account area
(nutrition? allergens? price?); how far ahead selection is possible; the cut-off for changing a
selection; how a meal is replaced and whether the replacement is constrained to equivalent calories
or macros; whether nutrition differences are previewed; and what happens when a selection is not
made in time.

**Which of our assumptions rest on it.** Doc 03, RB-J2 steps 3 to 5 — currently
`DOCUMENTED_PUBLIC` from FAQ copy alone, with no observed interface. Our replacement drawer's
nutrition, cost and allergen difference previews have **no reference precedent** and would gain one.

**Which of our screens would change.** The meal-replacement drawer and its filters; the plan-entry
card; the cut-off and locking semantics for kitchen-delivered entries, which differ from
home-prepared ones.

### 3.5 Pause, resume and skip — P1

**What to record.** Each action separately. For pause: where it lives, what it asks (a date range? a
count of days?), the enforced notice period, what the confirmation says, and what happens to the
remaining balance. For resume: whether it exists as a distinct action at all, where it lives, and
whether a resume date is chosen. For skip: whether it is distinct from pause, whether it operates on
a single day, and whether the skipped day returns to the balance.

**Which of our assumptions rest on it.** `UNK-11` — resume is not described anywhere in the public
copy. `RB-INF-05` — the consumable-balance model (doc 13 §4). `RB-INC-01` — the conflicting notice
periods. `OQ-01` — what a skip skips.

**Which of our screens would change.** The pause, resume and skip-day prototypes in subscription
management; the subscription detail screen's presentation of remaining entitlement; and whether our
subscription model is a balance, a window, or the hybrid doc 13 §4 suspects.

### 3.6 Meal rating — P3

**What to record.** Where rating appears; its scale; whether it is per meal, per delivery or per
dish; whether a comment accompanies it; whether the user is shown any consequence of rating; and
whether past ratings influence later menus visibly.

**Which of our assumptions rest on it.** Doc 03, RB-J2 step 4. Our design-system `Rating` component
is display-only by prior decision, and interactive rating submission is an explicit exclusion.

**Which of our screens would change.** Probably none in this phase. Valuable for the next phase, and
for deciding whether ratings feed the planner's soft preferences.

### 3.7 Account and plan overview — P2

**What to record.** The landing screen of the account area. What is summarised: remaining days,
next delivery, current plan, nutrition targets, dietitian notes? Which actions are primary? Is there
a plan-history or past-orders view? Is any nutrition information shown at all in the account area,
and if so at what granularity — per meal, per day, per plan?

**Which of our assumptions rest on it.** Doc 09 §5 — that the reference shows no per-meal nutrition
panel *publicly*. Whether it does so privately is unknown and would materially change our reading of
`RBN-08` and of our own differentiator `IMP-08`.

**Which of our screens would change.** The consumer home screen; the subscription detail screen; and
our judgement about how much nutrition detail a meal-delivery customer actually wants.

### 3.8 Delivery status — P3

**What to record.** Whether a status exists at all; its states; whether tracking, a courier identity
or an estimated time is shown; and how a failed or missed delivery is presented and resolved.

**Which of our assumptions rest on it.** Doc 06, RBI-27 — delivery status is not described anywhere
in the public copy. It appears in our specification's Right Bite topic list but has no public
evidence whatsoever.

**Which of our screens would change.** None currently planned. Would inform a future delivery
module, which is outside this phase's scope.

### 3.9 Mobile application patterns — P3

**What to record.** Structure only, and only at a level that informs our own original design:
navigation model (tabs? drawer?); whether the primary action is pinned; how the plan is presented on
a narrow screen (agenda? calendar?); whether Arabic and right-to-left are supported and how
direction-sensitive motion behaves; and whether touch targets meet the conventional minimum.

**Which of our assumptions rest on it.** Doc 08, CNV-05 and CNV-06 — neither reference *website*
uses a pinned action bar or bottom tabs, which diverges from our own universal-application plan. The
divergence is expected, but observing the reference's native application would confirm whether the
pattern reappears there.

**Which of our screens would change.** None directly. Confirms or challenges our navigation model.
**Capture structure, never screenshots into the repository, and never any brand asset** (doc 14,
CPY-03, CPY-04).

### 3.10 The subscription-model question — P3

**What to record.** One specific thing: whether the remaining entitlement is displayed as a count of
days, as an end date, or as both; and what the interface says happens at expiry when days remain
unused.

**Which of our assumptions rest on it.** `RB-INF-05` (doc 13 §4) — the medium-risk inference, and
the hybrid-model suspicion.

**Which of our screens would change.** The subscription detail screen's primary summary figure.

## 4. Coverage map — every gated topic from the specification

The specification's Right Bite topic list, with status and checklist reference:

| Topic | Status | Checklist item |
| --- | --- | --- |
| Meal-plan catalogue, categories, plan cards | `OBSERVED_PUBLIC` | — |
| Goal-based plans, plan detail, plan variants | `OBSERVED_PUBLIC` | — |
| Meal combinations, calorie-range selection | `OBSERVED_PUBLIC` | — |
| Protein / carbohydrate / fat ranges | `OBSERVED_PUBLIC` | — |
| Package durations, duration discounts | `OBSERVED_PUBLIC` | — |
| Sample menus | link `OBSERVED_PUBLIC`; contents deliberately not retrieved | — |
| Meal images | `OBSERVED_PUBLIC` (captions only; no asset downloaded) | — |
| Dietitian-consultation presentation | `OBSERVED_PUBLIC` | — |
| Mobile-app promotion | `OBSERVED_PUBLIC` | — |
| Corporate and bulk meal presentation | `OBSERVED_PUBLIC` (proposition); pricing `REQUIRES_PERMISSION` | — |
| Subscription subtotal | `OBSERVED_PUBLIC` | — |
| **Dietary preferences** | `REQUIRES_PERMISSION` | 3.2 |
| **Allergy collection** | `REQUIRES_PERMISSION` | 3.2 |
| **Start-date selection** | `REQUIRES_PERMISSION` | 3.1 |
| **Delivery-day selection** | `REQUIRES_PERMISSION` | 3.3 |
| **Delivery-address entry** | `REQUIRES_PERMISSION` | 3.1, 3.3 |
| **Delivery-slot selection** | `REQUIRES_PERMISSION` | 3.3 |
| **Checkout sequence** | `REQUIRES_PERMISSION` | 3.1 |
| **Pause** | `REQUIRES_PERMISSION` | 3.5 |
| **Resume** | `REQUIRES_PERMISSION` — not even documented | 3.5 |
| **Skip** | `REQUIRES_PERMISSION` | 3.5 |
| **Meal selection** | `REQUIRES_PERMISSION` | 3.4 |
| **Meal replacement** | `REQUIRES_PERMISSION` | 3.4 |
| **Meal rating** | `REQUIRES_PERMISSION` | 3.6 |
| **Delivery status** | `REQUIRES_PERMISSION` — not even documented | 3.8 |

Eleven of the twenty-five topics are fully covered from public sources; fourteen require a
permissioned session. **That ratio is a property of the reference product, not a shortfall in this
research** — Right Bite deliberately places its entire product experience behind purchase.

## 5. Rules for any capture

1. Redact all personal data before anything reaches this repository: names, addresses, telephone
   numbers, email addresses, payment details, order and subscription identifiers.
2. Record **structure and behaviour**, not content. Do not transcribe meal names, descriptions,
   prices or menu contents (doc 14, CPY-01, CPY-02, CPY-06, CPY-08).
3. Do not commit screenshots or any downloaded asset (doc 14, CPY-03).
4. Classify every added row `USER_PROVIDED`, with the capture date.
5. Note explicitly what was redacted or omitted, so a later reader knows the record is partial.
6. When an item resolves an inference or an unknown, update `13-observed-vs-inferred.md` in the same
   change — remove the row from the ledger and note where the resolution now lives.
