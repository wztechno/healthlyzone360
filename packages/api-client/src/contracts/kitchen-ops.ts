import type {
    BranchId,
    GoodsReceiptId,
    IngredientId,
    IsoDateTime,
    OrderId,
    ProductionOrderId,
    QualityCheckId,
    RecipeVersionId,
    StockItemId,
    SupplierContactId,
    SupplierId,
    UserId,
} from '@healthy360/domain-types';

import type { LocalisedText } from './kitchen-admin.ts';
import type { CursorPage, CursorPageRequest } from './pagination.ts';

/**
 * The kitchen ops contract (O1–O4): inventory, receipts-only procurement, production and quality
 * control.
 *
 * ## Why this is a sibling of `KitchenAdminRepository` rather than a branch of it
 *
 * `KitchenAdminRepository` is the confidential *catalogue* — recipes, products, prices, margins —
 * and every one of its records is lock-versioned and bilingual (plan §4.13, §4.18). Nothing here is
 * lock-versioned: the backend does not version these rows, and a contract that invented a
 * `lockVersion` would promise a conflict response the server never sends.
 *
 * Nor is anything here bilingual, **with one exception SUP1 added**. A stock item, a goods receipt,
 * a production order and a quality check carry `nameEn` only, because there is no publication
 * surface for a warehouse SKU. A {@link Supplier} carries a {@link LocalisedText} name, because a
 * supplier's name is printed on an order sheet handed to the supplier — a document read by somebody
 * outside this system, in their own language. That makes it the one ops record with an audience.
 *
 * ## Four scopes, deliberately locked to v1
 *
 * 1. **Inventory (O1, reworked by INV2.0).** Stock items are **derived**, not declared: one per
 *    ingredient in the library and one per product the kitchen buys in to resell, so there is no
 *    writer here at all. `listStockItems` returns them ranked — stocked first, then ever-moved, then
 *    by name — and a caller that preserves that order gets a usable picker over a long list. Levels
 *    are per-branch and read through the active branch context (`X-Branch-Id`, set by
 *    `ContextRepository`); nothing here takes a branch filter because the header already narrows it.
 * 2. **Procurement (O2) is receipts-only.** There is no purchase-order surface: `listSuppliers` and
 *    the goods-receipt pair are the whole scope, and `GoodsReceipt.purchaseOrderId` is always `null`
 *    until one exists to point at.
 * 3. **Production (O5) has no task UI.** `ProductionOrder` carries a status and the recipe version it
 *    plans against; completing one states what it consumed and yielded, not a checklist.
 * 4. **Quality control (O4) is hold/release only.** `holdQualityCheck` / `releaseQualityCheck` are the
 *    entire lifecycle beyond opening a check; there is no separate "pass" action and no hold record
 *    distinct from the check's own `status`.
 *
 * Every list here answers the backend's own cap: stock items and suppliers are the whole table (a
 * kitchen's warehouse and supplier book are small); goods receipts, production orders and quality
 * checks are the most recent fifty. A metric built from one of these lists is therefore an honest
 * live count of what was fetched, never a fabricated KPI.
 */

/* ------------------------------------------------------------------------------------------------
 * Inventory (O1)
 * ---------------------------------------------------------------------------------------------- */

/** Which of the two things a shelf is derived from (INV2.0). */
export type StockItemBacking = 'ingredient' | 'product';

/**
 * A shelf a kitchen holds — derived, never declared (INV2.0).
 *
 * `ingredientId` is what the shelf costs itself by and is set on every derived row, resold products
 * included: the moving average and COGS are keyed by ingredient. `catalogueItemId` is the product it
 * actually *is* when a kitchen buys it in to resell, and `backing` is the field to branch on rather
 * than testing which id is null.
 */
export interface StockItem {
    readonly id: StockItemId;
    readonly code: string;
    readonly nameEn: string;
    readonly unitCode: string;
    readonly ingredientId: IngredientId | null;
    readonly catalogueItemId: string | null;
    readonly backing: StockItemBacking;
    /** Some branch holds a non-zero quantity. Ranks this shelf to the top of a picker. */
    readonly isStocked: boolean;
    /** It has moved at least once — received, adjusted, wasted or consumed. */
    readonly hasHistory: boolean;
}

/** One stock item's on-hand quantity at one branch, denormalised so a levels row needs no join. */
export interface StockLevel {
    readonly id: string;
    readonly branchId: BranchId;
    readonly stockItemId: StockItemId;
    /** A decimal string, never a float — the wire's own precision guarantee. */
    readonly quantity: string;
    /** The reorder point as a decimal string, or `null` when no threshold is set (never low). */
    readonly reorderThreshold: string | null;
    /** The level to restock back up to, as a decimal string, or `null` when not set. */
    readonly parLevel: string | null;
    /**
     * Computed on read (INV1.3), never a stored flag: `true` when a threshold is set and the
     * quantity has reached or fallen to or below it. The same live pattern as {@link isOutOfStock}.
     */
    readonly isLow: boolean;
    readonly itemCode: string;
    readonly itemNameEn: string;
    readonly ingredientId: IngredientId | null;
}

