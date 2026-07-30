# 11 — Subscription flow analysis

Right Bite's public subscription configurator, walked to the personal-data checkpoint.
Retrieval date: **2026-07-30**.

## 1. The flow as it is publicly reachable

The configurator is not a wizard. It is a **single page** carrying three decisions, a derived price
and one action.

```
Plan catalogue  →  Plan detail page
                     ├── 1. Package type   (5 single-select options)
                     ├── 2. Calorie band   (5 single-select options)
                     ├── 3. Duration       (4 single-select options, 3 discounted)
                     ├──    Start date     → deferred: "chosen after checkout"
                     ├──    Preferences    → deferred: "customise after purchase"
                     ├──    Delivery days  → deferred: "managed in the app"
                     ├──    Nutrition breakdown (macro ranges + variability caveat)
                     └──    Subtotal  +  [ Subscribe ]  ◀── CHECKPOINT
                                                            everything beyond is
                                                            REQUIRES_PERMISSION
```

| # | Finding | Classification | Source |
| --- | --- | --- | --- |
| SUB-01 | The entire pre-purchase configuration is **three decisions** | `OBSERVED_PUBLIC` | RB-04 |
| SUB-02 | No account, no identity and no personal data is required to reach a priced configuration | `OBSERVED_PUBLIC` | RB-04 |
| SUB-03 | Configuration, nutrition summary and price summary are co-located on one page, not split into steps | `OBSERVED_PUBLIC` | RB-04 |
| SUB-04 | Marketing content continues below the transactional block on the same page | `OBSERVED_PUBLIC` | RB-04 |
| SUB-05 | No basket exists. The flow goes from configuration straight to subscription | `OBSERVED_PUBLIC` (absence of any basket affordance) | RB-04 |
| SUB-06 | No plan-comparison surface exists anywhere in the public flow | `OBSERVED_PUBLIC` (absence) | RB-03, RB-04 |

## 2. The three decisions in detail

### 2.1 Package type

| # | Finding | Classification |
| --- | --- | --- |
| PKG-01 | Five options, presented as cards with a short code or icon, a primary label and a secondary line | `OBSERVED_PUBLIC` |
| PKG-02 | The options vary along **two independent axes at once**: which meals of the day are included, and whether sides and snacks are included | `OBSERVED_PUBLIC` |
| PKG-03 | Exactly one option is explicitly the without-sides-and-snacks variant; the other four include them | `OBSERVED_PUBLIC` |
| PKG-04 | Because two axes are flattened into one list, the list is not a complete cross-product — only one of the meal combinations is offered in both variants | `OBSERVED_PUBLIC` |
| PKG-05 | A note immediately beneath states that dietary preferences are configured after purchase | `OBSERVED_PUBLIC` |
| PKG-06 | Which option is selected by default | `UNKNOWN` — selected-state rendering was not observable |

**PKG-04 is a modelling lesson.** Flattening a two-dimensional choice into a one-dimensional list
keeps the interface simple, but it forces the vendor to curate which combinations exist and leaves
the user unable to express an unlisted one. **Our platform should model meal combination and
snack inclusion as two separate attributes of a plan variant** and derive the offered set from
kitchen configuration, rather than hand-curating a flat list.

### 2.2 Calorie band

| # | Finding | Classification |
| --- | --- | --- |
| CAL-01 | Five contiguous, non-overlapping bands, each presented as a range | `OBSERVED_PUBLIC` |
| CAL-02 | The bands are of uniform width and rise in uniform steps | `OBSERVED_PUBLIC` |
| CAL-03 | No exact calorie figure is offered or accepted anywhere in the public flow | `OBSERVED_PUBLIC` |
| CAL-04 | An inline guidance link sits beneath the group for users who do not know which band to choose | `OBSERVED_PUBLIC` |
| CAL-05 | The guidance destination's content | `UNKNOWN` — not retrieved |
| CAL-06 | Whether the macro ranges respond to the chosen band | `UNKNOWN` — not exercisable |

**Bands rather than a number is the right choice for a prepared-meal product**, because a kitchen
cannot hit an arbitrary calorie figure across a rotating menu. Our marketplace has the same
constraint for kitchen-delivered plans and a *different* one for home-prepared plans, where an exact
target is achievable. **Our platform should implement band selection for kitchen-delivered
subscriptions and exact targets for home-prepared planning**, and should not force one model onto
both.

### 2.3 Duration and discount

