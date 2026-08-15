# S1 Subscription Semantics — Proposal for Product-Owner Review

Status: **APPROVED by the product owner, 2026-08-02, as written.** Resolves the master-plan
S1 gate (OQ-016/017/020 family). These semantics are binding for the S1 implementation.

## 1. What a plan day means: DELIVERY day, with a balance of days

A subscription is a **consumable balance of delivery days** (e.g. a 20-day plan = 20
deliveries), not a calendar range. The customer picks delivery weekdays; each fulfilled
delivery consumes one day from the balance. Skipping or pausing consumes nothing — the
balance simply stretches into the future. An optional expiry window (e.g. balance must be
used within 2× its day count) is a SEPARATE attribute, default OFF at launch. Consumption
tracking (what was eaten) is deliberately out of scope until N1.

## 2. The 24-hour rule (already in data)

Skip, pause, resume, address and window changes take effect only for deliveries more than
24 hours away (`change_cutoff_hours = 24`, per plan, already stored). Inside the window the
next delivery proceeds as scheduled.

## 3. Cancellation and refunds

Vocabulary: `active → paused → active`, `active|paused → cancelled` (terminal),
`balance exhausted → completed` (terminal). Cancellation stops all future deliveries after
the 24-hour window. **Refund of the unused balance = unused days × the effective per-day
price actually paid** (i.e. after the duration discount) — the discount already enjoyed on
delivered days is not clawed back, and the refund is recorded as a credit memo for manual
settlement until PAY1 exists (COD reality: most balances are pay-per-delivery anyway;
prepaid handling activates with PAY1).

## 4. Order generation: INCREMENTAL

Orders are generated one delivery ahead (at the 24-hour cutoff), not all in advance. This
keeps the kitchen's order list truthful, makes skips free, and avoids mass-cancelling
pre-created orders. The kitchen sees future demand through a schedule projection (a read
model over active subscriptions), not through phantom orders.

## 5. Price changes: GRANDFATHERED

A live subscription keeps the per-day price captured at purchase for its entire balance.
Price-list changes affect new subscriptions and renewals only. A renewal quotes current
prices explicitly.

## 6. Substitution when a meal is unavailable

Automatic substitution only within the same plan, same meal type, same calorie band, and
**never violating the customer's allergen declarations or exclusions** (allergy constraints
are absolute — no override). If no safe substitute exists, the delivery for that slot is
skipped WITHOUT consuming a balance day and the customer is notified. Customers may opt for
"no substitutions — skip instead" per subscription.

## 7. Launch scope

Weekly delivery-weekday selection, pause/resume/skip/cancel, address/window change, balance
view, renewal prompt at exhaustion. Free Selection (customer picks each meal) ships as
choose-ahead-of-cutoff with kitchen-default fallback. B2B recurring orders stay out (B2B
flows use quotation/agreement mechanics).

**Approve, or annotate any numbered section — S1 implementation starts on your word.**
