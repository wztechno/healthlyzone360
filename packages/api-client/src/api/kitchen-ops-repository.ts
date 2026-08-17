import {
    BranchId,
    GoodsReceiptId,
    IngredientId,
    OrderId,
    ProductionOrderId,
    QualityCheckId,
    RecipeVersionId,
    StockItemId,
    SupplierContactId,
    SupplierId,
    UserId,
} from '@healthy360/domain-types';

import type { CursorPage } from '../contracts/pagination.ts';
import type {
    CompleteProductionOrderRequest,
    ConsumptionException,
    ConsumptionExceptionFilter,
    ConsumptionExceptionReasonCode,
    CreateProductionOrderRequest,
    CreateQualityCheckRequest,
    CreateSupplierRequest,
    DeleteSupplierLinkRequest,
    GoodsReceipt,
    GoodsReceiptLine,
    GoodsReceiptResult,
    ItemLatestPurchase,
    KitchenOpsRepository,
    LastPurchase,
    MonthlyCostReportFilter,
    MonthlyCostReportRow,
    OrderProposal,
    OrderProposalItem,
    OrderProposalOrigin,
    PostGoodsReceiptRequest,
    ProcurementReference,
    ProductionOrder,
    ProductionOrderResult,
    PurchaseLedgerFilter,
    PurchaseLedgerLine,
    QualityCheck,
    QualityCheckResult,
    ResolveConsumptionExceptionRequest,
    SetStockThresholdRequest,
    StockAdjustmentRequest,
    StockItem,
    StockLevel,
    StockMovement,
    StockWasteRequest,
    ReplaceSupplierContactsRequest,
    SuppliedItem,
    Supplier,
    SupplierContact,
    SupplierDetail,
    SupplierFilter,
    SupplierLink,
    SupplierOption,
    SupplierRef,
    SupplyNeedsCount,
    UnassignedReason,
    UpdateSupplierRequest,
    UpsertSupplierLinkRequest,
} from '../contracts/kitchen-ops.ts';
import type {
    ConsumptionException as WireConsumptionException,
    GoodsReceipt as WireGoodsReceipt,
    GoodsReceiptLine as WireGoodsReceiptLine,
    ItemLatestPurchase as WireItemLatestPurchase,
    LastPurchase as WireLastPurchase,
    MonthlyCostReportRow as WireMonthlyCostReportRow,
    OrderProposalItem as WireOrderProposalItem,
    ProcurementReference as WireProcurementReference,
    ProductionOrder as WireProductionOrder,
    PurchasesLedgerLine as WirePurchaseLedgerLine,
    QualityCheck as WireQualityCheck,
    StockItem as WireStockItem,
    StockLevel as WireStockLevel,
    StockMovement as WireStockMovement,
    SuppliedItem as WireSuppliedItem,
    Supplier as WireSupplier,
    SupplierContact as WireSupplierContact,
    SupplierDetail as WireSupplierDetail,
    SupplierLink as WireSupplierLink,
    SupplierOption as WireSupplierOption,
    SupplierRef as WireSupplierRef,
} from '../generated/types.ts';
import type { Transport } from './transport.ts';

/**
 * Kitchen ops (O1–O4), backed by the real Laravel routes under `/catalogue/{inventory,
 * procurement, production, quality-control}`.
 *
 * None of these rows is lock-versioned, so unlike `kitchen-admin-writes.ts` no write here carries
 * an `If-Match`. And none of the mutation responses hands back a full record — the Laravel
 * controllers answer an id (and, for production orders and quality checks, the new status) rather
 * than the row itself — so every write here returns exactly what the wire promises rather than
 * inventing a follow-up read the contract does not ask for. A screen that needs the fresh row
 * re-reads the list, which is also how it discovers a row another kitchen tablet just created.
 */

function mapStockItem(wire: WireStockItem): StockItem {
    return {
        id: StockItemId.unsafe(wire.id),
        code: wire.code,
        nameEn: wire.name_en,
        unitCode: wire.unit_code,
        ingredientId: wire.ingredient_id === null ? null : IngredientId.unsafe(wire.ingredient_id),
        catalogueItemId: wire.catalogue_item_id,
        backing: wire.backing,
        isStocked: wire.is_stocked,
        hasHistory: wire.has_history,
    };
}

function mapStockLevel(wire: WireStockLevel): StockLevel {
    return {
        id: wire.id,
        branchId: BranchId.unsafe(wire.branch_id),
        stockItemId: StockItemId.unsafe(wire.stock_item_id),
        quantity: wire.quantity,
        reorderThreshold: wire.reorder_threshold,
        parLevel: wire.par_level,
        isLow: wire.is_low,
        itemCode: wire.item_code,
        itemNameEn: wire.item_name_en,
        ingredientId: wire.ingredient_id === null ? null : IngredientId.unsafe(wire.ingredient_id),
    };
}

function mapStockMovement(wire: WireStockMovement): StockMovement {
    return {
        id: wire.id,
        quantityDelta: wire.quantity_delta,
        reason: wire.reason as StockMovement['reason'],
    };
}