/**
 * Sets — or clears — a level's reorder threshold (and optional par level) for one (branch, stock
 * item) pair. A `null` `reorderThreshold` clears it, which makes the item never low; `parLevel` is
 * optional and independently nullable. The server creates the level row if the item has never moved
 * at this branch, so a threshold can be set before the first receipt.
 */
export interface SetStockThresholdRequest {
    readonly branchId: BranchId;
    readonly stockItemId: StockItemId;
    /** The reorder point; `null` clears the threshold. */
    readonly reorderThreshold: number | null;
    /** Optional target level to restock back up to; `null` clears it. */
    readonly parLevel?: number | null | undefined;
}

export const STOCK_MOVEMENT_REASONS = ['adjust', 'waste', 'receipt', 'consume', 'yield'] as const;
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

export interface StockMovement {
    readonly id: string;
    /** Signed — negative for waste and consumption, positive for receipts, yields and increases. */
    readonly quantityDelta: string;
    readonly reason: StockMovementReason;
}

export interface StockAdjustmentRequest {
    readonly branchId: BranchId;
    readonly stockItemId: StockItemId;
    /** Signed: a correction that raises the level is positive, one that lowers it is negative. */
    readonly quantityDelta: number;
    readonly notes?: string | null | undefined;
}

export interface StockWasteRequest {
    readonly branchId: BranchId;
    readonly stockItemId: StockItemId;
    /** Always positive; the server signs it negative on the ledger. */
    readonly quantity: number;
    readonly notes?: string | null | undefined;
}

/* ------------------------------------------------------------------------------------------------
 * Procurement (O2) — receipts-only
 * ---------------------------------------------------------------------------------------------- */

/**
 * A supplier in the organisation's book (SUP1).
 *
 * **The one bilingual record in this contract**, and the exception the file header above names. The
 * rest of the ops surface is `nameEn` only because a warehouse SKU has no publication surface; a
 * supplier's name is *printed on an order sheet handed to the supplier*, and a Lebanese wholesaler
 * reading "Gulf Fresh Trading" off a document addressed to them in English is the case `name_ar`
 * exists for. It still carries no `lockVersion` — the backend versions no ops row — so the shape is
 * bilingual without being a publishable catalogue record.
 *
 * `contactEmail`/`contactPhone` are the **general office** details, deliberately not a duplicate of
 * the primary named person: when a sales rep leaves, the office line is still correct and their
 * mobile is not.
 */
export interface Supplier {
    readonly id: SupplierId;
    readonly code: string;
    /** Composed client-side from the flat `name_en`/`name_ar` wire fields. `ar` is `''` when unset. */
    readonly name: LocalisedText;
    /** ISO 4217, the currency this supplier usually invoices in, or `null` (INV1.1). */
    readonly currencyCode: string | null;
    /** The general office address, not the primary contact's. */
    readonly contactEmail: string | null;
    /** The general office line, not the primary contact's. */
    readonly contactPhone: string | null;
    /**
     * Free text, transcribed as the supplier gives it and printed on order sheets — a building
     * name, a market stall number, "gate 4, behind the cold store". Never geocoded.
     */
    readonly address: string | null;
    /** Free text — "net 30", "cash on delivery". Never computed against. */
    readonly paymentTerms: string | null;
    /** Days between issuing an order and expecting it, 0–365. `0` is a same-morning market run. */
    readonly leadTimeDays: number | null;
    readonly notes: string | null;
    /**
     * When the supplier was archived, or `null` for a live one.
     *
     * An archived supplier keeps every receipt posted against it and leaves every picker. Screens
     * render the record read-only rather than hiding it — a receipt posted last month names it.
     */
    readonly archivedAt: IsoDateTime | null;
    readonly contactCount: number;
    /**
     * How many stock items this supplier is linked to (SUP2) — the book's "Items supplied" column.
     *
     * Counted on the list query rather than derived from {@link SupplierDetail.suppliedItems},
     * which a list row does not carry: loading every link of every supplier to length an array is
     * the N+1 the count exists to avoid.
     */
    readonly suppliedItemCount: number;
    /** Who to call, for a list row. `null` only when the supplier has no named contacts at all. */
    readonly primaryContact: SupplierPrimaryContact | null;
}

/** The "who do I call" summary a supplier list row shows (SUP1). */
export interface SupplierPrimaryContact {
    readonly name: string;
    /** The telephone number, falling back to WhatsApp — a contact reachable only there still is. */
    readonly phone: string | null;
}

/**
 * One named person at a supplier (SUP1) — distinct from the supplier's own office line.
 *
 * At least one of `email`, `phone` and `whatsappPhone` is always present: a contact nobody can
 * reach is not a contact, and the server refuses a set that contains one.
 */
export interface SupplierContact {
    readonly id: SupplierContactId;
    readonly name: string;
    readonly roleTitle: string | null;
    readonly email: string | null;
    readonly phone: string | null;
    /** Kept apart from `phone`: the landline takes the call, the mobile takes the order photo. */
    readonly whatsappPhone: string | null;
    /** At most one per supplier. */
    readonly isPrimary: boolean;
    readonly displayOrder: number;
}

