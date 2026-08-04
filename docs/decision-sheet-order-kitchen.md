# Order-Kitchen Programme — Product-Owner Decision Sheet

Date: 2026-08-02 · Status of the build when written: P0/K1/M1 complete; J1/C1/G1/B1 domains +
frontends committed, backend integrator in flight; J2/B2/HARD1 queued. Everything below is a
decision only you can make — nothing here blocks the currently running work, but each item
unblocks something specific.

## A. Food safety — blocks publishing ANY workbook recipe/meal (risk R1)

**A1. Burghul + Pita bread contradiction.** Your ingredient sheet tags both allergen class
"None"; the same workbook's allergen key files burghul and bread under Cereals/Gluten. Both
are quarantined (`requires_review`) and every recipe using them is unpublishable until
resolved. Recommendation: add the gluten mapping (burghul is cracked wheat; pita is wheat
bread) — but this is a regulatory declaration and the call is yours.

**A2. ~73 technical-sheet ingredients have no allergen determination** (Mayonnaise, Panko,
Flour, Butter, Fresh Cream, the cheeses, Soy Sauce, Worcestershire Sauce, the mustards,
Beef Stock, Louisiana Sauce, …full list in the import report
`storage/app/private/import-reports/`). The publish gate refuses every recipe version using
an undetermined ingredient. Options: (a) I derive standard-knowledge mappings and flag each
`requires_supplier_confirmation` for your kitchen to confirm (fastest, honest); (b) your
kitchen team reviews the list manually first; (c) leave everything unpublishable for now.

**A3. Duplicate Caesar Sauce.** Two different formulas imported as draft v1 (Sheet 1, yield
3.336 kg) and v2 (Sheet 25, yield 1.90 kg). Neither is published. Which is current?

## B. Commercial data — blocks publishing plans and zone pricing

**B1. Real plan prices.** The workbook's pricing sheet carries availability flags only. All
plan prices are NULL placeholders; plans are structurally unpublishable and the public plans
page stays on prototype data until real numbers exist. Needed: the per-day price for each
offered combination × calorie band × duration (or a simpler rule I can expand).

**B2. Duration discounts** for 5/20/40/60-day runs — currently "not set" (never zero).

**B3. Workbook kitchen delivery economics.** The org-wide zone covering your 125 areas has NULL
fee and NULL minimum order (unknown ≠ free); the three delivery windows have no clock times.
**Defaults recorded 2026-08-04 (OQ-045 / §B3):** seed fees and window clock times from owner
approximations (same posture as plan prices — provisional, editable through administration).
A NULL fee stays NULL in the database; checkout and previews show a delivery line only when
the resolved fee is non-null (never silently treat unknown as free).

## C. Journey policy (config placeholders exist; confirm or change)

**C1. Retention windows (OQ-029/030, legal review recommended):** provisional account purge
30 days · guest return window 14 days · guest retention 90 days · OTP challenge purge 30 days.
**C2. Minimum age** for the age-confirmation consent (OQ-031) — nothing set; 18 is the
conventional default in your markets.
**C3. B2B defaults (OQ-032):** notice period 30 days; who may waive settlement.

## D. Phase gates (each opens a build phase currently stopped by design)

**D1. S1 Subscriptions — the big one.** Cannot start until you decide: does a planner day
mean delivery or consumption (balance-of-days model)? Cancellation vocabulary + refund
semantics? Are future orders generated in advance or incrementally? Do price changes affect
live subscriptions? How are unavailable meals substituted, and how do allergies constrain
substitution?
**D2. PAY1 Payments** — **defaults recorded 2026-08-04 (Phase 2 discovery).** Pluggable
`PaymentProvider` interface; first real provider is a regional aggregator (Lebanon + launch
markets). Cash on delivery remains first-class alongside card and invoice methods. Card data
never touches our schema — no PAN storage, no card columns on orders (`OrderArchitectureTest`
enforces this). Sandbox card flow uses `FakeCardPaymentProvider` until the aggregator is
selected. Payment state lives in the Payments module (`payment_intents` keyed by `order_id`),
not on `orders`.
**D3. SMS provider (A-011/INT-005)** — pick one (e.g. Twilio) to enable phone-required
activation in production; today email-only activation is the production path and SMS/WhatsApp
are simulated in dev.
**D4. F1 fulfilment, N1 nutrition source, CL1 clinical** — each needs its mandated discovery
session; N1 specifically needs an authoritative nutrient data source before any nutrition
figure becomes real. **F1 default recorded 2026-08-04:** in-house driver jobs first (`delivery_jobs`
owned by the Delivery module, driver assignment and proof-of-delivery on our stack); third-party
logistics providers and marketplace courier integration deferred until after F1 ops are proven.

## F. Operations modules — defaults recorded 2026-08-04

**ADR-0012 (offline persistence).** POS and KDS ship as **online-only** MVPs: registers,
shifts, tickets and bump states require live API connectivity. Offline caching, local
transaction queues and sync-after-reconnect are deferred until ADR-0012 threat models and
provider selection are complete.

**Inventory v1.** Stock is a **movement ledger without valuation**: `stock_movements` record
quantity deltas (adjust, waste, procurement receipt, production consume/yield) with no cost
column and no inventory valuation surface in this phase.

## E. Language

**E1. Arabic review (OQ-033):** allergen class names, consent texts and ~271 seeded
`name_ar` fallbacks are machine-assisted or English-fallback and marked pending review — who
reviews, and when? (French remains deferred, OQ-007.)