/**
 * The wire's flat `name_en`/`name_ar` composed into the bilingual name the screens edit (SUP1).
 *
 * `ar` falls back to `''` rather than staying null, because `LocalisedText` promises two strings
 * and a form bound to `null` would render "null" in the Arabic box the first time somebody typed
 * into it. Empty is what "not translated yet" looks like everywhere else in this workspace.
 */
function mapSupplier(wire: WireSupplier): Supplier {
    return {
        id: SupplierId.unsafe(wire.id),
        code: wire.code,
        name: { en: wire.name_en, ar: wire.name_ar ?? '' },
        currencyCode: wire.currency_code,
        contactEmail: wire.contact_email,
        contactPhone: wire.contact_phone,
        address: wire.address,
        paymentTerms: wire.payment_terms,
        leadTimeDays: wire.lead_time_days,
        notes: wire.notes,
        archivedAt: wire.archived_at,
        contactCount: wire.contact_count,
        suppliedItemCount: wire.supplied_item_count,
        primaryContact:
            wire.primary_contact === null
                ? null
                : { name: wire.primary_contact.name, phone: wire.primary_contact.phone },
    };
}

function mapSupplierContact(wire: WireSupplierContact): SupplierContact {
    return {
        id: SupplierContactId.unsafe(wire.id),
        name: wire.name,
        roleTitle: wire.role_title,
        email: wire.email,
        phone: wire.phone,
        whatsappPhone: wire.whatsapp_phone,
        isPrimary: wire.is_primary,
        displayOrder: wire.display_order,
    };
}

function mapLastPurchase(wire: WireLastPurchase): LastPurchase {
    return {
        goodsReceiptId: GoodsReceiptId.unsafe(wire.goods_receipt_id),
        documentRef: wire.document_ref,
        receivedAt: wire.received_at,
        quantity: wire.quantity,
        unitId: wire.unit_id,
        unitCode: wire.unit_code,
        // Money stays a string all the way through: the wire's decimals are the precision
        // guarantee, and `Number()` here would round a real price before anything formatted it.
        unitPriceAmount: wire.unit_price_amount,
        costCurrencyCode: wire.cost_currency_code,
    };
}

function mapSuppliedItem(wire: WireSuppliedItem): SuppliedItem {
    return {
        stockItem:
            wire.stock_item === null
                ? null
                : {
                      id: StockItemId.unsafe(wire.stock_item.id),
                      code: wire.stock_item.code,
                      nameEn: wire.stock_item.name_en,
                      unitCode: wire.stock_item.unit_code,
                      backing: wire.stock_item.backing,
                  },
        isPreferred: wire.is_preferred,
        supplierItemRef: wire.supplier_item_ref,
        // Null here is "never bought here yet" and is never conflated with a redacted amount —
        // the two are different facts and the screen renders them differently.
        lastPurchase: wire.last_purchase === null ? null : mapLastPurchase(wire.last_purchase),
    };
}

function mapItemLatestPurchase(wire: WireItemLatestPurchase): ItemLatestPurchase {
    return {
        ...mapLastPurchase(wire),
        stockItemId: StockItemId.unsafe(wire.stock_item_id),
        supplier: mapSupplierRef(wire.supplier),
    };
}

function mapSupplierDetail(wire: WireSupplierDetail): SupplierDetail {
    return {
        ...mapSupplier(wire),
        contacts: wire.contacts.map(mapSupplierContact),
        suppliedItems: wire.supplied_items.map(mapSuppliedItem),
        costsRedacted: wire.costs_redacted,
    };
}

function mapSupplierLink(wire: WireSupplierLink): SupplierLink {
    return {
        supplierId: SupplierId.unsafe(wire.supplier_id),
        stockItemId: StockItemId.unsafe(wire.stock_item_id),
        isPreferred: wire.is_preferred,
        supplierItemRef: wire.supplier_item_ref,
    };
}

/**
 * The wire's snake-cased enums, in the workspace's camelCase (SUP3).
 *
 * Mapped rather than passed through so a screen never writes `'out_of_stock'` in a comparison: the
 * contract's union is the vocabulary, and a typo in it is a typecheck failure rather than a branch
 * that silently never runs.
 */
const PROPOSAL_ORIGINS: Readonly<Record<WireOrderProposalItem['origin'], OrderProposalOrigin>> = {
    out_of_stock: 'outOfStock',
    low_stock: 'lowStock',
    requested: 'requested',
};

/**
 * Keyed on the wire's own union rather than on `string`, so a reason the server starts sending and
 * this map has never heard of is a typecheck failure here instead of an `undefined` reaching a
 * screen that would render the row as if it had a supplier.
 */
const UNASSIGNED_REASONS: Readonly<
    Record<Exclude<WireOrderProposalItem['unassigned_reason'], null>, UnassignedReason>
> = {
    no_supplier: 'noSupplier',
    suppliers_archived: 'suppliersArchived',
};