/**
 * A supplier with its full contact set and everything it supplies — what the supplier's own page
 * reads (SUP1, extended by SUP2).
 */
export interface SupplierDetail extends Supplier {
    readonly contacts: readonly SupplierContact[];
    /** What this supplier sells the kitchen, preferred link first then by item name (SUP2). */
    readonly suppliedItems: readonly SuppliedItem[];
    /**
     * `true` when the reader lacks `inventory.view_costs_organisation` and every
     * `suppliedItems[].lastPurchase` money field was served as `null` (SUP2).
     */
    readonly costsRedacted: boolean;
}

/** The shelf a supplier link points at, summarised for the row that renders it (SUP2). */
export interface SuppliedStockItem {
    readonly id: StockItemId;
    readonly code: string;
    readonly nameEn: string;
    readonly unitCode: string;
    /** Which of the two books this shelf belongs to — the same field {@link StockItem} publishes. */
    readonly backing: StockItemBacking;
}

/**
 * One "we buy this from them" row on the supplier's page (SUP2).
 *
 * `lastPurchase` being `null` is **not** the same as a `lastPurchase` whose money is redacted, and
 * a screen must render the two differently: null is *never bought here yet*, redacted is *Hidden*.
 * Collapsing them would tell a person without the cost permission that a supplier they buy from
 * weekly has never sold them anything.
 */
export interface SuppliedItem {
    /** `null` only if the shelf vanished between the read and the render. */
    readonly stockItem: SuppliedStockItem | null;
    /** At most one supplier per stock item holds this, enforced by a partial unique index. */
    readonly isPreferred: boolean;
    /**
     * The supplier's own catalogue reference, transcribed from their price list so an order sheet
     * can quote it back. `ref` rather than `code`: it is their identifier, not this kitchen's.
     */
    readonly supplierItemRef: string | null;
    readonly lastPurchase: LastPurchase | null;
}

/**
 * What something was last bought for (§3.4) — derived live from the newest priced goods-receipt
 * line, never stored.
 *
 * Unpriced deliveries are skipped entirely on the server, so this is always a real purchase: an
 * item received only on unpriced receipts has no `LastPurchase` at all rather than one with a null
 * amount.
 *
 * **The money is the only redacted part.** Without `inventory.view_costs_organisation`,
 * `unitPriceAmount` and `costCurrencyCode` are `null` while the date, quantity and unit remain —
 * those are warehouse facts a receiving clerk entered, not the valuation the cost permission gates.
 * The amount is quoted **per `unitCode`** and always beside its own currency: a bare `6.90` without
 * "USD per kg" is not a price, and nothing here is ever converted.
 */
export interface LastPurchase {
    readonly goodsReceiptId: GoodsReceiptId;
    /** The supplier delivery note or invoice number the price came from, as written. */
    readonly documentRef: string | null;
    readonly receivedAt: IsoDateTime | null;
    /** A decimal string. Never redacted. */
    readonly quantity: string;
    /** The unit the price is quoted per; `null` means the stock item's own unit. */
    readonly unitId: string | null;
    /** That unit's code, resolved for display — `kg`, `l`, `piece`. */
    readonly unitCode: string | null;
    /** Major-unit decimal string per {@link unitCode}, or `null` when costs are redacted. */
    readonly unitPriceAmount: string | null;
    readonly costCurrencyCode: string | null;
}

/**
 * One stock item's newest purchase **across every supplier** (SUP2), with the supplier that sold it.
 *
 * Served by a Procurement endpoint rather than beside the stock item itself, and the reason is a
 * module boundary: the stock list comes from Inventory, and Inventory may not import Procurement.
 * The client holds both lists and joins them on `stockItemId`, which is why this row carries one.
 *
 * `supplier` is nullable — a direct market-run receipt records none, and the price it captured is
 * still the last price of that item.
 */
export interface ItemLatestPurchase extends LastPurchase {
    readonly stockItemId: StockItemId;
    readonly supplier: SupplierRef | null;
}

/**
 * Records "we buy this from them", or updates the link that is already there (SUP2). Idempotent on
 * the `(supplierId, stockItemId)` pair.
 *
 * **One mutation surface, not two mirrored set-replaces.** A supplier's supplied items and a stock
 * item's suppliers are one table read from two ends; a replace at either end would silently undo
 * what the other had just written.
 *
 * `isPreferred` and `supplierItemRef` are keyed on presence: omitting one leaves the stored value
 * alone, `supplierItemRef: null` clears a reference typed by mistake. `isPreferred: true` **moves**
 * the flag off whichever supplier held it for this item; `false` clears this link's own flag and
 * promotes nobody.
 */
export interface UpsertSupplierLinkRequest {
    readonly supplierId: SupplierId;
    readonly stockItemId: StockItemId;
    readonly isPreferred?: boolean | undefined;
    readonly supplierItemRef?: string | null | undefined;
}

