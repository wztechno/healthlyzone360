# Supplier Management and Stock Ordering — Revised Implementation Plan

Status: proposed for approval. Baseline: branch `Suppliers` at `ff18b98`.

This revision treats the four decisions recorded in the source draft as approved:

- Phase 1 exports through a web print view and the browser's **Print / Save as PDF** flow.
- Printed order sheets contain no purchase prices.
- Supplier administration keeps the existing inventory view/manage permissions; preparing and
  issuing supply orders gets a new permission.
- Supplier records include address, payment terms and lead time in Phase 1.

“No prices on the printed order” does not mean prices are discarded. The purchase order is the
request sent to the supplier; the goods receipt is the actual delivery and financial source. Every
received line keeps its own quantity, purchase unit, actual unit price, line total, currency and
receipt date. Those receipt prices drive last-price displays, purchase history and financial
summaries.

One additional Phase 1 assumption is made explicit: supplier-to-item relationships are
organisation-wide, while stock needs and purchase orders are branch-specific. If supplier
availability differs by branch, the link table must gain `branch_id` before implementation.

## 1. Phase 1 outcome

The stock-responsible person can:

1. Create, edit, archive and restore suppliers.
2. Record supplier-wide contact details plus multiple named contacts, including email, telephone
   and WhatsApp numbers.
3. Link an ingredient or bought-in product to one or more suppliers and choose one preferred
   supplier per stock item.
4. See the most recent recorded purchase price for each supplier/item pair when they have the
   existing cost-view permission.
5. Open a branch-specific **Supply orders** screen containing out-of-stock and low-stock items,
   add any other stock item, choose quantities and suppliers, and create one draft purchase order
   per supplier.
6. Review, edit, issue, cancel, print and reprint purchase orders.
7. Print or save a PDF in which every supplier starts on a separate page and the supplier's
   contacts and requested items are shown without prices.
8. Receive one purchase order in one or more deliveries, recording the actual quantity and price of
   every received line without changing the issued order.
9. See the latest price and complete price history for an ingredient or product, including supplier,
   purchase unit, currency and receipt reference.
10. Reconcile purchases by week or month, with incomplete/unpriced receipts visibly flagged rather
    than silently omitted from an apparently complete financial total.

Email, SMS and WhatsApp dispatch are not implemented in Phase 1. Contact channels are captured now
so a later dispatch phase has valid destinations, but no speculative driver, queue or send endpoint
is added yet.

## 2. Corrections to the original draft

- Include **out-of-stock** rows as well as threshold-based low-stock rows. The current low-stock
  predicate intentionally ignores rows with no threshold, so it cannot be the complete ordering
  queue.
- Do not suggest `reorder_threshold - on_hand`. The threshold is the trigger and uses an inclusive
  comparison; replenishing to it leaves the item low. Suggest `par_level - on_hand` only when a
  usable par level exists. Otherwise require a manual quantity.
- Use `draft -> issued -> cancelled`, not `draft -> sent -> cancelled`. Phase 1 does not send an
  order through a channel, so `sent` would claim an event that did not happen.
- Gate proposal and purchase-order reads as well as writes with the new supply-order permission.
  Plain `inventory.view_organisation` should not expose the order book to every kitchen staff role.
- Remove the optional “include last prices” print control. It contradicts the approved no-price
  print decision.
- Do not seed raw goods receipts that bypass `GoodsReceiptService`; doing so makes the purchase
  ledger disagree with stock movements and weighted cost.
- Reuse the existing receipt-price ledger. Healthy360 already stores quantity, unit price, line
  total and currency on each `goods_receipt_line`, and its monthly cost report already sums those
  lines. Extend that source for purchase orders, history and weekly checks instead of creating a
  second supplier-price table.
- Do not assume the existing `purchase_orders` table is empty when migrating it. Add/backfill new
  required columns safely before applying `NOT NULL` constraints.