| # | Finding | Classification |
| --- | --- | --- |
| DUR-01 | Four options, expressed as counts of days rather than weeks or months | `OBSERVED_PUBLIC` |
| DUR-02 | The shortest option carries no discount badge; the other three do | `OBSERVED_PUBLIC` |
| DUR-03 | The discount percentage rises with duration | `OBSERVED_PUBLIC` |
| DUR-04 | The increase in discount is **not proportional** to the increase in duration — the step from the shortest discounted option to the next is much smaller than the step after it | `OBSERVED_PUBLIC` |
| DUR-05 | Discounts are presented as a badge attached to the option, not as a separate promotional block | `OBSERVED_PUBLIC` |
| DUR-06 | Expressing duration in days rather than weeks decouples the commitment from the delivery schedule, which matters because the vendor states delivery does not run every day | `INFERRED` — see `RB-INF-05` |

**DUR-06 is the most transferable insight in this section.** A subscriber buys *a number of meal
days*, and separately chooses *which days* they arrive. This is a materially better model than a
calendar-period subscription for a product with pauses, skips and non-delivery days: the entitlement
is a balance to be consumed, not a window that expires. It also explains how a pause can be offered
without loss. **Our platform should model a kitchen subscription as a consumable balance of
delivery days**, not as a date range.

### 2.4 Price summary

| # | Finding | Classification |
| --- | --- | --- |
| PRC-01 | A single subtotal line is presented immediately above the primary action | `OBSERVED_PUBLIC` |
| PRC-02 | No line-item breakdown, no per-meal derivation, no tax line, no delivery line is shown | `OBSERVED_PUBLIC` |
| PRC-03 | Catalogue cards quote a "starting from" **per-meal** price, while the configurator quotes a **total** subtotal — two different units in one journey | `OBSERVED_PUBLIC` |
| PRC-04 | The subtotal recomputes on selection change | `INFERRED` — see `RB-INF-03` |
| PRC-05 | Whether the discount is shown as a saved amount, a struck-through original, or only as the badge | `UNKNOWN` |

**PRC-03 is worth avoiding.** Moving from a per-meal price on the card to a total on the detail page
makes the two numbers incomparable at exactly the moment the user is comparing. **Our platform
should show both units in both places**, with one clearly primary.

## 3. What is deferred past the checkpoint, and how it is communicated

| # | Deferred item | How the public interface communicates it | Classification |
| --- | --- | --- |
| DEF-01 | Start date | A labelled block in the configurator's own visual flow states the choice is made after checkout | `OBSERVED_PUBLIC` |
| DEF-02 | Dietary preference (vegan, pescatarian and others) | A note under the package selector states customisation happens after purchase | `OBSERVED_PUBLIC` |
| DEF-03 | Delivery days | A line under the duration heading states day flexibility is managed in the application | `OBSERVED_PUBLIC` |
| DEF-04 | Delivery address | The FAQ states availability is confirmed at checkout by entering a location | `DOCUMENTED_PUBLIC` |
| DEF-05 | Delivery slot | Presented as a benefit tile, not as a configurable option | `OBSERVED_PUBLIC` |
| DEF-06 | Allergies | Stated in the FAQ to be flagged in the application; complex requirements routed to customer service | `DOCUMENTED_PUBLIC` |
| DEF-07 | Meal selection | Stated in the FAQ to happen in the application from a rotating menu | `DOCUMENTED_PUBLIC` |
| DEF-08 | Payment | Not present anywhere in the public flow | `REQUIRES_PERMISSION` |

**The pattern is good; two of its applications are not.** Occupying an input's visual slot with a
notice explaining that the choice comes later is far better than silently omitting it — the user
knows the decision exists and is not surprised later. **Our platform should adopt this
deferred-input notice as a component** (doc 04, RBC-23).

But two deferrals are risky rather than merely inconvenient:

- **DEF-04, delivery address.** A subscriber commits to a package before knowing whether their
  address is served. The FAQ says availability is confirmed at checkout — after the pricing
  decision.
- **DEF-06, allergies.** A subscriber commits money before knowing whether their allergy can be
  accommodated, and the vendor's own copy admits some requirements need a human conversation.

**Our platform should implement a delivery-area check and an allergy check *before* the price
summary**, not after it. Both are cheap to ask, both are dispositive, and both protect the user from
a purchase that cannot be fulfilled. This is recorded as `DEC-SUB-01` and carried to doc 17 §5.

## 4. The checkpoint, stated precisely

**The personal-data checkpoint is the `Subscribe` control at the foot of the plan configurator on
`/en-ae/subscribe-to-a-plan/{plan}`.**

| # | Property of the checkpoint | Classification |
| --- | --- | --- |
| CHK-01 | The control carries **no hyperlink target**; it is script-driven | `OBSERVED_PUBLIC` |
| CHK-02 | No anonymous guest-checkout path exists anywhere in the public surface examined | `OBSERVED_PUBLIC` (absence) |
| CHK-03 | The only authentication affordance is a header control that opens an in-page panel rather than a public route | `OBSERVED_PUBLIC` |
| CHK-04 | Three independent statements in the vendor's own copy confirm that identity, address, scheduling and preferences are collected beyond it | `DOCUMENTED_PUBLIC` |
| CHK-05 | Everything beyond the control | `REQUIRES_PERMISSION` |