/** The pair that identifies one link, for the unlink (SUP2). */
export interface DeleteSupplierLinkRequest {
    readonly supplierId: SupplierId;
    readonly stockItemId: StockItemId;
}

/**
 * The link after a write, and nothing more (SUP2).
 *
 * Every ops write in this workspace answers the minimum and lets the screen re-read what it
 * changed. A supplied item's last purchase price comes from the receipt ledger and cannot change
 * because somebody saved a link, so returning it here would invent a read nobody asked for.
 */
export interface SupplierLink {
    readonly supplierId: SupplierId;
    readonly stockItemId: StockItemId;
    readonly isPreferred: boolean;
    readonly supplierItemRef: string | null;
}

/** A supplier named on a receipt or ledger line (INV1.1). */
export interface SupplierRef {
    readonly id: SupplierId;
    readonly code: string;
    readonly nameEn: string;
}

/** Narrows `listSuppliers` (SUP1). Archived suppliers are excluded unless asked for. */
export interface SupplierFilter {
    /**
     * Include archived suppliers. Omitted or `false` serves the live book only — every caller is a
     * picker, and a picker offering a supplier the kitchen stopped buying from is how an order gets
     * sent to a shuttered warehouse.
     */
    readonly includeArchived?: boolean | undefined;
}

/**
 * Adds a supplier to the organisation's book (INV1.1, extended by SUP1). `code` is optional — omit
 * it and the server mints a unique per-organisation code from the name, so a kitchen with an empty
 * supplier book can add one by name and immediately post a receipt against it. `currencyCode` is a
 * hint the receipt form pre-selects; it is never required and books nothing on its own.
 *
 * Contacts are not accepted here — they are their own set-replace, and a create that took them
 * would give a kitchen two ways to write the same set.
 */
export interface CreateSupplierRequest {
    readonly nameEn: string;
    readonly nameAr?: string | null | undefined;
    readonly code?: string | null | undefined;
    readonly currencyCode?: string | null | undefined;
    readonly contactEmail?: string | null | undefined;
    readonly contactPhone?: string | null | undefined;
    readonly address?: string | null | undefined;
    readonly paymentTerms?: string | null | undefined;
    readonly leadTimeDays?: number | null | undefined;
    readonly notes?: string | null | undefined;
}

/**
 * Edits a supplier (SUP1). Every field optional: omitted is left alone, `null` clears.
 *
 * `code` **is** editable, unlike a catalogue record's. A supplier code is frequently minted by the
 * server from a name typed into a goods-receipt dialog at the loading bay, and refusing to correct
 * it would leave the kitchen stuck with an accident. `archivedAt` is absent — archiving is its own
 * action, so a form save cannot retire a supplier by writing a field.
 */
export interface UpdateSupplierRequest {
    readonly nameEn?: string | undefined;
    readonly nameAr?: string | null | undefined;
    readonly code?: string | undefined;
    readonly currencyCode?: string | null | undefined;
    readonly contactEmail?: string | null | undefined;
    readonly contactPhone?: string | null | undefined;
    readonly address?: string | null | undefined;
    readonly paymentTerms?: string | null | undefined;
    readonly leadTimeDays?: number | null | undefined;
    readonly notes?: string | null | undefined;
}

/** One contact in a replace request. `id` names an existing contact to update; omit it to create. */
export interface SupplierContactInput {
    readonly id?: SupplierContactId | null | undefined;
    readonly name: string;
    readonly roleTitle?: string | null | undefined;
    readonly email?: string | null | undefined;
    readonly phone?: string | null | undefined;
    readonly whatsappPhone?: string | null | undefined;
    readonly isPrimary?: boolean | undefined;
    readonly displayOrder?: number | undefined;
}

/**
 * The whole desired contact set (SUP1). Contacts carrying an `id` are updated, contacts without one
 * are created, and contacts absent from the array are deleted — one request, one transaction, one
 * **Save contacts** button on the screen. Send `[]` to clear the set.
 *
 * Two rules are refused with a 422 before the database constraint behind them can fire: at most one
 * `isPrimary` across the set, and at least one reachable channel on every contact.
 */
export interface ReplaceSupplierContactsRequest {
    readonly contacts: readonly SupplierContactInput[];
}

/** One active currency a receipt price can be booked in (INV1.1). */
export interface CurrencyOption {
    readonly code: string;
    readonly nameEn: string;
}

/**
 * One active measurement unit a purchase line can be quoted in (INV1.1). `dimension` (e.g. `mass`,
 * `volume`, `count`) is what makes conversion safe: the receipt line editor offers only the units
 * in the stock item's own dimension, because the server's conversion refuses across dimensions.
 */
export interface MeasurementUnitOption {
    readonly id: string;
    readonly code: string;
    readonly dimension: string;
    readonly nameEn: string;
}

/**
 * The reference sets the goods-receipt form needs, answered in one read (INV1.1): the currencies a
 * price can be booked in, the organisation's own default currency (the kitchen's currency and the
 * honest default for a receipt), and the measurement units a line can be quoted in. `defaultCurrencyCode`
 * is `null` only when the organisation has none on file.
 */