- Use one supplier-item mutation surface rather than two mirrored replace endpoints.
- Remove provisional decision numbers and the unfinished “agents incoming” section. Durable
  decisions should be registered only after approval.

## 3. Domain and database design

All new procurement data remains in the Procurement module. Procurement may read Inventory models;
Inventory must not import Procurement, preserving the declared module direction.

### 3.1 Suppliers

Extend `suppliers` with:

- `name_ar` nullable
- `address` nullable text
- `payment_terms` nullable short text
- `lead_time_days` nullable unsigned small integer, constrained to a documented range
- `notes` nullable text
- `archived_at` nullable timestamp

Keep the existing `currency_code`, `contact_email` and `contact_phone`. Their Phase 1 meaning is
explicitly **general supplier/office contact**, not a duplicate primary person. They remain editable
and appear as a fallback on printouts.

There is no hard delete. Archiving removes a supplier from new-order pickers and automatic
suggestions but preserves receipts, links and purchase-order history. Issuing an order for an
archived supplier is refused.

### 3.2 Named contacts

Create `supplier_contacts` with:

- supplier and organisation ownership
- name and optional role/title
- optional email, phone and WhatsApp phone
- `is_primary` and `display_order`
- timestamps

Require at least one contact channel and allow at most one primary named contact per supplier.
Contacts are saved as one explicit section-level replace operation in a transaction. The UI has one
**Save contacts** action; it does not silently replace the whole set whenever one card is edited.

### 3.3 Supplier/item relationships

Create `supplier_stock_items` with:

- organisation, supplier and `stock_item_id`
- optional supplier catalogue/reference code
- `is_preferred`
- timestamps

Enforce one row per supplier/item pair and at most one preferred supplier per stock item. A stock
item is the correct link target because Healthy360 already derives one for every ingredient and
every bought-in/resold product.

Deleting a link is allowed because it is current configuration, not purchase history. Supplier and
stock-item ownership must be validated against the active organisation, with cross-organisation IDs
returning the established not-found response.

### 3.4 Last purchase price

Do not store a second “last price” value. Derive it from the newest priced
`goods_receipt_lines -> goods_receipts` row for the requested stock item, ordered deterministically
by the branch-local received date, `received_at`, creation time and ID. A priced line remains valid
history even when another line on the same receipt is still unpriced or its inventory valuation is
waiting for an exchange-rate decision.

Expose both views needed in practice:

- **item last price:** newest purchase across all suppliers, shown on the ingredient/product stock
  view with the supplier named;
- **supplier-item last price:** newest purchase from that supplier, shown on the supplier page.

The response must include amount, currency, quoted unit and receipt date. A value such as `6.90`
without “USD per kg” is incomplete. Add indexes that match the final query and verify the query does
not become N+1 on a supplier containing many items.

Without `inventory.view_costs_organisation`, the API returns an explicit redaction state and no
amount. The UI renders **Hidden**, distinct from **No purchases recorded**.

The purchases ledger remains the complete history behind the summary. Add filters for branch,
supplier, stock item, purchase order, receipt reference, date range and price-completeness state.
Supplier and item pages link into that ledger with the appropriate filters already applied.

### 3.5 Purchase orders

Complete the existing `purchase_orders` table with:

- branch and supplier
- organisation-unique human-readable order number
- status: `draft`, `issued`, `partially_received`, `received`, `cancelled`
- notes
- `issued_at`, `received_at`, `closed_at` and `cancelled_at` as applicable
- creator identity when consistent with existing audit/user-reference conventions
- a recipient snapshot captured on issue for stable reprints

Create `purchase_order_lines` with:

- purchase order and stock item
- positive decimal quantity using the stock precision
- server-snapshotted item code, bilingual name and unit code
- optional supplier item reference and line notes
- display order

There are no actual-price or amount columns on purchase orders or their lines in Phase 1. Actual
prices belong to receipts, where each partial delivery can carry the price it was really invoiced
at. Add a structural test to keep that boundary explicit. Cost-authorised screens may display the
last historical receipt price beside an order line as a reference, but it is neither copied into the
order nor printed.

