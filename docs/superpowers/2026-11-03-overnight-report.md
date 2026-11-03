# Overnight build report

3 November 2026. Branch `P0-Stage1`, pushed. Nothing merged, nothing deployed.

## Decide before deploying

1. **Phone lookup privacy.** A cashier at any kitchen can type a registered customer's exact phone number and see their name, phone and allergies, even if the customer has never ordered there. The link is permanent, and the customer isn't told. It is audited, and that kitchen can't change the customer's contact details, but it can add an address, because a first delivery needs one. This came from your request to find B2C customers. Keep it, make it expire, or limit it.
2. **Settlement cut-off.** Migration `2026_11_03_050101` takes driver runs delivered more than two days before deploy off the settlement list for good, on the assumption the cash came back. They stay in the cash report. Check the count and total first.
3. **Sauces and sides.** A choice has no allergen data of its own. Adding a choice to a dish takes it off sale only if it was assessed by the manual button. A dish assessed through a recipe or ingredients stays on sale with an undeclared allergen possible. Decide whether each choice should carry its own allergens. This is the most important food-safety gap left.
4. **Closures and standing orders.** Subscription days and accepted quotations ignore closure dates, so a delivery can fall on a holiday.
5. **Held stock.** A sale larger than free stock passes when the shelf is also short, then meets the hold at deduction. Online customers get no warning.
6. **Courier fees on prepaid orders.** There is no agreed place to record them, so a fee on a prepaid run is not netted and the hand-in reads short.
7. **Kitchens not yet open.** They appear in the marketplace and refuse only at checkout. Hide them?
8. **One till.** Daily close assumes one till per kitchen, while a kitchen can now add a second branch.
9. **Walk-in allergy notes.** A note with no saved profile shows no banner on the driver's sheet.

## What was built

| Area | Built |
|---|---|
| P0 Stage 1 | Staff alerts, impossible orders, allergies to the cook, Not assessed, kitchen display, past due, cancel and cash, failed delivery, couriers, refresh bug |
| P0 Stage 2 | Order desk customer-first with B2C and allergens, Off today, Pause, capacity, portions, customer notifications, prototype wording, truthful margin |
| P0 Stage 3 | Refunds and approvals, driver and courier settlement, stock actor and reason, valued waste, Activity page, credit promise removed, no tax claims |
| Food safety | Quarantine release, QC hold enforced, expiry alerts |
| P1 Wave A | Job roles, phone header, Arabic allergen labels, explicit ingredient copy, merge command, closures, new branch, setup gate, no-owner bug |
| P1 Wave B | Dish options, line notes, complaints, remakes, fridge and cooking logs |
| P1 Wave C | Daily close, price variance, payables, dish margins and alerts |
| P2 | The sweep in the roadmap, plus the slug loading bug |

## Evidence

- **API tests:** 2,023 tests across every touched module; 2,022 passed. The one failure was a date-pinned test, fixed, and its file then passed 21 of 21. That final fix was not followed by another run of all modules.
- **Screen tests:** 1,043 of 1,043 in the 30 changed files.
- **Typecheck:** all 11 packages passed before the last test-only fixes.
- **Live, on a throwaway copy of the database:** closed week, past date, zone minimum, calendar day off, and allergy conflict all refused. Anaphylaxis reached the kitchen payload. Cancelling closed the job, and the order left the driver list. Cancel after pick-up refused. Over-collection refused. A double delivery press wrote one receipt, of the right amount. The kitchen display returned every open order with no truncation, with 63 open.
- **All migrations ran** on a copy of your local database, so they work on existing data.
- **Browser, on a real build:** refresh stays on `/customer/account`. New Order opens on the customer step, shows Carla's life-threatening egg allergy, and marks dishes "Contains Eggs". Kitchen display shows the severe allergy banner and Turn on sound. Bell panel works in Arabic and dark mode, with no sideways scrolling on the orders page.

## Not verified

- **The full test suite has not run.** Only touched modules did. It should run once on the PR.
- **Not seen in a browser:** refund, settlement, daily close, complaints, temperature logs, payables, dish options on the customer side, setup checklist, role pages. These have screen tests only.
- **React error 418 (hydration mismatch)** shows in the console on the built site. I didn't find out whether it predates this work.
- **Native apps, real printers and real SMS** were not tested. SMS stays off until the Twilio keys are on the server.
- **Arabic copy** was written by agents and has not been reviewed by a person. That includes 64 product names added to the demo seed.
- **Order Desk "Off today"** shows on every tile. Check it suits your cashiers.

## Not built

- PIN and idle lock: a new sign-in step that couldn't be exercised overnight.
- Lot-level recall tracing: the largest food-safety item.
- Whish Checkout: waiting for your API and credentials.
- Rejecting or correcting a posted purchase price, part payments, per-branch tills.
- Options and notes on the customer's own order page and receipt.
- Missed temperature reading alerts, and a minimum core temperature rule.

## Deploy checklist

1. Run `catalogue:report-unassessed`. Those dishes come off sale on deploy.
2. Run `kitchen:suspect-records` and review the test data customers can see.
3. Decide item 2 above before migrating.
4. Run `kitchen:merge-duplicate-stock --org=<slug>`, then `--apply`. `--apply` needs the environment allowlisted. Shelves that both have movements go to the review list.
5. Count stale `placed` orders, because the display and escalation start from them.
6. Demo databases need a fresh seed. The demo seed stamps products "contains none", including Honey Mustard Sauce and Mozzarella Sticks. That is untrue, so don't use the demo world for allergen claims.
7. Set the dish target and price approval limit, or those checks stay off.

`scripts/test-changed.sh` and the cloud CI scripts are only on `origin/Cloud-CI`, not on this branch, so check the PR's full run actually triggers.