export interface ProcurementReference {
    readonly currencies: readonly CurrencyOption[];
    readonly defaultCurrencyCode: string | null;
    readonly measurementUnits: readonly MeasurementUnitOption[];
}

export interface GoodsReceiptLine {
    readonly stockItemId: StockItemId;
    readonly quantity: string;
    /** The unit the price is quoted per (INV1.1); `null` on an unpriced line. */
    readonly unitId: string | null;
    /**
     * Major-unit decimal string, or `null` — either the line was unpriced, or the reader lacks
     * `inventory.view_costs_organisation` and {@link GoodsReceipt.costsRedacted} is `true`.
     */
    readonly unitPriceAmount: string | null;
    readonly lineTotalAmount: string | null;
    readonly costCurrencyCode: string | null;
}

export interface GoodsReceipt {
    readonly id: GoodsReceiptId;
    readonly branchId: BranchId;
    /** Who the stock was bought from (INV1.1), or `null`. */
    readonly supplier: SupplierRef | null;
    /** The supplier delivery note or invoice number, as written (INV1.1). */
    readonly documentRef: string | null;
    /** Always `null` in v1 — there is no purchase-order surface yet to have created one. */
    readonly purchaseOrderId: string | null;
    readonly receivedAt: IsoDateTime | null;
    /** The one currency the priced lines share, or `null` (mixed, unpriced, or redacted). */
    readonly currencyCode: string | null;
    /** The sum of the priced lines, or `null` when mixed-currency, unpriced or redacted. */
    readonly receiptTotalAmount: string | null;
    /** `true` when the reader lacks the cost permission and every money field was nulled (INV1.1). */
    readonly costsRedacted: boolean;
    readonly lines: readonly GoodsReceiptLine[];
}

export interface GoodsReceiptLineInput {
    readonly stockItemId: StockItemId;
    readonly quantity: number;
    /** Required whenever a price is given: the unit the price is quoted per (INV1.1). */
    readonly unitId?: string | null | undefined;
    /** Major-unit price per {@link unitId}. A priced line needs a `unitId` and a `costCurrencyCode`. */
    readonly unitPriceAmount?: number | null | undefined;
    readonly costCurrencyCode?: string | null | undefined;
}

export interface PostGoodsReceiptRequest {
    readonly branchId: BranchId;
    /** Who the stock was bought from (INV1.1). */
    readonly supplierId?: SupplierId | null | undefined;
    /** The supplier delivery note or invoice number (INV1.1). */
    readonly documentRef?: string | null | undefined;
    readonly purchaseOrderId?: string | null | undefined;
    readonly lines: readonly GoodsReceiptLineInput[];
}

/** The store's own reply to a post — an id only; the caller re-reads the list for the full row. */
export interface GoodsReceiptResult {
    readonly id: GoodsReceiptId;
}

/**
 * One purchases-ledger row (INV1.1) — a goods-receipt line flattened with the date, supplier and
 * item it belongs to. The browsable record behind the monthly spend figure; behind
 * `inventory.view_costs_organisation`, so the money is always present here (unlike the receipts
 * list, which redacts it for readers without that code).
 */
export interface PurchaseLedgerLine {
    readonly id: string;
    readonly goodsReceiptId: GoodsReceiptId;
    readonly receivedAt: IsoDateTime | null;
    readonly supplier: SupplierRef | null;
    readonly documentRef: string | null;
    readonly stockItemId: StockItemId;
    readonly itemCode: string | null;
    readonly itemNameEn: string | null;
    readonly ingredientId: IngredientId | null;
    readonly quantity: string;
    readonly unitId: string | null;
    readonly unitPriceAmount: string | null;
    readonly lineTotalAmount: string | null;
    readonly costCurrencyCode: string | null;
    readonly costsRedacted: boolean;
}

/** Date range / supplier / branch / item filters over the purchases ledger, plus the cursor. */
export interface PurchaseLedgerFilter extends CursorPageRequest {
    /** Inclusive lower bound on the receipt date, as `YYYY-MM-DD`. */
    readonly from?: string | undefined;
    /** Inclusive upper bound on the receipt date, as `YYYY-MM-DD`. */
    readonly to?: string | undefined;
    readonly supplierId?: SupplierId | undefined;
    readonly ingredientId?: IngredientId | undefined;
    /**
     * Only lines that received this shelf (SUP2) — what the stock screen's per-row **History**
     * link lands on. Beside `ingredientId` rather than replacing it: one ingredient can back both
     * a shelf and a resold product, so "this ingredient" and "this shelf" are different questions.
     */
    readonly stockItemId?: StockItemId | undefined;
    /** Only lines whose receipt was posted at this branch (SUP2). */
    readonly branchId?: BranchId | undefined;
}

/* ------------------------------------------------------------------------------------------------
 * Monthly cost report (INV1.4)
 * ---------------------------------------------------------------------------------------------- */