Issued orders are immutable. The issue operation freezes the lines and snapshots the supplier name,
address, general contact details and named contacts used by the document. Draft previews may use
current supplier data; issued reprints use the snapshot. Cancellation does not delete anything.

An issued order can receive multiple goods receipts. Received quantities are summed per purchase-
order line. The status becomes `partially_received` after the first incomplete delivery and
`received` when every ordered line is fulfilled. A user may close a short delivery with an explicit
reason; over-receipt requires an explicit confirmation and variance note. An order with receipts
cannot be cancelled as though nothing happened.

The migration must handle any pre-existing purchase-order rows: introduce nullable columns,
backfill or stop with a clear deploy-time invariant, and only then add required constraints. Do not
base schema safety on the current development database having zero rows.

Every new tenant-owned table must document its ADR-0007 isolation choice. Nested contact and line
tables may use the established join-parent strategy; independently queried supplier links and
purchase orders retain explicit organisation scoping. Add database RLS only if that decision is made
deliberately and update the protected-table pin in the same slice.

### 3.6 Goods receipts and actual purchase prices

Keep `goods_receipts` and `goods_receipt_lines` as the source of truth for what arrived and what it
cost. Do not copy actual receipt prices onto the purchase order or supplier link.

The existing receipt record already stores:

- supplier, branch, optional purchase order and receipt/document reference;
- exact `received_at` timestamp;
- stock item, received quantity and purchase unit per line;
- actual unit price, line total and currency per line.

Extend it for the real receiving workflow with:

- a stable branch-local `received_on` business date for weekly/monthly grouping;
- optional supplier invoice reference and invoice date, separate from the delivery-note reference;
- optional `purchase_order_line_id` on each receipt line for unambiguous partial-delivery matching;
- receipt `cost_status`: `unpriced`, `partial` or `complete`;
- `costed_at` per priced line so late price completion cannot cost the same quantity twice;
- optional receipt-level discount, tax, delivery and other-charge amounts plus invoice total, all in
  one receipt currency.

When invoice totals are present, enforce:

`invoice total = line subtotal - discount + tax + delivery + other charges`.

All priced lines and header adjustments on one receipt must use one currency. Healthy360 has no
exchange-rate source and must never add different currencies. Header charges are reported
separately from item spend and do not change an item's “last unit price” unless a future landed-cost
allocation feature explicitly distributes them.

Posting a receipt remains one transaction: persist receipt/lines, raise stock once, record receipt
movements and blend every priced ingredient line through the existing `IngredientCostService`.
Direct/emergency receipts without a purchase order remain valid and appear in the same history and
reports.

The raw supplier price is always retained in the receipt currency. If that currency cannot be
blended into the ingredient's existing valuation currency, physical receiving must not be lost: post
the stock and receipt, mark the line `valuation_pending_fx`, and flag COGS/valuation as incomplete.
Do not invent an exchange rate or add unlike currencies. A later exchange-rate/accounting phase may
resolve the valuation while the original supplier price remains unchanged.

A delivery may be posted without prices when the invoice has not arrived. A cost-authorised user
then gets an **Unpriced receipts** work queue and may complete missing line prices once. Completing
costs calls the costing path only for lines whose `costed_at` is null and never creates a second stock
movement. Reports flag the affected week/month until every receipt is complete. Posted quantities
are never edited in place; financial corrections require a reasoned, audited adjustment rather than
silently rewriting history.

### 3.7 Weekly, monthly and financial checks

Add a procurement-spend summary over the same goods-receipt ledger. It supports `group_by=week` or
`group_by=month`, a date range, branch, supplier and stock-item filters. Weekly grouping uses ISO
weeks over `received_on`; monthly grouping uses its calendar month.

Return each period and currency separately with:

- receipt and received-line counts;
- item subtotal (sum of receipt-line totals);
- discounts, tax, delivery and other charges;
- supplier-invoice total;
- unpriced receipt/line counts and a completeness flag;
- optional supplier and stock-item breakdowns without N+1 queries.

Do not present a single total across currencies. An unpriced line contributes to quantity history
but not to money totals, and the period is visibly **Incomplete**.

The existing monthly cost report remains the cross-domain financial view of purchasing spend, COGS,
waste, revenue and margin. Extract/reuse the procurement spend aggregation so the monthly report and
new weekly/monthly purchase summary cannot disagree. Keep item subtotal and full supplier-invoice
spend as separate named values; taxes or delivery fees must not be mislabelled as an ingredient's
purchase price.

## 4. Ordering rules

The proposal is always for one branch. Validate that the branch belongs to the active organisation.

The initial queue is the distinct union of:

- **out of stock:** an existing branch stock level with `quantity <= 0`
- **low stock:** `reorder_threshold` is set and `quantity <= reorder_threshold`

A row meeting both rules appears once and is labelled out of stock. A stock item with no branch
level is not automatically treated as a shortage; it remains available through **Add another item**.

Suggested quantity is:

- `par_level - quantity` when par is present and the result is positive
- otherwise `null`, requiring the user to enter a quantity

Supplier selection is:

1. the active preferred supplier, when one exists;
2. the only active linked supplier, when exactly one exists;
3. otherwise unassigned until the user chooses.

The user may choose an active supplier for a one-off line even when no saved link exists. The UI
offers **Remember this supplier for this item**, but purchase-order creation never changes supplier
links implicitly.

Unassigned or zero-quantity rows are not included in an order. They do not block assigned rows from
being ordered, but the confirmation clearly states how many rows will be left behind.

Receiving rules:

- the purchase order, supplier and branch must belong to the active organisation;
- a receipt against an order must use that order's supplier and branch;
- ordered lines are prefilled with their outstanding quantity, not their original quantity;
- partial receipts are normal and never duplicate a prior receipt's stock movement;
- a direct receipt or an extra unplanned item is allowed with an explicit note;
- actual received quantity and actual unit price belong to the receipt, so two deliveries against
  one order may legitimately have different prices;
- reports and last-price queries use the receipt date/price, never the order issue date.

## 5. Permissions

Add:

`inventory.order_supplies_organisation` — Prepare, issue, print and cancel supplier purchase orders.

Grant it to `kitchen_manager`; organisation owner/administrator inherit it through the existing
all-organisation-permissions logic. Do not add it to `order_desk_agent`, `kitchen_staff` or
`commercial_manager` automatically.

Permission boundaries:

- Supplier list/detail: `inventory.view_organisation`
- Supplier create/edit/archive/contacts/item links: `inventory.manage_organisation`
- Last-price values: additionally `inventory.view_costs_organisation`
- Supply-needs count, proposal, purchase-order list/detail/create/edit/issue/cancel/print data: the
  new permission
- Receiving quantities against an issued order or posting a direct receipt:
  `inventory.manage_organisation`
- Purchase-price history, unpriced-receipt work queue, price completion and weekly/monthly purchase
  financials: `inventory.view_costs_organisation`

The receiving endpoint may expose an issued order's supplier, outstanding items and quantities to a
receiver holding `inventory.manage_organisation` without granting the full supply-order book. A
receiver may enter prices printed on the supplier document even if historical costs remain redacted
after submission, preserving the existing blind-write/read-redaction model. Completing or correcting
prices later requires the cost permission.

The new permission is sufficient to use the supply-order workflow. A custom stock-responsible role
does not need a hidden conjunction with the general inventory-view permission merely to open this
screen; organisations may still grant both when the person should also use the stock screen.

Update the permission registry, template-role counts, test session fixtures and permission matrix in
the same slice.

## 6. API surface

Follow the existing `/api/v1/catalogue/procurement` namespace and existing ops response/error
conventions.

Supplier endpoints:

- list suppliers, optionally including archived rows
- create, show and update one supplier
- archive and restore one supplier
- replace one supplier's contact set
- idempotently create/update one supplier-item link and delete one link

The supplier detail response includes contacts and supplied items. Each supplied item includes its
preferred flag, supplier reference and last-purchase/redaction state, so a second general-purpose
supplier-links listing endpoint is not needed in Phase 1.

Ordering endpoints:

- branch-specific supply-needs count for the hub
- branch-specific order proposal, with optional requested stock-item IDs for manually added rows
- purchase-order list and detail
- transactional batch creation: one draft order per supplier, returned in request order
- replace draft notes/lines
- issue, close-short and cancel actions with explicit conflict reasons
- one authenticated batch read for print data

Batch creation is all-or-nothing. It validates active branch/supplier ownership, positive quantities
and stock-item ownership, snapshots line display data server-side and never trusts a client-supplied
unit or item label.

Receiving and financial endpoints:

- list issued/partially received orders available for receiving at the active branch
- post a goods receipt directly or against a purchase order, with optional actual prices and invoice
  totals
- read one receipt with its order match, cost status and variance information
- complete missing receipt prices without repeating the stock movement
- purchases ledger / price history with branch, supplier, stock item, order, receipt and date filters
- procurement-spend summary grouped by ISO week or calendar month

Extend `POST /procurement/goods-receipts` rather than adding a second receipt-writing service. When a
purchase order is supplied, validate organisation, branch, supplier and outstanding lines, then post
the receipt and update the order's received state inside one transaction.

Do not add a Phase 1 `send` endpoint. Later channel dispatch is a different state/event and must not
be simulated by a manually stamped `sent_at` value.

For every slice, update the OpenAPI source, bundled specification, generated API client, project
contracts, repository implementation, repository-surface registry, hooks and query keys together.

## 7. Frontend and print UX

Add routes:

- `/kitchen/suppliers`
- `/kitchen/suppliers/new`
- `/kitchen/suppliers/[supplier]`
- `/kitchen/supply-orders`
- `/kitchen/supply-orders/new`
- `/kitchen/supply-orders/[order]`
- `/kitchen/supply-orders/print?orders=...`
- `/kitchen/procurement/receive?order=...`
- `/kitchen/procurement/unpriced-receipts`

### Suppliers

The supplier list supports search and an archived filter and shows supplier name/code, general or
primary contact, supplied-item count and archive status.

The detail page uses three section-level forms:

1. Details: bilingual name, code, currency, general email/phone, address, payment terms, lead time
   and notes.
2. Contacts: ordered named contacts with a single Save action.
3. Supplied items: link/unlink, supplier item reference, preferred supplier action and last purchase
   price/date/unit with the three distinct states Visible / Hidden / Never purchased, plus a link to
   the complete filtered purchase history.

The ingredient/product stock view also shows the latest purchase across all suppliers and links to
its price history. Cost-authorised users may see the same last-price reference in the order builder;
it never appears on the printed order.

Keep the lightweight inline supplier creation in the goods-receipt dialog, then link to the full
supplier page for contacts and item setup. Replace the procurement screen's duplicate supplier
management table with a concise count and **Manage suppliers** link.

### Supply orders

The landing page shows the number of items needing attention and existing purchase orders, with a
primary **Prepare order** action.

The builder is one screen:

- out-of-stock rows first, then low-stock rows
- on-hand, threshold and par context
- decimal quantity input, prefilled only from a valid par calculation
- preferred/selected supplier and alternative suppliers
- an unassigned section with the optional “remember link” action
- **Add another item** over the full ranked stock-item list
- live grouping preview by supplier
- confirmation stating order count, line count and rows left unassigned

The purchase-order detail is editable only in draft. The primary final action is **Issue and print**,
with a separate cancel action. A draft can be previewed with a clear Draft marker. Issued and
partially received orders add **Receive delivery**, show ordered/received/outstanding quantities per
line and list every linked receipt. A short final delivery can be closed only with a reason.