function mapSupplierOption(wire: WireSupplierOption): SupplierOption {
    return {
        id: SupplierId.unsafe(wire.id),
        code: wire.code,
        nameEn: wire.name_en,
        nameAr: wire.name_ar,
        isPreferred: wire.is_preferred,
        leadTimeDays: wire.lead_time_days,
    };
}

function mapOrderProposalItem(wire: WireOrderProposalItem): OrderProposalItem {
    return {
        stockItemId: StockItemId.unsafe(wire.stock_item_id),
        itemCode: wire.item_code,
        itemNameEn: wire.item_name_en,
        unitId: wire.unit_id,
        unitCode: wire.unit_code,
        branchId: BranchId.unsafe(wire.branch_id),
        // Quantities stay strings the whole way through, on the same terms as a price: the wire's
        // decimals are the precision guarantee, and `Number()` here would round a par calculation
        // before anything got the chance to render it.
        quantityOnHand: wire.quantity_on_hand,
        reorderThreshold: wire.reorder_threshold,
        parLevel: wire.par_level,
        isOutOfStock: wire.is_out_of_stock,
        isLow: wire.is_low,
        origin: PROPOSAL_ORIGINS[wire.origin],
        suggestedQuantity: wire.suggested_quantity,
        suggestedQuantityBasis: wire.suggested_quantity_basis,
        supplierOptions: wire.supplier_options.map(mapSupplierOption),
        suggestedSupplierId:
            wire.suggested_supplier_id === null
                ? null
                : SupplierId.unsafe(wire.suggested_supplier_id),
        unassignedReason:
            wire.unassigned_reason === null ? null : UNASSIGNED_REASONS[wire.unassigned_reason],
    };
}

/**
 * One contact as the replace endpoint wants it.
 *
 * `id` is sent only when the caller named one — a contact without it is a create, and an explicit
 * `id: null` would say the same thing more noisily.
 */
function wireSupplierContact(
    contact: ReplaceSupplierContactsRequest['contacts'][number],
): Record<string, unknown> {
    return {
        ...(contact.id === undefined || contact.id === null ? {} : { id: String(contact.id) }),
        name: contact.name,
        ...(contact.roleTitle === undefined ? {} : { role_title: contact.roleTitle }),
        ...(contact.email === undefined ? {} : { email: contact.email }),
        ...(contact.phone === undefined ? {} : { phone: contact.phone }),
        ...(contact.whatsappPhone === undefined ? {} : { whatsapp_phone: contact.whatsappPhone }),
        ...(contact.isPrimary === undefined ? {} : { is_primary: contact.isPrimary }),
        ...(contact.displayOrder === undefined ? {} : { display_order: contact.displayOrder }),
    };
}

/**
 * The writable half of a supplier, in wire spelling.
 *
 * Shared by create and update because the field list is the same one; the two differ only in which
 * fields are required, and that is the contract's job rather than this function's. The
 * `undefined → omit` idiom is what keeps "leave this alone" distinct from "clear this" on a PATCH.
 */
function wireSupplierFields(
    request: CreateSupplierRequest | UpdateSupplierRequest,
): Record<string, unknown> {
    return {
        ...(request.nameAr === undefined ? {} : { name_ar: request.nameAr }),
        ...(request.code === undefined ? {} : { code: request.code }),
        ...(request.currencyCode === undefined ? {} : { currency_code: request.currencyCode }),
        ...(request.contactEmail === undefined ? {} : { contact_email: request.contactEmail }),
        ...(request.contactPhone === undefined ? {} : { contact_phone: request.contactPhone }),
        ...(request.address === undefined ? {} : { address: request.address }),
        ...(request.paymentTerms === undefined ? {} : { payment_terms: request.paymentTerms }),
        ...(request.leadTimeDays === undefined ? {} : { lead_time_days: request.leadTimeDays }),
        ...(request.notes === undefined ? {} : { notes: request.notes }),
    };
}

function mapProcurementReference(wire: WireProcurementReference): ProcurementReference {
    return {
        currencies: wire.currencies.map((currency) => ({
            code: currency.code,
            nameEn: currency.name_en,
        })),
        defaultCurrencyCode: wire.default_currency_code,
        measurementUnits: wire.measurement_units.map((unit) => ({
            id: unit.id,
            code: unit.code,
            dimension: unit.dimension,
            nameEn: unit.name_en,
        })),
    };
}

function mapSupplierRef(wire: WireSupplierRef | null): SupplierRef | null {
    return wire === null
        ? null
        : { id: SupplierId.unsafe(wire.id), code: wire.code, nameEn: wire.name_en };
}

function mapGoodsReceiptLine(line: WireGoodsReceiptLine): GoodsReceiptLine {
    return {
        stockItemId: StockItemId.unsafe(line.stock_item_id),
        quantity: line.quantity,
        unitId: line.unit_id,
        unitPriceAmount: line.unit_price_amount,
        lineTotalAmount: line.line_total_amount,
        costCurrencyCode: line.cost_currency_code,
    };
}