/**
 * One month of one kitchen's economics, in one currency (INV1.4).
 *
 * A row is a `(month, currency)` pair — figures are never summed across currencies, because there is
 * no exchange rate in this system. Every money field is a **major-unit** decimal string beside
 * {@link currencyCode}: revenue is stored in minor units server-side and converted to major before
 * it reaches here, so it sits at the same scale as spend and COGS and the client never mixes the two.
 *
 * `grossMarginAmount` is `revenueAmount − cogsAmount`; `grossMarginPercent` is that as a percentage
 * of revenue, or `null` when there was no revenue to divide by. The `meal`/`product`/`other` revenue
 * split reconciles to the order-line subtotal — `other` collects subscription-plan and any non-meal,
 * non-product lines — and is drawn from the order lines, the one place the meal-versus-product
 * distinction is recorded (a consume movement records the order, not the line's kind, so COGS is not
 * split this way).
 *
 * `hasDataQualityFlag` is `true` when unresolved consumption exceptions (INV1.2) mean the month's
 * COGS is **understated**: the figure is shown, but as incomplete rather than authoritative.
 */
export interface MonthlyCostReportRow {
    /** The report month, `YYYY-MM`. */
    readonly month: string;
    readonly currencyCode: string;
    /** Purchasing spend — Σ goods-receipt line totals, major-unit decimal string. */
    readonly spendAmount: string;
    /** Cost of goods sold — Σ consume-movement cost, cancelled orders excluded, major units. */
    readonly cogsAmount: string;
    /** Value of wasted stock where a cost was recorded, or `null` when no waste carried a cost. */
    readonly wasteAmount: string | null;
    /** Total wasted quantity this month — the honest note when waste carries no cost. */
    readonly wasteQuantity: string | null;
    /** Selling revenue — Σ order totals for confirmed/fulfilled orders, converted to major units. */
    readonly revenueAmount: string;
    /** Revenue minus COGS, major units. */
    readonly grossMarginAmount: string;
    /** Margin as a percentage of revenue, or `null` when revenue is zero. */
    readonly grossMarginPercent: string | null;
    readonly mealRevenueAmount: string;
    readonly productRevenueAmount: string;
    readonly otherRevenueAmount: string;
    /**
     * The COGS split by line of business (INV1.5), the mirror of the revenue split. Unlike revenue,
     * COGS *is* attributable per line — a consume movement now records which order line and which kind
     * of thing it served — so a product line's COGS is its own moving-average cost and a meal line's
     * is its exploded recipe cost. `other` collects any consume not attributed to a meal or product
     * line (e.g. one predating INV1.5); the three reconcile to {@link cogsAmount}.
     */
    readonly mealCogsAmount: string;
    readonly productCogsAmount: string;
    readonly otherCogsAmount: string;
    /** `true` when unresolved consumption exceptions mean this month's COGS is understated. */
    readonly hasDataQualityFlag: boolean;
    readonly exceptionCount: number;
}

/** Optional inclusive `YYYY-MM` month bounds over the monthly cost report. */
export interface MonthlyCostReportFilter {
    readonly from?: string | undefined;
    readonly to?: string | undefined;
}

/* ------------------------------------------------------------------------------------------------
 * Consumption exceptions (INV1.5)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Why a confirmed order could not deduct a line honestly (INV1.2). A closed vocabulary the backend
 * raises; the client renders it as a human label (i18n) rather than branching on it.
 */
export const CONSUMPTION_EXCEPTION_REASON_CODES = [
    'no_branch',
    'no_catalogue_item',
    'no_recipe_version',
    'no_yield_piece_count',
    'unquantified_recipe_line',
    'no_ingredient_link',
    'no_stock_item',
    'no_stock_unit',
    'unit_conversion_unsupported',
    'no_ingredient_cost',
    'insufficient_stock',
] as const;
export type ConsumptionExceptionReasonCode = (typeof CONSUMPTION_EXCEPTION_REASON_CODES)[number];

/**
 * One thing a confirmed order could not deduct honestly (INV1.2), with its resolution state
 * (INV1.5), joined to the human-readable names of the order, sold item and branch it points at.
 *
 * The references are soft — the record outlives whatever happens to the rows it names — so
 * `orderNumber`, `itemNameEn` and `branchName` may be `null` if the thing they name has since gone.
 * `resolved` is exactly `resolvedAt !== null`, carried as its own field so a screen need not
 * reconstruct it. Nothing confidential passes through: no recipe line, formulation quantity,
 * ingredient cost or supplier term — only which sale on which line could not be deducted and why.
 */
export interface ConsumptionException {
    readonly id: string;
    readonly orderId: OrderId | null;
    readonly orderNumber: string | null;
    /** The order line the exception belongs to, or `null` for an order-level problem (e.g. no branch). */
    readonly orderLineId: string | null;
    readonly catalogueItemId: string | null;
    readonly itemNameEn: string | null;
    readonly branchId: BranchId | null;
    readonly branchName: string | null;
    readonly reasonCode: ConsumptionExceptionReasonCode;
    readonly detail: string | null;
    /** `true` once settled — the same as {@link resolvedAt} being non-null. */
    readonly resolved: boolean;
    readonly resolvedAt: IsoDateTime | null;
    readonly resolvedBy: UserId | null;
    readonly resolutionNote: string | null;
    readonly createdAt: IsoDateTime | null;
}