### Receiving and purchase financials

The receiving screen starts from an issued purchase order when one is supplied:

- supplier and branch are fixed from the order;
- every outstanding order line is prefilled and may be reduced for a partial delivery;
- purchase unit, actual unit price, invoice currency and delivery/invoice references are captured;
- unplanned lines require a note;
- the confirmation distinguishes stock quantity from financial values and states that posting raises
  stock immediately.

A direct receipt without an order stays available for market purchases and emergencies.

Cost-authorised users see an **Unpriced receipts** queue. Completing a receipt shows its immutable
received quantities and accepts only the missing financial fields. The purchases ledger gains
week/month summary controls and detail filters. Each period shows item subtotal, invoice total,
charges and an explicit Complete/Incomplete state, separated by currency.

### Print / Save PDF

Use a web-only print helper around `window.print()` and print CSS:

- A4 page size and readable margins
- application navigation/actions hidden under print media
- each supplier/order starts on a new page
- continuation pages are allowed for long orders rather than shrinking many lines onto one sheet
- branch, order number, date and status in the header
- supplier bilingual name, address, general contact and all named contacts, primary first
- item number, code/name, quantity, unit and a blank notes column
- prepared/received/date signature lines
- no prices or totals
- RTL inherited correctly for Arabic

Do not auto-open the browser print dialog on mount. On iOS/Android, render the preview and explain
that printing or saving PDF is available from the web app; do not show a non-functional button.

## 8. Implementation slices

| Slice | Backend | Frontend | Exit condition |
|---|---|---|---|
| 1. Supplier record and contacts | Supplier extension, contact table, presenters, CRUD/archive/contact APIs, OpenAPI | Supplier list/detail/details/contacts, registry/navigation, procurement link | Supplier lifecycle works with validation, tenancy and archived states |
| 2. Supplier items and price history | Link table, indexes, link service, deterministic item and supplier-item last-price/history queries, cost redaction | Supplied-items editor, ingredient/product last-price display, ledger deep links | Multiple suppliers, one preferred supplier and full historical receipt prices are proven |
| 3. Permission and proposal | New permission/grant, supply-needs count, branch proposal and suggestion rules | Supply-orders landing and builder backed by typed stubs/API contracts | Out-of-stock + low-stock + manual items group correctly without exposing costs |
| 4. Purchase orders | Safe PO migration, line/snapshot model, batch create, draft update, issue/cancel/list/detail/print-data APIs | Builder submission and PO detail | One atomic create produces one draft per supplier; issue freezes the requested document |
| 5. Receiving and actual prices | PO-line matching on receipts, partial-receipt state, invoice fields, cost status, price completion service | Receive-delivery flow, outstanding quantities, linked receipts, unpriced queue | Multiple deliveries raise stock once each and preserve every actual received price |
| 6. Weekly/monthly financials | Shared procurement-spend aggregation, completeness counts, purchases-ledger filters, monthly-report integration | Week/month summaries, currency separation and Complete/Incomplete states | Summary totals reconcile exactly to receipt detail without hiding unpriced lines |
| 7. Print and integration | Final contract adjustments only | Print preview, print CSS, native fallback, i18n/RTL/accessibility | Browser print/save-PDF shows separate supplier documents with no prices |
| 8. Demo and acceptance | Add contacts, links and null-only threshold/par setup to `OpsDemoSeeder` | Hub badges and final end-to-end coverage | Reseeding does not change quantities/costs; the complete workflow passes |

Do not seed fabricated raw receipts or prebuilt purchase orders. Tests create priced receipts through
the real receipt path. Demo seeding may add supplier/contact/link configuration and fill thresholds
only where they are null, without overwriting user-edited quantities or purchasing history.

## 9. Verification

Backend coverage:

- supplier CRUD, archive/restore, contact constraints and link preferred handover
- deterministic latest price per supplier/item, unit/currency included, unpriced lines ignored,
  cost redaction and no N+1 behavior
