# P0 Stage 1: safety and order flow

Date: 2 November 2026. Status: awaiting owner review.

## Goal

Stop the failures that can hurt a customer or lose an order. When Stage 1 ships:

- The kitchen is never promised an order it cannot make.
- Every allergy reaches the cook, with proof the warning was given.
- No open order can be missing from the kitchen display, and an ignored order reaches a person.
- Every order ends in a true state, and cash is only recorded when it was collected.

Stages 2 and 3 get their own specs. Owner rulings are in full in the "Owner rulings" section at the end.

## Workstreams

Eight pieces, built in this order. Each one can be reviewed alone. The notifications piece comes first because the alarm, failed-delivery and allergy pieces all use it.

### 1. Staff notifications

Nothing exists today: no records, no bell, no push. Email covers sign-in codes, invitations, closure and notices only.

**Data.** New table `staff_notifications`: `id`, `organisation_id`, `user_id`, `type`, `subject_type`, `subject_id`, `data` (jsonb), `read_at`, `created_at`. Unique on `(user_id, type, subject_id)`, so a repeated job cannot alert twice. Uses the standard organisation row-level security policy, and every query also filters on `user_id`, pinned by a test.

**Why not Laravel's `notifications` table.** It has no organisation column, so it cannot carry the tenant policy.

**Sending.** One service, `StaffAlerts`, in the `support` module:
1. Writes one row per recipient.
2. Queues an email through the existing `NoticeMessage`, after commit, in the recipient's language.
3. For the `escalation` level only, sends an SMS when Twilio is configured.

Orders and delivery call it directly, as `b2b` and `inventory` already call `support`. There is no module-boundary test to satisfy, and a port with one implementation adds nothing.

**SMS.** A small `TwilioSms` class using Laravel's `Http` client, with no new package. It reads `TWILIO_SID`, `TWILIO_TOKEN` and `TWILIO_FROM`. With any of them missing it sends nothing and logs one line. Stage 2 reuses it for customers. The number comes from the user's phone contact point in `contact_points`. A recipient with none gets the bell and email only.

**Endpoints.** Under `/catalogue`, because `/me` routes carry no tenant context and row-level security would return nothing. All three need `order.supervise_organisation`.
- `GET /catalogue/staff-notifications` returns recent rows and the unread count.
- `POST /catalogue/staff-notifications/{id}/read`
- `POST /catalogue/staff-notifications/read-all`

**Screen.** A bell in the top bar controls, built like `KeptWorkButton` in `shell/kept-work-dock.tsx` and mounted from `app/kitchen/_layout.tsx`, showing the unread count and opening a panel hung from the top bar. Each item links to its order. It polls every 30 seconds with `refetchInterval`, as the display and desk do. A new unread row shows a toast and plays a short tone while the app is open. Bilingual, both themes, logical utilities only. `/showcase` is updated if a shared component changes.

**Events and timing.**

| Event | Who | When | Level |
|---|---|---|---|
| Order not accepted | Display alarm only | 5 minutes | none |
| Still not accepted | Managers | 10 minutes | escalation |
| Still not accepted | Owner | 20 minutes | escalation |
| New order with an allergy | Managers | At placement | alert |
| Cancelled after cooking started | Owner | At cancel | alert |
| Failed delivery | Managers | At failure | alert |
| Driver collected no cash | Managers | At delivery | alert |

**Recipients.** "Managers" are users holding the new permission `order.supervise_organisation`. "Owner" is the `organisation_owner` role. See workstream 7 for who holds the permission.

**The clock.** The unaccepted timer counts only while a branch is open, read from `branch_opening_hours`, so an order placed at 2am does not wake anyone. It starts at opening time. A kitchen with no opening hours set counts around the clock, so a missing setting cannot silence an alarm.

**Job.** `EscalateUnacceptedOrders`, scheduled every minute in `routes/console.php`. The unique index makes it safe to repeat.

**Settings.** New table `kitchen_service_settings`, one row per organisation, created with defaults when first read: `order_lead_minutes` 120, `alarm_after_minutes` 5, `manager_alert_after_minutes` 10, `owner_alert_after_minutes` 20. Edited on the existing `/kitchen/branch-operating` page, under the catalogue-manage permission that page already checks.