/** Resolution-state and date filters over the consumption-exception list, plus the cursor. */
export interface ConsumptionExceptionFilter extends CursorPageRequest {
    /** `true` for resolved only, `false` for still-open only; omit for both. */
    readonly resolved?: boolean | undefined;
    /** Inclusive lower bound on when the exception was raised, as `YYYY-MM-DD`. */
    readonly from?: string | undefined;
    /** Inclusive upper bound on when the exception was raised, as `YYYY-MM-DD`. */
    readonly to?: string | undefined;
}

/** Optionally records why an exception is being marked handled. */
export interface ResolveConsumptionExceptionRequest {
    readonly note?: string | null | undefined;
}

/* ------------------------------------------------------------------------------------------------
 * Production (O5) — no task UI
 * ---------------------------------------------------------------------------------------------- */

export const PRODUCTION_ORDER_STATUSES = [
    'planned',
    'in_progress',
    'completed',
    'cancelled',
] as const;
export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number];

export interface ProductionOrder {
    readonly id: ProductionOrderId;
    readonly recipeVersionId: RecipeVersionId;
    readonly status: ProductionOrderStatus;
    readonly branchId: BranchId;
}

export interface CreateProductionOrderRequest {
    readonly branchId: BranchId;
    readonly recipeVersionId: RecipeVersionId;
    readonly plannedYield?: number | null | undefined;
}

export interface ProductionMovementInput {
    readonly stockItemId: StockItemId;
    readonly quantity: number;
}

export interface CompleteProductionOrderRequest {
    readonly consumes?: readonly ProductionMovementInput[] | undefined;
    readonly yields?: readonly ProductionMovementInput[] | undefined;
}

export interface ProductionOrderResult {
    readonly id: ProductionOrderId;
    readonly status: ProductionOrderStatus;
}

/* ------------------------------------------------------------------------------------------------
 * Quality control (O4) — hold/release only
 * ---------------------------------------------------------------------------------------------- */

export const QUALITY_CHECK_SUBJECT_TYPES = ['goods_receipt', 'production_order'] as const;
export type QualityCheckSubjectType = (typeof QUALITY_CHECK_SUBJECT_TYPES)[number];

export const QUALITY_CHECK_STATUSES = ['pending', 'passed', 'hold', 'released'] as const;
export type QualityCheckStatus = (typeof QUALITY_CHECK_STATUSES)[number];

export interface QualityCheck {
    readonly id: QualityCheckId;
    readonly subjectType: QualityCheckSubjectType;
    /** A {@link GoodsReceiptId} or a {@link ProductionOrderId}, depending on `subjectType`. */
    readonly subjectId: string;
    readonly status: QualityCheckStatus;
}

export interface CreateQualityCheckRequest {
    readonly subjectType: QualityCheckSubjectType;
    readonly subjectId: string;
    readonly notes?: string | null | undefined;
}

export interface QualityCheckResult {
    readonly id: QualityCheckId;
    readonly status: QualityCheckStatus;
}

/* ------------------------------------------------------------------------------------------------
 * The repository
 * ---------------------------------------------------------------------------------------------- */

export interface KitchenOpsRepository {
    /**
     * Every shelf the organisation holds, ranked stocked-first (INV2.0). Not paginated — see the
     * file header. There is no writer: a shelf follows an ingredient or a resold product.
     */
    listStockItems(): Promise<readonly StockItem[]>;

    /** Every level the active branch context can see (`X-Branch-Id`, not a parameter here). */
    listStockLevels(): Promise<readonly StockLevel[]>;
    recordStockAdjustment(request: StockAdjustmentRequest): Promise<StockMovement>;
    recordStockWaste(request: StockWasteRequest): Promise<StockMovement>;
    /** Sets or clears a level's reorder threshold; returns the updated level with its computed `isLow`. */
    setStockThreshold(request: SetStockThresholdRequest): Promise<StockLevel>;
    /**
     * How many levels are low right now, scoped to the active branch context (`X-Branch-Id`) or the
     * whole organisation when none is set — the count the hub badge reads without opening the list.
     */
    countLowStockLevels(): Promise<number>;