function mapGoodsReceipt(wire: WireGoodsReceipt): GoodsReceipt {
    return {
        id: GoodsReceiptId.unsafe(wire.id),
        branchId: BranchId.unsafe(wire.branch_id),
        supplier: mapSupplierRef(wire.supplier),
        documentRef: wire.document_ref,
        purchaseOrderId: wire.purchase_order_id,
        receivedAt: wire.received_at,
        currencyCode: wire.currency_code,
        receiptTotalAmount: wire.receipt_total_amount,
        costsRedacted: wire.costs_redacted,
        lines: wire.lines.map(mapGoodsReceiptLine),
    };
}

function mapPurchaseLedgerLine(wire: WirePurchaseLedgerLine): PurchaseLedgerLine {
    return {
        id: wire.id,
        goodsReceiptId: GoodsReceiptId.unsafe(wire.goods_receipt_id),
        receivedAt: wire.received_at,
        supplier: mapSupplierRef(wire.supplier),
        documentRef: wire.document_ref,
        stockItemId: StockItemId.unsafe(wire.stock_item_id),
        itemCode: wire.item_code,
        itemNameEn: wire.item_name_en,
        ingredientId: wire.ingredient_id === null ? null : IngredientId.unsafe(wire.ingredient_id),
        quantity: wire.quantity,
        unitId: wire.unit_id,
        unitPriceAmount: wire.unit_price_amount,
        lineTotalAmount: wire.line_total_amount,
        costCurrencyCode: wire.cost_currency_code,
        costsRedacted: wire.costs_redacted,
    };
}

function mapMonthlyCostReportRow(wire: WireMonthlyCostReportRow): MonthlyCostReportRow {
    return {
        month: wire.month,
        currencyCode: wire.currency_code,
        spendAmount: wire.spend_amount,
        cogsAmount: wire.cogs_amount,
        wasteAmount: wire.waste_amount,
        wasteQuantity: wire.waste_quantity,
        revenueAmount: wire.revenue_amount,
        grossMarginAmount: wire.gross_margin_amount,
        grossMarginPercent: wire.gross_margin_percent,
        mealRevenueAmount: wire.meal_revenue_amount,
        productRevenueAmount: wire.product_revenue_amount,
        otherRevenueAmount: wire.other_revenue_amount,
        mealCogsAmount: wire.meal_cogs_amount,
        productCogsAmount: wire.product_cogs_amount,
        otherCogsAmount: wire.other_cogs_amount,
        hasDataQualityFlag: wire.has_data_quality_flag,
        exceptionCount: wire.exception_count,
    };
}

function mapConsumptionException(wire: WireConsumptionException): ConsumptionException {
    return {
        id: wire.id,
        orderId: wire.order_id === null ? null : OrderId.unsafe(wire.order_id),
        orderNumber: wire.order_number,
        orderLineId: wire.order_line_id,
        catalogueItemId: wire.catalogue_item_id,
        itemNameEn: wire.item_name_en,
        branchId: wire.branch_id === null ? null : BranchId.unsafe(wire.branch_id),
        branchName: wire.branch_name,
        reasonCode: wire.reason_code as ConsumptionExceptionReasonCode,
        detail: wire.detail,
        resolved: wire.resolved,
        resolvedAt: wire.resolved_at,
        resolvedBy: wire.resolved_by === null ? null : UserId.unsafe(wire.resolved_by),
        resolutionNote: wire.resolution_note,
        createdAt: wire.created_at,
    };
}

function mapProductionOrder(wire: WireProductionOrder): ProductionOrder {
    return {
        id: ProductionOrderId.unsafe(wire.id),
        recipeVersionId: RecipeVersionId.unsafe(wire.recipe_version_id),
        status: wire.status,
        branchId: BranchId.unsafe(wire.branch_id),
    };
}

function mapQualityCheck(wire: WireQualityCheck): QualityCheck {
    return {
        id: QualityCheckId.unsafe(wire.id),
        subjectType: wire.subject_type,
        subjectId: wire.subject_id,
        status: wire.status,
    };
}