**Limit.** A phone with the app closed gets email, then SMS once Twilio is on. No phone push in this stage.

### 2. Impossible orders

**Root cause.** A customer basket usually has `branch_id` null, and `scheduleReasons()` returns nothing when the branch is null. So closed days, past dates and cut-offs are all skipped (`OrderPlacementService.php:1189`).

**Branch used for checks.** Resolve in this order: the cart's branch, the zone's branch, then the organisation's active branches. With several branches, the order passes if any one accepts it. A kitchen with no active branch is refused as `kitchen_closed`.

**Orders stay as they are.** `orders.branch_id` is still written as it is today. Writing the resolved branch would change stock and reporting paths that this stage has no reason to touch.

**Rules added to the shared checks.**

| Rule | Refusal | Customer | Desk | Subscription |
|---|---|---|---|---|
| Closed day, past date, cut-off | existing reasons | yes | yes | unchanged |
| Window already ended today | `window_ended` | yes | yes | no |
| Lead time, window `starts_at` minus `order_lead_minutes` | `lead_time_not_met` | yes | no | no |
| Zone minimum, `minimum_order_minor` | `below_zone_minimum` | yes | no | no |
| Calendar day off or sold out | `item_unavailable_on_date` | yes | yes | no |

- Today runs in the branch's timezone. A window with no `starts_at` or `ends_at` skips the time rules.
- The desk skips lead time because a cashier is talking to the kitchen, and skips the minimum because staff can agree a small order.
- Subscription deliveries keep today's behaviour, for the reason the code already gives: a standing subscriber is not refused retroactively.

**Calendar rule.** A `catalogue_item_availability_days` row with `is_available` false, or `remaining_portions` 0, refuses that item on that date. A row's `order_cut_off_at` is enforced for same-day orders. An item with no row for the date stays available, or every item without a calendar would vanish. The check goes in `LineProbe`, so basket, preview and placement agree. Counting portions down is Stage 2.

**Same answer everywhere.** `CheckoutPreviewService` runs the same rules and returns them as warnings, so the customer learns at checkout. Refusal text is added in English, Arabic and en-XA.

### 3. Allergies reach the cook

**On the order.** New columns on `orders`:
- `allergy_snapshot` (jsonb): each declared allergy with severity and notes, and which line it conflicts with.
- `allergy_note` (text): free text.
- `allergy_acknowledged_at`
- `allergy_acknowledged_by`: the staff id, or null when the customer acknowledged.

The snapshot is written in `persist()`, so customer, desk and subscription orders are all covered, and it records every declared allergy, not only conflicts. The cook should know about a severe allergy even if the check found no match. `Order` gets the matching data classification, and `OrderSnapshotRedaction` clears these fields when an account is anonymised, since this is health data.

**Online.** The existing acknowledgement stays. A conflict is refused until acknowledged, then the order goes through.

**Desk.** `composeNow()` runs the same check when `placedOnBehalfBy` is set. The sale screen shows the conflict and needs a tick that the customer was told. Any desk order can take an allergy note, which is how a walk-in with no profile is covered. Order amendments re-run the check and refresh the snapshot.

**Shown as a banner on.** The kitchen display ticket, the kitchen order detail, the order desk row and the driver sheet. The driver sees allergen names only, not notes or severity detail. Severe allergies use the danger tone, with icon and wording as well as colour.

### 4. Not assessed dishes

**Today.** A dish with no allergens shows "None declared by the kitchen", which reads as safe even when nobody checked.

**Assessed means** one of:
1. A published recipe version with at least one ingredient line.
2. At least one allergen recorded through the item's ingredients.
3. An ingredient link on an item that is exactly one ingredient.
4. A staff member pressed "Assessed: contains none of these". This writes `allergens_assessed_at` and `allergens_assessed_by` to `catalogue_items`, and is audited.

