import type {
    BranchId,
    GoodsReceiptId,
    IngredientId,
    IsoDateTime,
    OrderId,
    ProductionOrderId,
    PurchaseOrderId,
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

/* ------------------------------------------------------------------------------------------------
 * Supply ordering (SUP3) — the shortage queue and its proposal
 * ---------------------------------------------------------------------------------------------- */

/**
 * How many shelves at one branch need ordering (SUP3) — the hub badge and the Supply orders
 * landing metrics.
 *
 * The three numbers **partition each other**: `outOfStockCount` plus `lowStockCount` equals `count`,
 * because a level that is both empty and below its threshold is counted once, as out of stock. A
 * screen may show any two and derive the third; it must never add all three.
 *
 * Deliberately wider than {@link KitchenOpsRepository.countLowStockLevels}, which is a *warning* and
 * ignores levels with no threshold set. A kitchen that never set a threshold on olive oil and has
 * run out of olive oil still needs to order olive oil.
 */
export interface SupplyNeedsCount {
    readonly count: number;
    readonly outOfStockCount: number;
    readonly lowStockCount: number;
}

/** Why a proposal row is in the list. A row satisfying both shortage rules is `outOfStock`. */
export type OrderProposalOrigin = 'outOfStock' | 'lowStock' | 'requested';

/** How a suggested quantity was reached. There is deliberately no `threshold` basis — see §2. */
export type SuggestedQuantityBasis = 'par' | 'none';

/**
 * Why a proposal row has no supplier to offer at all, or `null` when it has at least one.
 *
 * The two are kept apart because they have different fixes: `noSupplier` means nothing was ever
 * linked (link somebody), `suppliersArchived` means links exist and every one of them is archived
 * (restore one, or link somebody else). One empty dropdown for both would leave the person guessing.
 */
export type UnassignedReason = 'noSupplier' | 'suppliersArchived';

/**
 * One active supplier a proposal row could be bought from (SUP3).
 *
 * Archived suppliers never appear here. No price, and none is coming: this object exists so a
 * person can choose *who* to buy from, not to compare what they charge — the supply-order
 * permission is not the cost permission.
 */
export interface SupplierOption {
    readonly id: SupplierId;
    readonly code: string;
    readonly nameEn: string;
    readonly nameAr: string | null;
    /** This supplier holds the preferred flag for this stock item. */
    readonly isPreferred: boolean;
    /** Typical days from order to delivery, when the kitchen recorded one. */
    readonly leadTimeDays: number | null;
}

/**
 * One row of the supply-order builder (SUP3).
 *
 * `isOutOfStock` and `isLow` are independent readings of the numbers beside them — a shelf at zero
 * with a threshold set is genuinely both. `origin` is the single label the union produces, and it is
 * where the "counted once, as out of stock" rule lives.
 *
 * A `requested` row's `isOutOfStock` still follows from its `quantityOnHand`: a shelf that has never
 * moved at this branch reports `"0.0000"`, and `false` beside it would be a flag no client could
 * reconcile with the number it describes.
 *
 * `suggestedQuantity` is `parLevel - quantityOnHand`, and only that — never
 * `reorderThreshold - quantityOnHand`, because the threshold is the *trigger* and is compared
 * inclusively, so restocking exactly to it lands the shelf back on the boundary that raised the
 * alarm. `null` means the person must type a quantity.
 *
 * **No field here carries a price, a cost or a currency**, at any depth, and none ever will.
 */
export interface OrderProposalItem {
    readonly stockItemId: StockItemId;
    readonly itemCode: string;
    readonly itemNameEn: string;
    readonly unitId: string | null;
    /** The unit the quantity is counted in — `kg`, `l`, `piece`. */
    readonly unitCode: string;
    readonly branchId: BranchId;
    /** A decimal string at scale 4. `"0.0000"` when the shelf has no level row at this branch. */
    readonly quantityOnHand: string;
    readonly reorderThreshold: string | null;
    readonly parLevel: string | null;
    readonly isOutOfStock: boolean;
    readonly isLow: boolean;
    readonly origin: OrderProposalOrigin;
    /** A decimal string, or `null` when nothing can honestly be suggested. */
    readonly suggestedQuantity: string | null;
    readonly suggestedQuantityBasis: SuggestedQuantityBasis;
    /** Every active linked supplier, preferred first then by name. Rendered in this order. */
    readonly supplierOptions: readonly SupplierOption[];
    /**
     * The active preferred supplier, else the sole active option, else `null`.
     *
     * `null` with two or more options means the person must choose, which is **not** the same as
     * {@link unassignedReason} being set — there is somebody to choose from either way.
     */
    readonly suggestedSupplierId: SupplierId | null;
    readonly unassignedReason: UnassignedReason | null;
}

/**
 * What one branch should order, and who from (SUP3) — the supply-order builder's whole read.
 *
 * **Row order is the answer, not a hint.** Out of stock first, then low, then requested; each group
 * ordered by item name with the item code as tie-break. Clients render the order they are given and
 * never re-sort, exactly as they do not re-sort the stock-item picker.
 *
 * The counts describe the **queue only**: `requestedItemCount` is separate, and `outOfStockCount`
 * plus `lowStockCount` therefore agree exactly with {@link SupplyNeedsCount} for the same branch.
 */
export interface OrderProposal {
    readonly items: readonly OrderProposalItem[];
    readonly branchId: BranchId;
    readonly outOfStockCount: number;
    readonly lowStockCount: number;
    /** Rows with an {@link OrderProposalItem.unassignedReason} — nobody to buy them from. */
    readonly unassignedCount: number;
    readonly requestedItemCount: number;
}

/* ------------------------------------------------------------------------------------------------
 * Purchase orders (SUP4) — the order book
 * ---------------------------------------------------------------------------------------------- */

export const PURCHASE_ORDER_STATUSES = [
    'draft',
    'issued',
    'partially_received',
    'received',
    'cancelled',
] as const;

/**
 * Where an order has got to (SUP4, §3.5).
 *
 * `draft → issued → partially_received → received`, with `cancelled` reachable from the two states
 * in which nothing has arrived yet.
 *
 * **`issued`, never `sent`.** Phase 1 dispatches nothing through any channel: a person presses
 * Issue, the lines freeze, and they print the sheet and hand it over. Calling that `sent` would
 * claim an event the system did not perform.
 *
 * The two receiving states are reached by **posting a goods receipt**, never by an action of their
 * own, and no endpoint produces them yet. They are in the union now so that the client's capability
 * tables are closed over all five from the start — the day the receiving slice lands, nothing here
 * has to widen.
 */
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/**
 * One requested shelf, as the document says it (SUP4).
 *
 * Every display field is a **snapshot** taken when the line was written, not a live read of the
 * stock item — that is what makes an issued order immutable in practice rather than only in status.
 * A shelf renamed in March does not rename a line on an order issued in February, because the
 * supplier is holding a printed copy of the February wording.
 *
 * `stockItemId` is a **pointer**: a client deep-links to the shelf with it, and the receiving slice
 * matches a delivery line to this one with it. It is never the source of the label beside it.
 *
 * `id` is a plain string rather than a branded identifier: in this slice it is a React key and
 * nothing else, and the slice that makes it a real cross-reference is the one that should brand it.
 *
 * **No price, no cost, no currency**, here or anywhere on a purchase order.
 */
export interface PurchaseOrderLine {
    readonly id: string;
    readonly stockItemId: StockItemId;
    readonly itemCode: string;
    readonly itemNameEn: string;
    /**
     * Resolved server-side from the backing ingredient or catalogue item, because stock items carry
     * `nameEn` only. `null` when neither has one — an honest blank rather than English text printed
     * under an Arabic heading.
     */
    readonly itemNameAr: string | null;
    /** A decimal string, never a float. Always above zero. What was asked for. */
    readonly quantity: string;
    /**
     * How much has actually turned up, summed across every delivery against this line (SUP5).
     * Expressed in this line's own {@link unitCode}: a delivery quoted per kilogram against a shelf
     * counted in grams is converted server-side before it is summed, so the three quantities on one
     * row always add up. A quantity, not money — there is still none of that here.
     */
    readonly receivedQuantity: string;
    /**
     * What is still to come, and what the receive screen prefills. Floored at zero: an over-receipt
     * is a real event its variance note records, and a negative amount still to come would be an
     * arithmetic curiosity rather than an instruction.
     */
    readonly outstandingQuantity: string;
    readonly unitCode: string;
    /**
     * The supplier's own catalogue reference, read from the saved link at write time so the sheet
     * can quote it back at them. `null` for a one-off from somebody who does not normally sell this.
     */
    readonly supplierItemRef: string | null;
    readonly notes: string | null;
    /** The sequence the person building the order chose. Rendered as given, never re-sorted. */
    readonly displayOrder: number;
}

/** One named person as they stood at issue time — a transcription, not a pointer at a live row. */
export interface RecipientSnapshotContact {
    readonly name: string;
    readonly roleTitle: string | null;
    readonly email: string | null;
    readonly phone: string | null;
    readonly whatsappPhone: string | null;
    readonly isPrimary: boolean;
}

/**
 * Who the order was addressed to, at the instant it was issued (SUP4, §3.5).
 *
 * Captured on issue and never touched again. A supplier that moves premises in March must not
 * silently rewrite the February order it is holding a copy of — so a **draft** preview reads the
 * live supplier and an **issued** reprint reads this.
 */
export interface RecipientSnapshot {
    readonly supplierId: SupplierId;
    readonly code: string;
    readonly nameEn: string;
    readonly nameAr: string | null;
    /** Free text as the supplier gives it. Never geocoded. */
    readonly address: string | null;
    readonly paymentTerms: string | null;
    readonly leadTimeDays: number | null;
    /** The general office address, not the primary contact's. */
    readonly contactEmail: string | null;
    /** The general office line, not the primary contact's. */
    readonly contactPhone: string | null;
    /** Every named contact the supplier had at issue time, primary first. */
    readonly contacts: readonly RecipientSnapshotContact[];
}

/** The branch an order is for. One name column, so no {@link LocalisedText} to compose. */
export interface PurchaseOrderBranch {
    readonly id: BranchId;
    readonly name: string;
}

/**
 * The **live** supplier an order names — not the snapshot.
 *
 * `archivedAt` is on it deliberately: an issued order for a since-archived supplier is an ordinary
 * situation a detail screen has to explain, and a reference without the flag would leave the screen
 * guessing why Issue is refused.
 */
export interface PurchaseOrderSupplier {
    readonly id: SupplierId;
    readonly code: string;
    readonly nameEn: string;
    readonly nameAr: string | null;
    readonly archivedAt: IsoDateTime | null;
}

/**
 * One request the kitchen makes of one supplier, for one branch (SUP4, §3.5).
 *
 * **Two suppliers on an issued order, and both are deliberate.** {@link supplier} is the live record
 * with its archive flag, because a screen offering to issue needs to know whether the supplier is
 * still in the book. {@link recipientSnapshot} is who the document was addressed to at the instant
 * it was issued, and it is `null` on a draft because a draft has been addressed to nobody yet. A
 * client renders the live supplier on a draft and the snapshot from `issued` onward.
 *
 * `number` is the human handle both sides quote — minted **random rather than sequential**, because
 * a sequential number printed on a supplier's copy would tell them this kitchen's purchasing volume.
 *
 * **No money, at any depth**: not a price, an amount, a currency or a total, on the order, on a line
 * or inside the snapshot. Actual prices belong to goods receipts, where each partial delivery
 * carries the figure it was really invoiced at.
 */
export interface PurchaseOrder {
    readonly id: PurchaseOrderId;
    readonly number: string;
    readonly status: PurchaseOrderStatus;
    readonly branch: PurchaseOrderBranch | null;
    readonly supplier: PurchaseOrderSupplier | null;
    /** `null` on a draft; present from `issued` onward. */
    readonly recipientSnapshot: RecipientSnapshot | null;
    readonly notes: string | null;
    readonly lineCount: number;
    /** Survives cancellation — cancelling an issued order does not un-issue it. */
    readonly issuedAt: IsoDateTime | null;
    /**
     * When the last outstanding line actually arrived (SUP5). An order closed short reaches
     * `received` with this still `null` and {@link closedAt} set instead: nothing was last fulfilled,
     * and a date here would be a small lie in the one place a person checks.
     */
    readonly receivedAt: IsoDateTime | null;
    /** When the order stopped expecting anything more — set on both routes to `received`. */
    readonly closedAt: IsoDateTime | null;
    /** Why the rest was written off (SUP5). Only ever set on an order somebody closed short. */
    readonly closeShortReason: string | null;
    readonly cancelledAt: IsoDateTime | null;
    readonly createdAt: IsoDateTime | null;
    readonly lines: readonly PurchaseOrderLine[];
    /** Every delivery made against this order, oldest first (SUP5). */
    readonly receipts: readonly PurchaseOrderReceiptRef[];
}

/**
 * One delivery made against an order, as the order lists it (SUP5).
 *
 * A reference rather than the receipt itself: the date, the delivery note and the line count are
 * what an order detail shows, and the money on those lines is behind a permission the order response
 * does not check. A screen that wants the figures opens the receipt.
 */
export interface PurchaseOrderReceiptRef {
    readonly id: GoodsReceiptId;
    /** The branch-local business day the delivery was filed under, `YYYY-MM-DD`. */
    readonly receivedOn: string | null;
    readonly documentRef: string | null;
    readonly lineCount: number;
}

/** Narrows the order book (SUP4). */
export interface PurchaseOrderFilter extends CursorPageRequest {
    readonly status?: PurchaseOrderStatus | undefined;
    readonly supplierId?: SupplierId | undefined;
    /**
     * A **batch read**, not a filter: the shape a print preview needs when somebody issues four
     * orders and lays them out as one document. At most 50.
     */
    readonly ids?: readonly PurchaseOrderId[] | undefined;
}

/**
 * Everything a client may say about a line, and it is deliberately two fields.
 *
 * The item code, both names, the unit and the supplier's own catalogue reference are all resolved
 * server-side — a client that could name a line could put anything at all on a document a supplier
 * reads. There is no price field and none is coming.
 */
export interface PurchaseOrderLineInput {
    readonly stockItemId: StockItemId;
    /**
     * A decimal string above zero with at most four places. A string rather than a number because
     * `0.125` kg of saffron must arrive as `0.125`, and a float round trip is how that becomes
     * `0.12499999999999999`.
     */
    readonly quantity: string;
}

/** One draft, addressed to one supplier for one branch. */
export interface CreatePurchaseOrderInput {
    readonly supplierId: SupplierId;
    readonly branchId: BranchId;
    readonly lines: readonly PurchaseOrderLineInput[];
}

/**
 * One draft per supplier, created together or not at all (SUP4).
 *
 * `branchId` sits on each order because every proposal row carries the branch it was read for, which
 * is what makes a payload whose branch disagrees with its lines unrepresentable. The server then
 * insists they all agree: a proposal is always *for one branch*, so two branches in one body is a
 * refusal rather than a guess.
 *
 * This is exactly what the builder's grouping model emits, which is the point of it being a pure
 * function: the preview a person confirms and the request that gets sent are the same object.
 */
export interface CreatePurchaseOrdersRequest {
    readonly orders: readonly CreatePurchaseOrderInput[];
}

/**
 * Edits a draft (SUP4). Presence-keyed: an omitted field is left alone, `notes: null` clears.
 *
 * `lines` is a **full replace** — the body states the whole desired set — because a diff would need
 * an identity for a line the client does not name. Draft only; an issued order is refused.
 */
export interface UpdatePurchaseOrderRequest {
    readonly notes?: string | null | undefined;
    readonly lines?: readonly PurchaseOrderLineInput[] | undefined;
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

/** Every costing state a receipt can be in, closed so a screen's records cannot miss one. */
export const RECEIPT_COST_STATUSES = ['unpriced', 'partial', 'complete'] as const;

/**
 * Whether a receipt's costing is finished (SUP5, §3.6).
 *
 * Derived server-side from the lines and never set by hand: a line counts as settled when it carries
 * `costedAt`, the receipt is `complete` when every line does, `unpriced` when none does, `partial`
 * in between.
 *
 * A receipt whose only line is {@link GoodsReceiptLine.valuationPendingFx} therefore reads
 * `unpriced` even though its price is recorded, because its costing genuinely is not finished. The
 * pending count beside it is what tells a person which kind of unfinished it is.
 *
 * **Not redacted** without the cost permission: this says whether the paperwork needs attention, not
 * what anything cost.
 */
export type ReceiptCostStatus = (typeof RECEIPT_COST_STATUSES)[number];

export interface GoodsReceiptLine {
    /** The line's own identifier — what price completion names when it fills in a missing figure. */
    readonly id: string;
    readonly stockItemId: StockItemId;
    /**
     * The ordered line this delivery fulfils (SUP5). `null` for a direct market purchase and for an
     * unplanned extra item on an ordered delivery, both of which are ordinary.
     */
    readonly purchaseOrderLineId: string | null;
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
    /**
     * When this line's money was settled (SUP5). `null` means the costing path has not run and price
     * completion may still act on it — the guard that stops one quantity being costed twice. Never
     * redacted: it is a work state, not a figure.
     */
    readonly costedAt: IsoDateTime | null;
    /**
     * The price is recorded exactly as the supplier wrote it and could not be blended into the
     * ingredient's valuation currency (SUP5, §3.6). Physical receiving is never lost to a currency
     * and no exchange rate is ever invented; a later accounting phase may resolve it. Until then the
     * line is honestly incomplete rather than quietly wrong.
     */
    readonly valuationPendingFx: boolean;
}

export interface GoodsReceipt {
    readonly id: GoodsReceiptId;
    readonly branchId: BranchId;
    /** Who the stock was bought from (INV1.1), or `null`. */
    readonly supplier: SupplierRef | null;
    /** The supplier **delivery note**, as written (INV1.1) — the paper the driver handed over. */
    readonly documentRef: string | null;
    /** The supplier's invoice number (SUP5) — a different document, often days later. */
    readonly supplierInvoiceRef: string | null;
    /** The invoice date, `YYYY-MM-DD`. */
    readonly invoiceDate: string | null;
    /**
     * Why this delivery differs from what was ordered (SUP5). Required for an over-receipt and for
     * an unplanned extra item — a required explanation that was then discarded would be the plainest
     * kind of silent behaviour, so it is kept and shown.
     */
    readonly varianceNote: string | null;
    /** The order this delivery settled (SUP5), or `null` for a direct market purchase. */
    readonly purchaseOrderId: PurchaseOrderId | null;
    readonly receivedAt: IsoDateTime | null;
    /**
     * The branch-local business day this delivery is filed under, `YYYY-MM-DD` (SUP5). A different
     * fact from {@link receivedAt}, not a formatting of it: a van unloaded at 21:30 in Dubai is a
     * Tuesday delivery, and reading the UTC instant's date would file it on Monday.
     */
    readonly receivedOn: string | null;
    readonly costStatus: ReceiptCostStatus;
    /** Lines whose money is not settled — the work still outstanding on this receipt. */
    readonly unpricedLineCount: number;
    /** Lines whose price is recorded and whose valuation waits on an exchange-rate decision. */
    readonly valuationPendingCount: number;
    /** The one currency the priced lines share, or `null` (mixed, unpriced, or redacted). */
    readonly currencyCode: string | null;
    /** The **item subtotal** — Σ line totals. Never includes the header charges below. */
    readonly receiptTotalAmount: string | null;
    /** Sent positive and subtracted by the arithmetic; the sign convention lives server-side. */
    readonly discountAmount: string | null;
    readonly taxAmount: string | null;
    readonly deliveryAmount: string | null;
    readonly otherChargesAmount: string | null;
    /** What the supplier invoiced in total, when it is known. */
    readonly invoiceTotalAmount: string | null;
    /** `true` when the reader lacks the cost permission and every money field was nulled (INV1.1). */
    readonly costsRedacted: boolean;
    readonly lines: readonly GoodsReceiptLine[];
}

/**
 * One receipt with the order it settled (SUP5) — what the receive confirmation and the unpriced
 * queue's completion view read.
 *
 * The order block is a deliberate **manage-scoped subset** (§5): number, status and the per-line
 * arithmetic somebody standing over a pallet compares against. It is `null` for a direct purchase,
 * and it carries no money at any depth because a purchase order has none.
 */
export interface GoodsReceiptDetail extends GoodsReceipt {
    readonly purchaseOrder: ReceiptPurchaseOrderMatch | null;
}

export interface ReceiptPurchaseOrderMatch {
    readonly id: PurchaseOrderId;
    readonly number: string;
    readonly status: PurchaseOrderStatus;
    readonly lines: readonly ReceiptPurchaseOrderMatchLine[];
}

/** One ordered line and how much of it has arrived, all three quantities in the line's own unit. */
export interface ReceiptPurchaseOrderMatchLine {
    readonly purchaseOrderLineId: string;
    readonly stockItemId: StockItemId;
    readonly itemCode: string;
    readonly itemNameEn: string;
    readonly unitCode: string;
    readonly orderedQuantity: string;
    readonly receivedQuantity: string;
    readonly outstandingQuantity: string;
}

/**
 * One order a delivery could be received against (SUP5, §4).
 *
 * A **manage-scoped subset** of the order book rather than the order book: §5 permits a receiver
 * holding `inventory.manage_organisation` to see an issued order's supplier, outstanding items and
 * quantities without the ordering code, because the person unloading the van is rarely the person
 * who decided to order it. No notes, no recipient snapshot, no history, and no money.
 */
export interface ReceivableOrder {
    readonly id: PurchaseOrderId;
    readonly number: string;
    readonly status: PurchaseOrderStatus;
    readonly branchId: BranchId;
    readonly supplier: SupplierRef | null;
    readonly issuedAt: IsoDateTime | null;
    readonly lineCount: number;
    /**
     * Lines with something still to come. Fully delivered lines stay in {@link lines} — a person
     * checking a delivery against a sheet needs to see the row accounted for rather than missing.
     */
    readonly outstandingLineCount: number;
    readonly lines: readonly ReceivableOrderLine[];
}

/**
 * One ordered line with its outstanding quantity — what a receive row is prefilled from (§4).
 *
 * The unit is fixed from the order line, so a delivery cannot silently be counted in something else.
 */
export interface ReceivableOrderLine {
    readonly purchaseOrderLineId: string;
    readonly stockItemId: StockItemId;
    readonly itemCode: string;
    readonly itemNameEn: string;
    readonly itemNameAr: string | null;
    readonly unitCode: string;
    readonly unitId: string | null;
    readonly orderedQuantity: string;
    readonly receivedQuantity: string;
    readonly outstandingQuantity: string;
}

/** Narrows the receivable-orders picker. The branch is required — receiving is always at one site. */
export interface ReceivableOrderFilter {
    readonly branchId: BranchId;
    readonly supplierId?: SupplierId | undefined;
}

/**
 * One row of the unpriced-receipts work queue (SUP5, §3.6).
 *
 * Deliberately not the whole receipt: this is a list somebody scans to decide what to open next.
 * The two counts are two different jobs — {@link unpricedLineCount} is "type these prices in",
 * {@link valuationPendingCount} is "the prices are already here and an exchange-rate decision is not
 * this screen's to make". A queue showing one number for both would send people to rows they cannot
 * action. There is no money here at all; the amounts are on the detail, behind the same gate.
 */
export interface UnpricedReceipt {
    readonly id: GoodsReceiptId;
    readonly receivedOn: string | null;
    readonly supplier: SupplierRef | null;
    readonly documentRef: string | null;
    readonly supplierInvoiceRef: string | null;
    readonly purchaseOrderId: PurchaseOrderId | null;
    readonly costStatus: ReceiptCostStatus;
    readonly lineCount: number;
    readonly unpricedLineCount: number;
    readonly valuationPendingCount: number;
}

/** Narrows the unpriced queue, plus the cursor. */
export interface UnpricedReceiptFilter extends CursorPageRequest {
    readonly branchId?: BranchId | undefined;
    readonly supplierId?: SupplierId | undefined;
}

/**
 * One line's missing price (SUP5).
 *
 * `lineTotalAmount` is optional and is **checked** server-side against quantity × unit price rather
 * than stored as given: the total and the price are two views of one fact, and a database holding
 * two answers for it is worse than one that refuses.
 */
export interface CompleteReceiptPriceLine {
    readonly goodsReceiptLineId: string;
    readonly unitPriceAmount: number;
    readonly lineTotalAmount?: number | null | undefined;
    readonly costCurrencyCode: string;
}

/**
 * Prices only (SUP5). The quantities are untouchable: posted quantities are never edited in place,
 * and nothing on this request could change what arrived.
 */
export interface CompleteReceiptPricesRequest {
    readonly lines: readonly CompleteReceiptPriceLine[];
}

export interface GoodsReceiptLineInput {
    readonly stockItemId: StockItemId;
    /**
     * The ordered line this delivery fulfils (SUP5). Only valid when the receipt names a
     * `purchaseOrderId`, and it must belong to that order and stock the same item. Omitted on a
     * direct purchase and on an unplanned extra item, which needs the receipt's `varianceNote`.
     */
    readonly purchaseOrderLineId?: string | null | undefined;
    readonly quantity: number;
    /** Required whenever a price is given: the unit the price is quoted per (INV1.1). */
    readonly unitId?: string | null | undefined;
    /** Major-unit price per {@link unitId}. A priced line needs a `unitId` and a `costCurrencyCode`. */
    readonly unitPriceAmount?: number | null | undefined;
    readonly costCurrencyCode?: string | null | undefined;
}

export interface PostGoodsReceiptRequest {
    readonly branchId: BranchId;
    /**
     * Who the stock was bought from (INV1.1). Required in practice alongside `purchaseOrderId`: a
     * delivery against an order must name that order's supplier.
     */
    readonly supplierId?: SupplierId | null | undefined;
    /** The supplier **delivery note**, as written (INV1.1). */
    readonly documentRef?: string | null | undefined;
    /** The supplier's invoice number (SUP5) — a different document from the delivery note. */
    readonly supplierInvoiceRef?: string | null | undefined;
    /** The invoice date, `YYYY-MM-DD`. */
    readonly invoiceDate?: string | null | undefined;
    /**
     * The branch-local business day this delivery belongs to, `YYYY-MM-DD` (SUP5). Omit it and the
     * server reads today at the receiving branch. A future date is refused.
     */
    readonly receivedOn?: string | null | undefined;
    /**
     * Why this delivery differs from what was ordered. Required for an over-receipt and for any line
     * with no `purchaseOrderLineId` on a delivery against an order.
     */
    readonly varianceNote?: string | null | undefined;
    /**
     * The order this delivery settles (SUP5). It must be issued or partially received and must name
     * this receipt's branch and supplier; its received state is updated in the same transaction.
     */
    readonly purchaseOrderId?: PurchaseOrderId | null | undefined;
    /** Sent **positive** and subtracted by the arithmetic — the sign convention lives server-side. */
    readonly discountAmount?: number | null | undefined;
    readonly taxAmount?: number | null | undefined;
    readonly deliveryAmount?: number | null | undefined;
    readonly otherChargesAmount?: number | null | undefined;
    /**
     * When sent it must equal `Σ line totals − discount + tax + delivery + other charges`, else the
     * post is refused with the difference named.
     */
    readonly invoiceTotalAmount?: number | null | undefined;
    /**
     * Confirms that more is arriving than the order still has outstanding. Required to record an
     * over-receipt at all, and not sufficient on its own: §3.5 asks for an explicit confirmation
     * **and** a variance note — one records that somebody clicked, the other what they knew.
     */
    readonly overReceiptConfirmed?: boolean | undefined;
    /**
     * Close the rest of this order (§3.5). Only valid with a `purchaseOrderId`. If the delivery
     * turns out to complete the order anyway, no reason is stored — there is nothing to explain.
     */
    readonly closeShort?: boolean | undefined;
    /** Required with `closeShort`. A blank is not an explicit reason. */
    readonly closeShortReason?: string | null | undefined;
    readonly lines: readonly GoodsReceiptLineInput[];
}

/**
 * The store's own reply to a post — the id, plus the two facts a screen acts on straight away
 * (SUP5): which day the delivery was filed under, and whether its paperwork is done. Everything
 * else is a re-read.
 */
export interface GoodsReceiptResult {
    readonly id: GoodsReceiptId;
    readonly receivedOn: string | null;
    readonly costStatus: ReceiptCostStatus;
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
    /** The branch-local business day the receipt is filed under (SUP5) — what week/month grouping reads. */
    readonly receivedOn: string | null;
    readonly supplier: SupplierRef | null;
    readonly documentRef: string | null;
    readonly purchaseOrderId: PurchaseOrderId | null;
    /** The parent receipt's costing state (SUP5) — what the completeness filter reads. */
    readonly costStatus: ReceiptCostStatus | null;
    readonly stockItemId: StockItemId;
    readonly itemCode: string | null;
    readonly itemNameEn: string | null;
    readonly ingredientId: IngredientId | null;
    readonly quantity: string;
    readonly unitId: string | null;
    readonly unitPriceAmount: string | null;
    readonly lineTotalAmount: string | null;
    readonly costCurrencyCode: string | null;
    /** This line's price is recorded and its valuation waits on an exchange rate (SUP5). */
    readonly valuationPendingFx: boolean;
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
    /** Only lines whose receipt was made against this order (SUP5). */
    readonly purchaseOrderId?: PurchaseOrderId | undefined;
    /** Only lines whose receipt is in this costing state (SUP5) — the completeness filter. */
    readonly costStatus?: ReceiptCostStatus | undefined;
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
     * How many shelves at one branch need ordering (SUP3) — the hub badge and the landing metrics.
     *
     * **The first ops read that takes a branch as an argument**, and the exception to the file
     * header's rule that levels narrow through `X-Branch-Id`. A proposal is always *for one branch*,
     * and a manager holding an organisation-wide membership has no header branch at all yet must
     * still be able to prepare an order for a site — so the branch is the question here, not the
     * context. Needs `inventory.order_supplies_organisation`, not the plain view code: this number
     * is the front door of the order book.
     */
    countSupplyNeeds(branchId: BranchId): Promise<SupplyNeedsCount>;
    /**
     * What one branch should order, and who from (SUP3) — the supply-order builder's whole read.
     *
     * `stockItemIds` are the **Add another item** picks: shelves that join the proposal whatever
     * their level says, deduped against the queue so an item that was already short is one row
     * rather than two. At most 100. Re-querying with a longer list is how a row is added, so that
     * one place decides what a proposal row looks like.
     *
     * Nothing is created — reading this twice is free of consequence. Needs
     * `inventory.order_supplies_organisation`; no part of the response is cost-bearing.
     */
    getOrderProposal(
        branchId: BranchId,
        stockItemIds?: readonly StockItemId[],
    ): Promise<OrderProposal>;
    /**
     * The order book, newest first, cursor-paginated (SUP4).
     *
     * `filter.ids` is a **batch read** rather than a filter — the shape a print preview needs when
     * several orders are laid out as one document, so that four orders cost one request. At most 50.
     *
     * Rows carry their full line sets, because there is one purchase-order shape rather than a list
     * variant and a detail variant. Needs `inventory.order_supplies_organisation`: the **read** is
     * gated too, because this names who the kitchen buys from rather than what is on a shelf.
     */
    listPurchaseOrders(filter?: PurchaseOrderFilter): Promise<CursorPage<PurchaseOrder>>;
    /** One order, whole — the same shape the list serves. */
    getPurchaseOrder(purchaseOrderId: PurchaseOrderId): Promise<PurchaseOrder>;
    /**
     * One draft per supplier, created together or not at all, **returned in request order** — the
     * person confirmed a grouping preview and the answer has to line up with it row for row.
     *
     * A supplier that has been archived answers a conflict, not a validation failure: the identifier
     * is fine, its state is not.
     */
    createPurchaseOrders(request: CreatePurchaseOrdersRequest): Promise<readonly PurchaseOrder[]>;
    /**
     * Rewrites a draft's notes, its lines, or both. Presence-keyed; `lines` is a full replace.
     * An issued order is refused with `details.reason = purchase_order_not_draft`.
     */
    updatePurchaseOrder(
        purchaseOrderId: PurchaseOrderId,
        request: UpdatePurchaseOrderRequest,
    ): Promise<PurchaseOrder>;
    /**
     * Freezes the document and captures who it was addressed to (SUP4).
     *
     * **Issue, not send** — nothing is dispatched through any channel. Refused for a non-draft or an
     * archived supplier, each with its own `details.reason`.
     */
    issuePurchaseOrder(purchaseOrderId: PurchaseOrderId): Promise<PurchaseOrder>;
    /**
     * Stops a draft or issued order. Deletes nothing and keeps `issuedAt`: cancelling does not
     * un-issue, and a reprint of a cancelled order should still say when it went out.
     */
    cancelPurchaseOrder(purchaseOrderId: PurchaseOrderId): Promise<PurchaseOrder>;
    /**
     * The goods-receipt form's reference data (INV1.1) — the currencies a price can be booked in, the
     * organisation's default currency, and the measurement units a line can be quoted in. Needs
     * `inventory.view_organisation`.
     */
    getProcurementReference(): Promise<ProcurementReference>;
    /** The most recent fifty receipts, newest first. Costs redacted without the cost permission. */
    listGoodsReceipts(): Promise<readonly GoodsReceipt[]>;
    /**
     * One receipt with the order it settled, its cost status and its variance (SUP5).
     *
     * Needs `inventory.manage_organisation` — the same code that posted it. The money inside is
     * redacted without `inventory.view_costs_organisation`; the work states are not.
     */
    getGoodsReceipt(goodsReceiptId: GoodsReceiptId): Promise<GoodsReceiptDetail>;
    postGoodsReceipt(request: PostGoodsReceiptRequest): Promise<GoodsReceiptResult>;
    /**
     * Orders a delivery could be received against at one branch, with each line's outstanding
     * quantity (SUP5, §4).
     *
     * Needs `inventory.manage_organisation`, **not** the ordering code: §5 permits this
     * manage-scoped subset so a receiver can book in a delivery without holding the order book.
     */
    listReceivableOrders(filter: ReceivableOrderFilter): Promise<readonly ReceivableOrder[]>;
    /**
     * The unpriced-receipts work queue, oldest first (SUP5, §3.6). Needs
     * `inventory.view_costs_organisation`.
     */
    listUnpricedReceipts(filter?: UnpricedReceiptFilter): Promise<CursorPage<UnpricedReceipt>>;
    /**
     * Fills in the prices a receipt was posted without (SUP5, §3.6).
     *
     * Prices each line **once** — a line already costed is refused rather than silently skipped —
     * and never moves stock. Needs `inventory.view_costs_organisation`: entering a price off the
     * delivery note at the door is a warehouse job, going back over the money afterwards is not.
     */
    completeReceiptPrices(
        goodsReceiptId: GoodsReceiptId,
        request: CompleteReceiptPricesRequest,
    ): Promise<GoodsReceiptDetail>;
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