export function createApiKitchenOpsRepository(transport: Transport): KitchenOpsRepository {
    return {
        async listStockItems(): Promise<readonly StockItem[]> {
            const envelope = await transport.requestEnvelope<{
                readonly stock_items: readonly WireStockItem[];
            }>({ method: 'GET', path: '/catalogue/inventory/items' });
            return envelope.data.stock_items.map(mapStockItem);
        },

        async listStockLevels(): Promise<readonly StockLevel[]> {
            const envelope = await transport.requestEnvelope<{
                readonly levels: readonly WireStockLevel[];
            }>({ method: 'GET', path: '/catalogue/inventory/levels' });
            return envelope.data.levels.map(mapStockLevel);
        },

        async recordStockAdjustment(request: StockAdjustmentRequest): Promise<StockMovement> {
            const envelope = await transport.requestEnvelope<{
                readonly movement: WireStockMovement;
            }>({
                method: 'POST',
                path: '/catalogue/inventory/adjustments',
                body: {
                    branch_id: String(request.branchId),
                    stock_item_id: String(request.stockItemId),
                    quantity_delta: request.quantityDelta,
                    ...(request.notes === undefined ? {} : { notes: request.notes }),
                },
            });
            return mapStockMovement(envelope.data.movement);
        },

        async recordStockWaste(request: StockWasteRequest): Promise<StockMovement> {
            const envelope = await transport.requestEnvelope<{
                readonly movement: WireStockMovement;
            }>({
                method: 'POST',
                path: '/catalogue/inventory/waste',
                body: {
                    branch_id: String(request.branchId),
                    stock_item_id: String(request.stockItemId),
                    quantity: request.quantity,
                    ...(request.notes === undefined ? {} : { notes: request.notes }),
                },
            });
            return mapStockMovement(envelope.data.movement);
        },

        async setStockThreshold(request: SetStockThresholdRequest): Promise<StockLevel> {
            const envelope = await transport.requestEnvelope<{
                readonly level: WireStockLevel;
            }>({
                method: 'PATCH',
                path: '/catalogue/inventory/threshold',
                body: {
                    branch_id: String(request.branchId),
                    stock_item_id: String(request.stockItemId),
                    reorder_threshold: request.reorderThreshold,
                    ...(request.parLevel === undefined ? {} : { par_level: request.parLevel }),
                },
            });
            return mapStockLevel(envelope.data.level);
        },

        async countLowStockLevels(): Promise<number> {
            const envelope = await transport.requestEnvelope<{
                readonly count: number;
            }>({ method: 'GET', path: '/catalogue/inventory/low-stock-count' });
            return envelope.data.count;
        },

        async listSuppliers(filter: SupplierFilter = {}): Promise<readonly Supplier[]> {
            const params = new URLSearchParams();
            if (filter.includeArchived === true) params.set('include_archived', 'true');

            const query = params.toString();
            const envelope = await transport.requestEnvelope<{
                readonly suppliers: readonly WireSupplier[];
            }>({
                method: 'GET',
                path: `/catalogue/procurement/suppliers${query === '' ? '' : `?${query}`}`,
            });
            return envelope.data.suppliers.map(mapSupplier);
        },

        async getSupplier(supplierId): Promise<SupplierDetail> {
            const envelope = await transport.requestEnvelope<{
                readonly supplier: WireSupplierDetail;
            }>({
                method: 'GET',
                path: `/catalogue/procurement/suppliers/${encodeURIComponent(String(supplierId))}`,
            });
            return mapSupplierDetail(envelope.data.supplier);
        },

        async createSupplier(request: CreateSupplierRequest): Promise<Supplier> {
            const envelope = await transport.requestEnvelope<{
                readonly supplier: WireSupplier;
            }>({
                method: 'POST',
                path: '/catalogue/procurement/suppliers',
                body: { name_en: request.nameEn, ...wireSupplierFields(request) },
            });
            return mapSupplier(envelope.data.supplier);
        },

        async updateSupplier(supplierId, request: UpdateSupplierRequest): Promise<Supplier> {
            const envelope = await transport.requestEnvelope<{
                readonly supplier: WireSupplier;
            }>({
                method: 'PATCH',
                path: `/catalogue/procurement/suppliers/${encodeURIComponent(String(supplierId))}`,
                body: {
                    ...(request.nameEn === undefined ? {} : { name_en: request.nameEn }),
                    ...wireSupplierFields(request),
                },
            });
            return mapSupplier(envelope.data.supplier);
        },

        async archiveSupplier(supplierId): Promise<Supplier> {
            const envelope = await transport.requestEnvelope<{
                readonly supplier: WireSupplier;
            }>({
                method: 'POST',
                path: `/catalogue/procurement/suppliers/${encodeURIComponent(String(supplierId))}/archive`,
            });
            return mapSupplier(envelope.data.supplier);
        },

        async restoreSupplier(supplierId): Promise<Supplier> {
            const envelope = await transport.requestEnvelope<{
                readonly supplier: WireSupplier;
            }>({
                method: 'POST',
                path: `/catalogue/procurement/suppliers/${encodeURIComponent(String(supplierId))}/restore`,
            });
            return mapSupplier(envelope.data.supplier);
        },

        async replaceSupplierContacts(
            supplierId,
            request: ReplaceSupplierContactsRequest,
        ): Promise<readonly SupplierContact[]> {
            const envelope = await transport.requestEnvelope<{
                readonly contacts: readonly WireSupplierContact[];
            }>({
                method: 'PUT',
                path: `/catalogue/procurement/suppliers/${encodeURIComponent(String(supplierId))}/contacts`,
                body: { contacts: request.contacts.map(wireSupplierContact) },
            });
            return envelope.data.contacts.map(mapSupplierContact);
        },

        async upsertSupplierLink(request: UpsertSupplierLinkRequest): Promise<SupplierLink> {
            const envelope = await transport.requestEnvelope<{
                readonly supplier_link: WireSupplierLink;
            }>({
                method: 'PUT',
                path: '/catalogue/procurement/supplier-links',
                body: {
                    supplier_id: String(request.supplierId),
                    stock_item_id: String(request.stockItemId),
                    // `undefined → omit` is what keeps "leave this alone" distinct from "clear
                    // this": the server keys both fields on presence, not on null.
                    ...(request.isPreferred === undefined
                        ? {}
                        : { is_preferred: request.isPreferred }),
                    ...(request.supplierItemRef === undefined
                        ? {}
                        : { supplier_item_ref: request.supplierItemRef }),
                },
            });
            return mapSupplierLink(envelope.data.supplier_link);
        },

        async deleteSupplierLink(request: DeleteSupplierLinkRequest): Promise<void> {
            // The identifying pair travels in the query string, where every other delete in this
            // API names its subject — a `DELETE` body is the one shape the platform never uses.
            const params = new URLSearchParams({
                supplier_id: String(request.supplierId),
                stock_item_id: String(request.stockItemId),
            });

            await transport.requestVoid({
                method: 'DELETE',
                path: `/catalogue/procurement/supplier-links?${params.toString()}`,
            });
        },

        async listItemLatestPurchases(
            stockItemIds: readonly StockItemId[],
        ): Promise<readonly ItemLatestPurchase[]> {
            if (stockItemIds.length === 0) return [];

            const params = new URLSearchParams();
            for (const stockItemId of stockItemIds) {
                params.append('stock_item_ids[]', String(stockItemId));
            }

            const envelope = await transport.requestEnvelope<{
                readonly purchases: readonly WireItemLatestPurchase[];
            }>({
                method: 'GET',
                path: `/catalogue/procurement/item-purchases/latest?${params.toString()}`,
            });
            return envelope.data.purchases.map(mapItemLatestPurchase);
        },

        async countSupplyNeeds(branchId: BranchId): Promise<SupplyNeedsCount> {
            // The branch travels in the query string rather than the `X-Branch-Id` header every
            // other level read narrows by: this is the branch being *asked about*, and a manager
            // holding an organisation-wide membership has no header branch to ask with.
            const params = new URLSearchParams({ branch_id: String(branchId) });

            const envelope = await transport.requestEnvelope<{
                readonly count: number;
                readonly out_of_stock_count: number;
                readonly low_stock_count: number;
            }>({
                method: 'GET',
                path: `/catalogue/procurement/supply-needs/count?${params.toString()}`,
            });

            return {
                count: envelope.data.count,
                outOfStockCount: envelope.data.out_of_stock_count,
                lowStockCount: envelope.data.low_stock_count,
            };
        },

        async getOrderProposal(
            branchId: BranchId,
            stockItemIds: readonly StockItemId[] = [],
        ): Promise<OrderProposal> {
            const params = new URLSearchParams({ branch_id: String(branchId) });
            for (const stockItemId of stockItemIds) {
                params.append('stock_item_ids[]', String(stockItemId));
            }

            const envelope = await transport.requestEnvelope<{
                readonly items: readonly WireOrderProposalItem[];
            }>({
                method: 'GET',
                path: `/catalogue/procurement/order-proposal?${params.toString()}`,
            });

            const meta = envelope.meta as Partial<{
                readonly branch_id: string;
                readonly out_of_stock_count: number;
                readonly low_stock_count: number;
                readonly unassigned_count: number;
                readonly requested_item_count: number;
            }>;

            return {
                // Never re-sorted. The server's order — out of stock, then low, then requested — is
                // the answer the builder renders, and a client sort would silently rewrite it.
                items: envelope.data.items.map(mapOrderProposalItem),
                branchId,
                outOfStockCount: meta.out_of_stock_count ?? 0,
                lowStockCount: meta.low_stock_count ?? 0,
                unassignedCount: meta.unassigned_count ?? 0,
                requestedItemCount: meta.requested_item_count ?? 0,
            };
        },

        async getProcurementReference(): Promise<ProcurementReference> {
            const envelope = await transport.requestEnvelope<WireProcurementReference>({
                method: 'GET',
                path: '/catalogue/procurement/reference',
            });
            return mapProcurementReference(envelope.data);
        },

        async listGoodsReceipts(): Promise<readonly GoodsReceipt[]> {
            const envelope = await transport.requestEnvelope<{
                readonly goods_receipts: readonly WireGoodsReceipt[];
            }>({ method: 'GET', path: '/catalogue/procurement/goods-receipts' });
            return envelope.data.goods_receipts.map(mapGoodsReceipt);
        },

        async postGoodsReceipt(request: PostGoodsReceiptRequest): Promise<GoodsReceiptResult> {
            const envelope = await transport.requestEnvelope<{
                readonly goods_receipt: { readonly id: string };
            }>({
                method: 'POST',
                path: '/catalogue/procurement/goods-receipts',
                body: {
                    branch_id: String(request.branchId),
                    ...(request.supplierId === undefined
                        ? {}
                        : {
                              supplier_id:
                                  request.supplierId === null ? null : String(request.supplierId),
                          }),
                    ...(request.documentRef === undefined
                        ? {}
                        : { document_ref: request.documentRef }),
                    ...(request.purchaseOrderId === undefined
                        ? {}
                        : { purchase_order_id: request.purchaseOrderId }),
                    lines: request.lines.map((line) => ({
                        stock_item_id: String(line.stockItemId),
                        quantity: line.quantity,
                        ...(line.unitId === undefined || line.unitId === null
                            ? {}
                            : { unit_id: String(line.unitId) }),
                        ...(line.unitPriceAmount === undefined || line.unitPriceAmount === null
                            ? {}
                            : { unit_price_amount: line.unitPriceAmount }),
                        ...(line.costCurrencyCode === undefined || line.costCurrencyCode === null
                            ? {}
                            : { cost_currency_code: line.costCurrencyCode }),
                    })),
                },
            });
            return { id: GoodsReceiptId.unsafe(envelope.data.goods_receipt.id) };
        },

        async listPurchasesLedger(
            filter: PurchaseLedgerFilter = {},
        ): Promise<CursorPage<PurchaseLedgerLine>> {
            const params = new URLSearchParams();
            if (filter.from !== undefined) params.set('from', filter.from);
            if (filter.to !== undefined) params.set('to', filter.to);
            if (filter.supplierId !== undefined)
                params.set('supplier_id', String(filter.supplierId));
            if (filter.ingredientId !== undefined) {
                params.set('ingredient_id', String(filter.ingredientId));
            }
            if (filter.stockItemId !== undefined) {
                params.set('stock_item_id', String(filter.stockItemId));
            }
            if (filter.branchId !== undefined) params.set('branch_id', String(filter.branchId));
            if (filter.cursor !== undefined) params.set('cursor', filter.cursor);
            if (filter.limit !== undefined) params.set('limit', String(filter.limit));

            const query = params.toString();
            const envelope = await transport.requestEnvelope<{
                readonly purchases: readonly WirePurchaseLedgerLine[];
            }>({
                method: 'GET',
                path: `/catalogue/procurement/purchases-ledger${query === '' ? '' : `?${query}`}`,
            });

            // Keyset meta only — `next_cursor`/`has_more`; a keyset never counts
            // its total, so `totalCount` is null, which the contract reserves.
            const meta = (envelope.meta ?? {}) as {
                readonly next_cursor?: string | null;
                readonly has_more?: boolean;
            };

            return {
                items: envelope.data.purchases.map(mapPurchaseLedgerLine),
                nextCursor: meta.next_cursor ?? null,
                hasMore: meta.has_more ?? false,
                totalCount: null,
            };
        },

        async listCostReport(
            filter: MonthlyCostReportFilter = {},
        ): Promise<readonly MonthlyCostReportRow[]> {
            const params = new URLSearchParams();
            if (filter.from !== undefined) params.set('from', filter.from);
            if (filter.to !== undefined) params.set('to', filter.to);

            const query = params.toString();
            const envelope = await transport.requestEnvelope<{
                readonly report: readonly WireMonthlyCostReportRow[];
            }>({
                method: 'GET',
                path: `/catalogue/reports/monthly-cost${query === '' ? '' : `?${query}`}`,
            });

            return envelope.data.report.map(mapMonthlyCostReportRow);
        },

        async listConsumptionExceptions(
            filter: ConsumptionExceptionFilter = {},
        ): Promise<CursorPage<ConsumptionException>> {
            const params = new URLSearchParams();
            if (filter.resolved !== undefined) params.set('resolved', String(filter.resolved));
            if (filter.from !== undefined) params.set('from', filter.from);
            if (filter.to !== undefined) params.set('to', filter.to);
            if (filter.cursor !== undefined) params.set('cursor', filter.cursor);
            if (filter.limit !== undefined) params.set('limit', String(filter.limit));

            const query = params.toString();
            const envelope = await transport.requestEnvelope<{
                readonly exceptions: readonly WireConsumptionException[];
            }>({
                method: 'GET',
                path: `/catalogue/inventory/consumption-exceptions${query === '' ? '' : `?${query}`}`,
            });

            const meta = (envelope.meta ?? {}) as {
                readonly next_cursor?: string | null;
                readonly has_more?: boolean;
            };

            return {
                items: envelope.data.exceptions.map(mapConsumptionException),
                nextCursor: meta.next_cursor ?? null,
                hasMore: meta.has_more ?? false,
                totalCount: null,
            };
        },

        async countUnresolvedConsumptionExceptions(): Promise<number> {
            const envelope = await transport.requestEnvelope<{
                readonly count: number;
            }>({
                method: 'GET',
                path: '/catalogue/inventory/consumption-exceptions/unresolved-count',
            });
            return envelope.data.count;
        },

        async resolveConsumptionException(
            exceptionId: string,
            request: ResolveConsumptionExceptionRequest = {},
        ): Promise<ConsumptionException> {
            const envelope = await transport.requestEnvelope<{
                readonly exception: WireConsumptionException;
            }>({
                method: 'POST',
                path: `/catalogue/inventory/consumption-exceptions/${encodeURIComponent(exceptionId)}/resolve`,
                body: {
                    ...(request.note === undefined ? {} : { note: request.note }),
                },
            });
            return mapConsumptionException(envelope.data.exception);
        },

        async retryConsumptionException(exceptionId: string): Promise<ConsumptionException> {
            const envelope = await transport.requestEnvelope<{
                readonly exception: WireConsumptionException;
            }>({
                method: 'POST',
                path: `/catalogue/inventory/consumption-exceptions/${encodeURIComponent(exceptionId)}/retry`,
            });
            return mapConsumptionException(envelope.data.exception);
        },

        async listProductionOrders(): Promise<readonly ProductionOrder[]> {
            const envelope = await transport.requestEnvelope<{
                readonly production_orders: readonly WireProductionOrder[];
            }>({ method: 'GET', path: '/catalogue/production/orders' });
            return envelope.data.production_orders.map(mapProductionOrder);
        },

        async createProductionOrder(
            request: CreateProductionOrderRequest,
        ): Promise<ProductionOrderResult> {
            const envelope = await transport.requestEnvelope<{
                readonly production_order: { readonly id: string; readonly status: string };
            }>({
                method: 'POST',
                path: '/catalogue/production/orders',
                body: {
                    branch_id: String(request.branchId),
                    recipe_version_id: String(request.recipeVersionId),
                    ...(request.plannedYield === undefined
                        ? {}
                        : { planned_yield: request.plannedYield }),
                },
            });
            return {
                id: ProductionOrderId.unsafe(envelope.data.production_order.id),
                status: envelope.data.production_order.status as ProductionOrderResult['status'],
            };
        },

        async completeProductionOrder(
            productionOrderId,
            request: CompleteProductionOrderRequest,
        ): Promise<ProductionOrderResult> {
            const envelope = await transport.requestEnvelope<{
                readonly production_order: { readonly id: string; readonly status: string };
            }>({
                method: 'POST',
                path: `/catalogue/production/orders/${encodeURIComponent(String(productionOrderId))}/complete`,
                body: {
                    consumes: (request.consumes ?? []).map((line) => ({
                        stock_item_id: String(line.stockItemId),
                        quantity: line.quantity,
                    })),
                    yields: (request.yields ?? []).map((line) => ({
                        stock_item_id: String(line.stockItemId),
                        quantity: line.quantity,
                    })),
                },
            });
            return {
                id: ProductionOrderId.unsafe(envelope.data.production_order.id),
                status: envelope.data.production_order.status as ProductionOrderResult['status'],
            };
        },

        async listQualityChecks(): Promise<readonly QualityCheck[]> {
            const envelope = await transport.requestEnvelope<{
                readonly quality_checks: readonly WireQualityCheck[];
            }>({ method: 'GET', path: '/catalogue/quality-control/checks' });
            return envelope.data.quality_checks.map(mapQualityCheck);
        },

        async createQualityCheck(request: CreateQualityCheckRequest): Promise<QualityCheckResult> {
            const envelope = await transport.requestEnvelope<{
                readonly quality_check: { readonly id: string; readonly status: string };
            }>({
                method: 'POST',
                path: '/catalogue/quality-control/checks',
                body: {
                    subject_type: request.subjectType,
                    subject_id: request.subjectId,
                    ...(request.notes === undefined ? {} : { notes: request.notes }),
                },
            });
            return {
                id: QualityCheckId.unsafe(envelope.data.quality_check.id),
                status: envelope.data.quality_check.status as QualityCheckResult['status'],
            };
        },

        async holdQualityCheck(qualityCheckId): Promise<QualityCheckResult> {
            const envelope = await transport.requestEnvelope<{
                readonly quality_check: { readonly id: string; readonly status: string };
            }>({
                method: 'POST',
                path: `/catalogue/quality-control/checks/${encodeURIComponent(String(qualityCheckId))}/hold`,
            });
            return {
                id: QualityCheckId.unsafe(envelope.data.quality_check.id),
                status: envelope.data.quality_check.status as QualityCheckResult['status'],
            };
        },

        async releaseQualityCheck(qualityCheckId): Promise<QualityCheckResult> {
            const envelope = await transport.requestEnvelope<{
                readonly quality_check: { readonly id: string; readonly status: string };
            }>({
                method: 'POST',
                path: `/catalogue/quality-control/checks/${encodeURIComponent(String(qualityCheckId))}/release`,
            });
            return {
                id: QualityCheckId.unsafe(envelope.data.quality_check.id),
                status: envelope.data.quality_check.status as QualityCheckResult['status'],
            };
        },
    };
}