- item-level latest price across suppliers and complete chronological price history
- branch and organisation isolation for every ID-bearing route
- proposal union of out-of-stock and low-stock rows, no duplicates, manual-item inclusion and
  par-only suggested quantities
- permission matrix separating supplier management, costs and supply ordering
- purchase-order batch atomicity, unique numbering, snapshots, allowed transitions, issued-order
  immutability and archived-supplier refusal
- multiple partial receipts against one order, outstanding-quantity calculation, over/short variance
  handling and prevention of cancellation after receipt
- actual receipt prices remain on each receipt line; two deliveries of the same item at different
  prices remain two historical facts and the later one becomes the displayed last price
- direct receipts and purchase-order receipts use the same transactional posting service
- late price completion costs each line once and never raises stock a second time
- receipt subtotal/invoice-total arithmetic and single-currency constraints
- weekly and monthly summaries reconcile to ledger detail per currency and flag every unpriced line
- the existing monthly cost report consumes the shared spend aggregation without changing COGS or
  revenue semantics
- absence of price/amount fields from purchase-order schemas and responses
- reversible migrations and explicit ADR-0007 isolation documentation
- OpenAPI route/spec/bundle/client conformance

Frontend coverage:

- supplier screen loading, empty, error, archived, forbidden and cost-redacted states
- pure quantity and grouping model tests, including decimal precision and unassigned rows
- builder refresh/discard behavior and failed batch behavior
- purchase-order draft/issued/partially-received/received/cancelled capabilities
- purchase-order partial/received states, receive-delivery form and outstanding-quantity display
- unpriced-receipt completion and financial completeness states
- supplier/item price-history links and week/month purchase summaries
- print media hides chrome, starts each supplier on a new page, renders contacts/units and contains
  no prices
- English, Arabic RTL and pseudo-locale checks; keyboard and serious axe checks on new screens

End-to-end acceptance journey:

1. Create a supplier and named contact.
2. Link an ingredient and a bought-in product; make one relationship preferred.
3. Put one item out of stock and another below its threshold, with a par on only one.
4. Open the builder, verify both rows appear, enter the manual quantity, add another normal-stock
   item and assign suppliers.
5. Create drafts and confirm one order per supplier.
6. Issue and open Print / Save PDF; confirm each supplier starts separately, contacts and units are
   present, and no prices appear.
7. Receive part of one order at one actual unit price; verify stock rises once, the order becomes
   partially received and the receipt appears in price history and the current week/month.
8. Receive the remainder at a different price; verify the order becomes received, both historical
   prices remain and the later price becomes the displayed last price.
9. Post an unpriced receipt, verify the period is marked Incomplete, complete its costs once and
   verify stock does not move again and the summary reconciles.
10. Verify a user without the new permission cannot use ordering, and a user without the cost
    permission cannot read price history or financial summaries.

Run the narrow tests for each slice, then the repository gates: API formatting/static analysis/Pest
and OpenAPI lint/bundle, generated-client drift checks, i18n generation/checks, frontend lint,
typecheck and tests, followed by the targeted Playwright journey.

## 10. Later phases

After Phase 1 is accepted, design dispatch as an additive capability:

- email, SMS and WhatsApp channel adapters
- explicit destination selection from supplier contacts
- queued dispatch with retry/idempotency
- `supplier_order_dispatches` history recording channel, destination, provider reference, status,
  timestamps and failure reason
- transition/event wording that distinguishes **issued** from **actually dispatched**
- provider configuration, consent/compliance review and message templates

Also deferred: pack sizes/minimum-order quantities, supplier quoted-price catalogues, credit notes
and returns, full three-way purchase-order/receipt/invoice matching, accounts-payable/general-ledger
integration, exchange-rate conversion, server-generated PDFs and branch-specific supplier
availability. Phase 1 financials are procurement spend and cost analysis, not a substitute for an
accounting ledger.