**No attempt was made to pass this checkpoint.** No account was created, no credential was entered,
no personal data was submitted. What lies beyond it is enumerated for a permissioned session in
`15-rightbite-manual-capture-checklist.md`.

## 5. Post-purchase subscription management — documented only

| # | Capability | What the public documentation states | Classification |
| --- | --- | --- | --- |
| MGT-01 | Pause | Available in the application, stated in the FAQ to require advance notice | `DOCUMENTED_PUBLIC` |
| MGT-02 | Hold | The terms describe placing the package on hold with a notice period | `DOCUMENTED_PUBLIC` |
| MGT-03 | **Notice-period inconsistency** | The FAQ's stated window and the terms' stated notice period **do not agree** | `DOCUMENTED_PUBLIC` — recorded as `RB-INC-01` |
| MGT-04 | Resume | **Not described anywhere in the public copy examined** | `UNKNOWN` |
| MGT-05 | Skip a day | Day flexibility is claimed; a distinct skip action is not named | `DOCUMENTED_PUBLIC` (implied) / `UNKNOWN` (mechanism) |
| MGT-06 | Subscription term | The terms state a fixed period within which all days must be used | `DOCUMENTED_PUBLIC` |
| MGT-07 | Unused days | The terms state unused days may be transferred to another person | `DOCUMENTED_PUBLIC` |
| MGT-08 | Refunds | The terms state a non-refund policy with named exceptions for undelivered, incorrect or missing orders, subject to approval and a stated processing window | `DOCUMENTED_PUBLIC` |
| MGT-09 | Address change | The terms state a notice period in working days | `DOCUMENTED_PUBLIC` |
| MGT-10 | Delivery window | The terms state a multi-hour delivery window | `DOCUMENTED_PUBLIC` |
| MGT-11 | Delivery frequency | The FAQ states deliveries run six days a week, with market-specific non-delivery days, and that meals for a non-delivery day arrive with the previous delivery | `DOCUMENTED_PUBLIC` |
| MGT-12 | Every screen implementing MGT-01 to MGT-11 | `REQUIRES_PERMISSION` |

**MGT-11 is an operational rule with real interface consequences.** If a delivery day and a
consumption day can differ, then a subscription interface must show *both*, and a "skip" must be
unambiguous about which one it skips. Neither our specification nor our current planner design
distinguishes them. Recorded as an open question in doc 13 §5.

**MGT-07 is unusual and instructive**: transferability turns the subscription into a bearer
entitlement. We are not obliged to copy it, but it confirms the balance model of DUR-06.

## 6. Business subscription

| # | Finding | Classification | Source |
| --- | --- | --- | --- |
| BIZ-01 | Corporate access is positioned as discounted employee access to the same consumer plans, not as a separate catalogue | `OBSERVED_PUBLIC` | RB-06 |
| BIZ-02 | No minimum order quantity, volume tier, contract price or lead time appears anywhere publicly | `OBSERVED_PUBLIC` (absence) | RB-06 |
| BIZ-03 | Business pricing is reached only through an enquiry form | `OBSERVED_PUBLIC` | RB-06 |
| BIZ-04 | Event catering is presented as a distinct proposition from recurring corporate supply | `OBSERVED_PUBLIC` | RB-06 |
| BIZ-05 | Everything after enquiry submission | `REQUIRES_PERMISSION` | — |

**BIZ-02 independently supports our own fixed rule** that customer-facing screens must never expose
business contract prices. The reference keeps them entirely private, and our specification's
business-price-privacy test asserts the same property.

## 7. Summary of what our subscription flow should take, and reject

| # | Take | Reject |
| --- | --- | --- |
| 1 | Three-decision pre-purchase configuration; keep it short | — |
| 2 | Deferred-input notices that occupy the slot and explain the deferral | Deferring **delivery-area** and **allergy** checks past the price summary |
| 3 | Duration as a consumable balance of delivery days | Duration as a calendar window |
| 4 | Discount badges attached to the duration option itself | — |
| 5 | Calorie bands for kitchen-delivered plans | Bands as the only model — home-prepared planning takes exact targets |
| 6 | Macro ranges with an explicit variability caveat | — |
| 7 | Business pricing behind an enquiry | — |
| 8 | One authoritative source for the cut-off window, rendered from one value | Two different notice periods in two documents (`RB-INC-01`) |
| 9 | Both price units — per meal and total — visible in both catalogue and detail | Switching units between card and detail page |
| 10 | An explicit resume action, designed and named | Leaving resume undocumented, as the reference does (`MGT-04`) |
| 11 | Meal combination and snack inclusion as two modelled attributes | A hand-curated flat list of combinations (`PKG-04`) |
| 12 | A plan-comparison surface | Its absence — neither reference offers one, and a fourteen-plan catalogue needs one |