## Decisions made on your behalf

- T4 creates universal/src/features/kds/alert-tone.ts (playAlertTone) and T9 consumes it — the bell needs it first — nothing lost if wrong, the file only moves.
- openMinutesSince moves from T10 to T9. /catalogue/kitchen-display returns unaccepted_open_minutes {orderId: int} and alarm_after_minutes; isAlarming(openMinutes, alarmAfterMinutes) replaces the plan's signature, so the client never re-derives opening hours — costs one extra lookup per poll if wrong.
- T7 extends the BuyerAllergenCheck contract with declared(CustomerAccount): list so the snapshot records every allergy, per spec — cost if wrong: one more contract method.
- T12 exposes delivery pick-up on KitchenOrder (delivery.pickedUpAt) — cost if wrong: an extra query on the kitchen order payload.
- Implementers write tests but run none until Task 16 (owner instruction 26 Oct); they run php -l, Pint, ESLint and typecheck on changed files instead, so reviewers read tests without run evidence — cost: failures surface late, in Task 16.
- Work happens on branch P0-Stage1 in the main checkout rather than a worktree, because Pest in a worktree needs vendor junction surgery (memory) — cost if wrong: another session writing this checkout collides; explicit-path staging limits that.
- All implementers and reviewers run on Opus 5.5, one at a time, per the approved plan.
- The permission is order.supervise_organisation, not the spec's order.supervise — PermissionRegistryTest requires the _organisation suffix and carving out an exception would be the first — cost if wrong: a rename; every later dispatch and the spec use the new name.
- staff_notifications.data never holds customer names, allergy notes or other personal data — order number, money and a severity flag only — so closure anonymisation does not need to touch it — cost if wrong: an alert shows less detail, the link to the order still does.
- "Owner" means roles matching organisation_owner or its _standard[_N] copies, because the role-split migration moved template holders onto copies — cost if wrong: an extra regex in NoticeRecipients::owners.
- Alerts link to /kitchen/orders?order=<id>, opening the same detail a row opens, added in Task 4, and the email link follows — no per-order route exists — cost if wrong: one query param.
- Reversed the earlier ?order= ruling: alerts link to the existing ?view=<id>, because that param already opens any order by id — cost if wrong: none, one fewer redirect.
- Accepted quotation orders keep today's behaviour and skip the new timing rules, like subscriptions — the date was agreed in writing and a refusal partway through a multi-week acceptance could strand it — cost if wrong: a quoted date on a closed day still goes through and shows on the kitchen calendar.
- Counter sales get the calendar check, per the spec's Desk column — cost if wrong: one line to exempt them.
- Review Focus 1's 23:30 Beirut example was wrong (same UTC date); the implementer's added 00:30 Beirut tests cover the real case.
- Owner asked for speed (2 Nov). Reviews now run alongside the next group's implementer instead of blocking it, and related tasks batch into one agent (7-8, 9-11, 12-14, 15). Review fixes are applied between groups, never while another writer is active, and re-reviews of small fix diffs use Sonnet — cost if wrong: a later group may build on code a review then changes.
- Owner asked (2 Nov) to finish all tasks, then test at the end. No per-group reviews after Tasks 5-6: Tasks 7-15 build straight through, then one whole-branch review on Opus, its fixes, then Task 16 tests — cost if wrong: defects surface in one batch at the end rather than per group.
- I3 fixed per spec — the table limits only window_ended to today; cost if wrong: an order for tomorrow morning can be refused under a large lead time.
- A weekday with no opening-hours row counts as open for the alarm clock, matching explain() accepting it — fails loud, not silent — cost if wrong: extra alarms for a part-configured kitchen.
- Dateless orders count as past due from placed_at, the existing DUE_AT clock; fix the OpenAPI wording in final review — cost if wrong: a higher past-due number.
- A repeat delivery failure on one order must reach managers again: final fix wave makes DeliveryFailed reset read_at and re-send, rather than change the unique index — cost if wrong: one more email per repeat failure.
- Failed runs must not read "out for delivery" to the customer or on the KDS, and the API must refuse a plain Cancel on a failed run: both go in the final fix wave.
- Refresh cause proven: the gate keeps Slot unmounted, usePathname reads /customer, customer/_layout line 46 redirected. Fix verified on a patched scratch bundle only.
- I4: orders for a later day neither alarm nor escalate until their own day, because subscriptions and quotations sit placed by design — cost if wrong: a next-week order can sit unaccepted until its day, when it still alarms.
- I5: assessment is enforced for quotations at creation and acceptance; the earlier ruling covered timing only — cost if wrong: a quotation with an unassessed dish is refused until someone assesses it.
- M4: existing cancelled orders' open runs close through a one-off migration (only where picked_up_at is null) — cost if wrong: old open runs on dev are marked cancelled, which is true of their orders.
- Owner (2 Nov evening): build next phases overnight in parallel, commit and push all into one branch, owner opens the PR. Lanes share this checkout on P0-Stage1 (worktrees would need vendor and node_modules surgery and merging generated files), three writers at a time for memory, tests only at the end — cost if wrong: a lane's commit may contain a sliver of another lane's shared-file edit; harmless since all lands on one branch.
- Whish Checkout is not built: no API or credentials. Manual Whish stays.
- Keep the exact-phone lookup for tonight because the owner asked for B2C customers with allergens, and surface it first in the morning report — cost if wrong: one policy arm to remove before deploy; nothing is deployed.
- I1: phone-link kitchens can read but not change a customer's contact details; adding an address stays, because a first delivery needs one — owner decides in the morning.
- I4: stop-gap: adding or renaming a sauce or side choice clears the assessment, so the dish goes off sale until checked — cost if wrong: a dish disappears after a menu edit until re-checked.