**Effect.** An unassessed dish is off sale: refused in `LineProbe` as `item_not_assessed`, and hidden from marketplace and B2B lists. The desk picker needs no filter, because its shelf quote already marks refused items as not sold. It stays in the kitchen catalogue with a "Not assessed" badge and the button above. Six items on dev are in this state today.

**Empty recipes.** A dish on sale with no published recipe gets a staff warning badge in the catalogue list and item page, and stays on sale. Withholding margin is Stage 2.

**Rollout.** Deploying takes those dishes off sale at once, so the release notes list them first. A read-only command, `catalogue:report-unassessed`, prints the list for any environment.

### 5. Kitchen display cannot lose a ticket

**Dedicated list.** New `GET /catalogue/kitchen-display` returns every open order plus today's fulfilled ones, unpaged, oldest first. The board's branch rule stays in `kds-board.ts`. A cap of 500 sets `truncated: true`, and the screen says so rather than quietly dropping work. "Every open ticket" then becomes true.

**Stale board.** A failed refresh keeps the last board on screen with a banner showing when it last updated. Today the error replaces the board.

**Sound.** A tone generated with the browser's `AudioContext`, with no audio file or package. Browsers need one press first, so the screen shows "Turn on sound" until pressed. It sounds on each new order, and repeats while the alarm is on.

**Keep awake.** The browser's `navigator.wakeLock`, re-requested when the tab returns. The display is a web surface, so no native package is added.

**Alarm.** A placed order older than `alarm_after_minutes` during open hours turns red, with an age label and the repeating tone, until accepted.

### 6. Past due tells the truth

`OrderDeskQueue` returns `past_due_count` and `overdue_count` across all dates, using the same due clock as `dueAt`. The two figures in `order-desk-screen.tsx` read those instead of counting the rows on screen, so the docblock at line 1105 is rewritten. A "Past due" filter shows those orders. The other figures keep describing the current view.

### 7. Cancel and delivery end truthfully

**Permission.** New `order.supervise_organisation`, held by `organisation_owner`, `organisation_admin` and `kitchen_manager`. `branch_manager` holds no order permissions today, so it is left for the P1 "Roles for real jobs" work.

**Cancelling.**

| Order state | Who | Extra answer |
|---|---|---|
| Placed, or confirmed and not started | Anyone with `order.manage_organisation` | Reason, as today |
| Cooking started, or ready | `order.supervise_organisation` | Reason, plus returned or wasted |
| Picked up by driver or courier | Nobody | Must close as delivered or failed |

- **Returned or wasted.** New column `cancellation_disposition`. Returned restores stock, as `cancel()` does today. Wasted leaves the deduction in place, so the cost stays counted. Valuing waste is Stage 3.
- **Closing the job.** `cancel()` also calls a new `DeliveryJobProjection::cancel()`, which sets the job to `cancelled` unless it is already closed, so it leaves the driver's list. The docblock at `OrderLifecycle.php:266` says this asymmetry is deliberate. That ruling is reversed, because the live test showed a cancelled order offered to drivers, so the docblock is rewritten too.

**Cash is recorded only when collected.** `takeCashRemainder()` stops writing a receipt for delivery orders. Pickup and counter orders are unchanged.
- The driver sheet shows the amount due, which needs `total_minor` and the amount already paid on the job payload. The comment at `driver-jobs-screen.tsx:51` is rewritten.
- `POST /driver/jobs/{job}/deliver` takes `collected_minor`. The screen fills in the amount due and the driver can change it. A short amount writes a part receipt and leaves the rest outstanding. Zero is allowed, with a required note, and a manager is alerted.
- WISH orders are unchanged: unpaid until the reference is checked.
- A delivery order fulfilled from the display or desk is left unpaid and appears in Unsettled, where staff use the existing payment action.

**Failed delivery.** New `POST /driver/jobs/{job}/fail` with a reason (`no_answer`, `wrong_address`, `refused`, `unreachable`, `other`) and an optional note. The job gets status `failed`, which the table's check already allows, plus `failed_at`, `failure_reason` and `failure_note`. The order stays confirmed and managers are alerted. `failed` joins `CLOSED_STATUSES` in the driver list and in `DeliveryJobProjector`. A manager then chooses in the order detail:
- **Re-deliver:** the job returns to `pending` with the driver cleared and pickup reset, and can be given a new date and window.
- **Close as failed:** cancels with the new reason `delivery_failed`, plus returned or wasted.

