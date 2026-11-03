# P1 and P2 roadmap: draft

Date: 2 November 2026. Status: draft for owner review, nothing here is approved or started.

This is a sequencing plan, not an implementation plan. Each wave gets its own spec and task plan before any code, as P0 Stage 1 did. Sizes are rough estimates from the audit and no code was re-read for them: S is under a day of agent work, M is one to three days, L is more.

## Order of work

1. P0 Stage 1 finishes and merges.
2. P0 Stage 2: pause and capacity, customer notifications, prototype wording, truthful margin.
3. P0 Stage 3: refunds, stock accountability, driver and courier settlement, subscription credit.
4. P1 Waves A to D below.
5. P2 sweep, then optional items only when they earn it.

Waves A and B could start before Stage 3 finishes if you want them sooner, because they barely touch money. Wave C cannot.

## P1

### Wave A: the real team can use it

No business decision needed except roles. Do this first: it ends shared logins and makes the alerts reach the right people.

| Item | Work | Size | Depends on |
|---|---|---|---|
| Roles for real jobs | Rebuild role templates around actual jobs. Give Branch Manager kitchen display and order access, and `order.supervise_organisation`. Plain description per role. Remove or hide the 9 unused of 12 | M | Your list of job titles |
| PIN and idle lock | Shared tablet session plus a personal PIN, lock after idle, so each action names a person | L | Roles |
| Admin phone header | Fix the 33px overflow on admin pages | S | None |
| Arabic allergen labels | Translate labels cooks read | S | Arabic review |
| Stop automatic ingredient copies | Copy only on an explicit Save. Merge the existing duplicates: 72 names repeat among 576 stock rows on dev. Archiving also clears the empty stock row | M | Merge rules: which row wins |
| Holidays and branch management | Closure dates on top of weekly hours, and creating a branch from the app. Feeds the Stage 1 timing rules | M | None |
| Setup checklist and go-live gate | Guided steps and a "not open yet" state, reusing the wholesale checklist style | M | None |
| Platform "no owner" warning | Investigate why it contradicts reality. Cause unconfirmed | S | None |

### Wave B: fewer wrong orders, cleaner compliance

| Item | Work | Size | Depends on |
|---|---|---|---|
| Modifiers and notes on lines | Options on dishes that price correctly and reach the ticket. Line notes for customers and the desk | L | Which options you actually sell |
| Complaints and remakes | Complaint record tied to an order, with cost and cause | M | Stage 3 refunds, to link them |
| Temperature and HACCP logs | Simple daily record per fridge or process, inspection-ready | M | Which checks your inspector expects |

### Wave C: daily money discipline

| Item | Work | Size | Depends on |
|---|---|---|---|
| Daily close | Float, count, variance per shift, in local time | M | Stage 3 settlement |
| Purchase price control and payables | Price variance, approvals, due dates | L | Finished recipes for useful variance |
| Dish margin and cost alerts | Per-dish margin, target percentage, alerts on cost moves | M | Stage 2 truthful margin, finished recipes |

### Wave D: taking payment

| Item | Work | Size | Depends on |
|---|---|---|---|
| Card or wallet payment | Prepaid orders confirmed by webhook, replacing the unconnected skeleton | L | Decision C1, plus a provider contract and test keys |

This is last only because it is blocked. If C1 is settled early, it can move ahead of Wave C. It also reshapes refunds, so it should build on Stage 3, not before it.

## P2

### Sweep: one batch, mostly small

- Raise the shipped 60 requests per minute default. Dev already runs 600.
- Plain-language pass across kitchen catalogue pages.
- Hide "Top rated" and any filter without real data.
- Remove test data customers can see: "QA Plan A", "E2E Lean Lunch", "Amela Harrington".
- Hide the developer wording on Profile ("Editing arrives with the identity module", "Member since None", time zone UTC).
- Team and Roles dead-end on a bad link. Offer a way back, as Customers does.
- Format raw timestamps on `/apply/*` and the batch sheet, and remove raw record IDs there.
- Delivery zones: fix "No areas chosen" and "No branch serves it yet" contradicting the detail page.
- Resale products: fix "On no channel" on published items.
- Cost report: default to a month with data.
- Corporate wind-down page: hide it or fix the role error for the company's owner.
- Add "sign out everywhere" on `/devices`.
- Warn on unsold plan combinations in the price matrix.
- `/kitchens/healthzone360-kitchen` stayed on "Loading" in the audit. Confirm before fixing.

### Needs a small build

- Batches stuck In production for weeks: flag them. Require Use by. Fix "Nothing to print" on in-production labels.
- Customer record: show the order list and allergies.
- Kitchen name "Copy the English" passes the Arabic check. Stop that, then fix identical names.

### Wait for a reason

- Item-level bump and station routing: when volume needs it.
- Dine-in: only if the business changes.
- Hidden future products, about 1,300 strings: move out of the launch path when someone has time.

## Left over from Stage 1

These came out of Stage 1's reviews and were deferred. They should join the P2 sweep.

- Retry a failed Twilio send. Needed when Twilio goes live.
- Warn when an organisation has no alert recipients.
- Timings form loses edits if the week fails to refetch, and the dirty marker ignores it.
- A signed-out customer loses their return link.
- A walk-in's allergy note never reaches the driver. This needs your decision.
- The re-deliver window picker needs the desk permission.

## What I need from you

| Decision | Needed for |
|---|---|
| Your real job titles, and who does what | Roles |
| Which ingredient wins when duplicates merge | Ingredient cleanup |
| Which dish options you sell | Modifiers |
| Which daily checks your inspector expects | HACCP |
| Payment provider and markets (C1) | Card payment |
| VAT status (C5) | Tax invoices, outside P1 today |

Kitchen work in parallel, with no development: finish recipes for everything on sale. Costs, margin and purchase variance all depend on it.