    /**
     * The supplier book, ordered by code. Not paginated — a kitchen's suppliers are a bounded set a
     * person maintains by hand. Archived rows are excluded unless `includeArchived` asks for them.
     */
    listSuppliers(filter?: SupplierFilter): Promise<readonly Supplier[]>;
    /** One supplier with its named contacts — the supplier's own page. Needs `inventory.view_organisation`. */
    getSupplier(supplierId: SupplierId): Promise<SupplierDetail>;
    /** Adds a supplier to the book, returning the created row. Needs `inventory.manage_organisation`. */
    createSupplier(request: CreateSupplierRequest): Promise<Supplier>;
    /** Edits the record. A partial write: omitted fields are left alone, `null` clears. */
    updateSupplier(supplierId: SupplierId, request: UpdateSupplierRequest): Promise<Supplier>;
    /**
     * Takes the supplier out of every picker without losing its history. Idempotent — archiving an
     * archived supplier keeps the original timestamp.
     */
    archiveSupplier(supplierId: SupplierId): Promise<Supplier>;
    /** Puts an archived supplier back in the book. Idempotent. */
    restoreSupplier(supplierId: SupplierId): Promise<Supplier>;
    /**
     * Replaces the whole contact set in one transaction, returning it in display order. Refuses a
     * second primary or an unreachable contact with a 422 before the constraint behind it fires.
     */
    replaceSupplierContacts(
        supplierId: SupplierId,
        request: ReplaceSupplierContactsRequest,
    ): Promise<readonly SupplierContact[]>;
    /**
     * Records "we buy this from them", or updates the link already there (SUP2). Idempotent on the
     * pair. Needs `inventory.manage_organisation` — there is no separate link permission.
     */
    upsertSupplierLink(request: UpsertSupplierLinkRequest): Promise<SupplierLink>;
    /**
     * Removes one supplier↔item link. Idempotent — unlinking something that is not linked succeeds,
     * because the caller's intention is already true. Needs `inventory.manage_organisation`.
     */
    deleteSupplierLink(request: DeleteSupplierLinkRequest): Promise<void>;
    /**
     * The newest purchase of each named shelf across every supplier (SUP2), for the stock screen's
     * last-price column. At most 200 ids per call.
     *
     * Items with no priced receipt are **absent** from the answer rather than present with nulls,
     * so a caller keys the result by `stockItemId` and treats a miss as *never bought*. Needs
     * `inventory.view_organisation`; without `inventory.view_costs_organisation` the money is null
     * rather than the request refused.
     */
    listItemLatestPurchases(
        stockItemIds: readonly StockItemId[],
    ): Promise<readonly ItemLatestPurchase[]>;
    /**
     * The goods-receipt form's reference data (INV1.1) — the currencies a price can be booked in, the
     * organisation's default currency, and the measurement units a line can be quoted in. Needs
     * `inventory.view_organisation`.
     */
    getProcurementReference(): Promise<ProcurementReference>;
    /** The most recent fifty receipts, newest first. Costs redacted without the cost permission. */
    listGoodsReceipts(): Promise<readonly GoodsReceipt[]>;
    postGoodsReceipt(request: PostGoodsReceiptRequest): Promise<GoodsReceiptResult>;
    /** The purchases ledger — every receipt line, cursor-paginated. Needs `inventory.view_costs_organisation`. */
    listPurchasesLedger(filter?: PurchaseLedgerFilter): Promise<CursorPage<PurchaseLedgerLine>>;
    /**
     * The monthly cost report (INV1.4) — spend, COGS, waste, revenue and margin per month and
     * currency, newest month first. Needs `inventory.view_costs_organisation`. Not paginated: a
     * kitchen's trading months are few, so the bounded range is answered whole.
     */
    listCostReport(filter?: MonthlyCostReportFilter): Promise<readonly MonthlyCostReportRow[]>;

    /**
     * The consumption-exception review list (INV1.5) — every thing a confirmed order could not deduct
     * honestly, filtered by resolution state and date, cursor-paginated. Needs `inventory.view_organisation`.
     */
    listConsumptionExceptions(
        filter?: ConsumptionExceptionFilter,
    ): Promise<CursorPage<ConsumptionException>>;
    /**
     * How many exceptions are unresolved right now, scoped to the active branch context (`X-Branch-Id`)
     * or the whole organisation when none is set — the count the hub badge and review KPI read.
     */
    countUnresolvedConsumptionExceptions(): Promise<number>;
    /** Marks one exception handled, returning the settled row. Idempotent. Needs `inventory.manage_organisation`. */
    resolveConsumptionException(
        exceptionId: string,
        request?: ResolveConsumptionExceptionRequest,
    ): Promise<ConsumptionException>;
    /**
     * Re-runs the consumption an exception blocks, returning the row after — resolved if the line now
     * consumes cleanly, still open with a refreshed detail otherwise. Idempotent; never double-deducts.
     * Needs `inventory.manage_organisation`.
     */
    retryConsumptionException(exceptionId: string): Promise<ConsumptionException>;

    /** The most recent fifty production orders, newest first. */
    listProductionOrders(): Promise<readonly ProductionOrder[]>;
    createProductionOrder(request: CreateProductionOrderRequest): Promise<ProductionOrderResult>;
    completeProductionOrder(
        productionOrderId: ProductionOrderId,
        request: CompleteProductionOrderRequest,
    ): Promise<ProductionOrderResult>;

    /** The most recent fifty checks, newest first, over both allow-listed subjects. */
    listQualityChecks(): Promise<readonly QualityCheck[]>;
    createQualityCheck(request: CreateQualityCheckRequest): Promise<QualityCheckResult>;
    holdQualityCheck(qualityCheckId: QualityCheckId): Promise<QualityCheckResult>;
    releaseQualityCheck(qualityCheckId: QualityCheckId): Promise<QualityCheckResult>;
}