**Couriers, by hand.** New `delivery_jobs` columns `courier_name`, `courier_reference` and `courier_fee_minor`. On the order desk, "Hand to courier" records them and sets `picked_up_at`. Staff then mark it delivered or failed on the courier's behalf, using the same two actions. Cash from couriers stays unpaid until batch settlement in Stage 3.

**Held for Stage 3.** Per-shift driver settlement and courier batch settlement.

### 8. Customer refresh bug

Refreshing or opening any `/customer/*` link sends a signed-in customer to `/discover`, on dev.

**Cause not confirmed.** The audit guessed at the `viewOnly` redirect in `app/customer/_layout.tsx`, but reading the code does not support that guess: while restoring, a customer has no membership and no allowed staff area, so `viewOnly` stays false. Next suspects are `isPathAvailable`, the static export's first render of `pathname`, and the nginx `try_files` order.

**Approach.** Reproduce on a production-style static build first, find the actual cause, then fix it. A test fails before the fix and passes after. The same fix must cover checkout and order tracking links.

## Migrations

All additive. New tables `staff_notifications` and `kitchen_service_settings`, with row-level security. New nullable columns on `orders`, `delivery_jobs` and `catalogue_items`. No database check needs changing: `delivery_jobs.status` already allows `failed` and `cancelled`, and `cancellation_reason` is a plain string, so `delivery_failed` is added to the enum only. New permission `order.supervise_organisation`, synced to role templates.

Existing orders are left as they are: no back-filled allergies, no back-filled receipts.

## Testing

Tests are written as each piece is built and run together at the end, as you asked. The full suite never runs on this PC: targeted Pest and Jest run here by path, because `scripts/test-changed.sh` exists only on `origin/Cloud-CI`, and the full run happens in the cloud session when the PR is marked ready.

- **Pest:** one test per refusal, covering customer, desk, subscription and preview. Allergy snapshot on all three order paths, and its removal on anonymise. Cancel by state and permission. Job closure. Collected, short and zero cash. Fail, re-deliver and close. Escalation timing with the clock pinned, repeat runs and closed hours. A kitchen display of 31 orders returns all 31.
- **Row-level security:** the two new tables are tested through `RuntimeRole::run`, because Pest runs as the migrator and would otherwise bypass policies.
- **Jest:** bell, banner, alarm and stale-board states, English and Arabic geometry for new layouts.
- **Live walk:** the audit scripts are re-run against a cloned local database, repeating every proven failure. They do not run on dev.

## Delivery

- New branch `P0-Stage1` from `New-updated`, as a draft PR into `dev`.
- `pnpm gen:api` and `pnpm gen:i18n-keys` run with each change.
- Nothing deploys unless you ask. The deploy needs the release note listing the dishes that come off sale.

## Out of scope

Pause and capacity, customer notifications, prototype wording and truthful margin (Stage 2). Refunds, stock accountability, settlement, tax and subscription credit (Stage 3). Phone push. Branch manager role access. Merging duplicate ingredients.

## Owner rulings

Recorded 2 November 2026.

- Three stages, each reviewed before the next.
- Lead time is per kitchen, default 2 hours before the window starts.
- Unaccepted orders alarm, then escalate. Nothing happens automatically.
- Online allergy conflicts are allowed after acknowledgement and flagged loudly.
- At the desk, the cashier must confirm the customer was told, and walk-ins get an allergy note.
- After cooking starts, managers only may cancel, until out for delivery, answering returned or wasted.
- Own drivers plus couriers. Couriers are entered by hand. Cash is never recorded automatically.
- Failed deliveries record a reason and a manager decides.
- Managers and owners get in-app notifications as well as email. SMS is built switched off until Twilio keys are added.
- Unassessed dishes come off sale. Empty-recipe dishes stay on sale with a staff warning.
