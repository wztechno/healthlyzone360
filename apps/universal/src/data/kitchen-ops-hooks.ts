import type {
    CompleteProductionOrderRequest,
    ConsumptionException,
    ConsumptionExceptionFilter,
    CreateProductionOrderRequest,
    CreateQualityCheckRequest,
    CreateSupplierRequest,
    GoodsReceipt,
    GoodsReceiptResult,
    MonthlyCostReportFilter,
    MonthlyCostReportRow,
    PostGoodsReceiptRequest,
    ProcurementReference,
    ProductionOrder,
    ProductionOrderResult,
    PurchaseLedgerFilter,
    PurchaseLedgerLine,
    QualityCheck,
    QualityCheckResult,
    ReplaceSupplierContactsRequest,
    ResolveConsumptionExceptionRequest,
    SetStockThresholdRequest,
    StockAdjustmentRequest,
    StockItem,
    StockLevel,
    StockMovement,
    StockWasteRequest,
    Supplier,
    SupplierContact,
    SupplierDetail,
    SupplierFilter,
    UpdateSupplierRequest,
} from '@healthy360/api-client/contracts';
import type { CursorPage } from '@healthy360/api-client/contracts';
import type { ProductionOrderId, QualityCheckId, SupplierId } from '@healthy360/domain-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The kitchen ops workspace's data access (O1–O4).
 *
 * One hook per repository operation, same as `./kitchen-admin-hooks.ts` — but simpler throughout,
 * for the reason `contracts/kitchen-ops.ts`'s header gives: nothing here is lock-versioned and
 * every list is either the whole table or the most recent fifty, so there is no lock version to
 * rebase after a write. `useSupplierQuery` is the one per-row detail read — a supplier has a page
 * of its own, which no other ops row does (SUP1).
 *
 * ## Every mutation invalidates the whole root, and nothing writes a detail entry
 *
 * `useIngredientWriteEffects` and its siblings in `kitchen-admin-hooks.ts` write the record they
 * just got back into its own cache entry *and* invalidate the root, because a detail screen reads
 * that entry directly. No screen here does: a mutation form re-reads the list it just changed, so
 * the only cache action a write needs is to make the next read of `queryKeys.kitchenOps.all()`
 * fetch again. That is also the honest answer to the wire's own shape — posting a goods receipt or
 * completing a production order answers an id and a status, not the row, so there is nothing to
 * seed a detail cache with even if one existed.
 *
 * ## `enabled` defaults to `true` here, unlike the summary hooks above
 *
 * The ops screens have no hub card that reads a count before the workspace is open, so there is no
 * caller that needs to hold a query back the way `useIngredientSummaryQuery(enabled)` does. The
 * parameter exists anyway, for the one caller that legitimately needs it: a query gated on a
 * permission the screen has not confirmed yet.
 */

export { toFailure } from './hooks.ts';

/* ── inventory (O1) ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every shelf the organisation holds, in the order the server ranked them — stocked first, then
 * ever-moved, then by name (INV2.0). Not paginated. **Never re-sort this list for a picker**: the
 * ranking is what keeps a two-hundred-row ingredient library usable.
 */
export function useStockItemsQuery(enabled = true): UseQueryResult<readonly StockItem[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.stockItems(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOps.listStockItems();
        },
    });
}

/** Every level the active branch context can see (`X-Branch-Id`, set by `ContextRepository`). */
export function useStockLevelsQuery(enabled = true): UseQueryResult<readonly StockLevel[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.stockLevels(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOps.listStockLevels();
        },
    });
}

/**
 * How many levels are low right now (INV1.3), for the hub badge — scoped to the active branch
 * context by the backend, or org-wide when none is set. A dedicated count read so the hub never has
 * to fetch the whole levels list to show one number, matching the other summary queries the hub
 * fires. `enabled` gates it on the permission the hub confirms before firing, like its siblings.
 */
export function useLowStockCountQuery(enabled = true): UseQueryResult<number> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.lowStockCount(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOps.countLowStockLevels();
        },
    });
}

/** Invalidates every ops list. The one cache action every write in this workspace needs. */
function useKitchenOpsWriteEffects(): () => void {
    const queryClient = useQueryClient();
    return () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenOps.all() });
    };
}

/*
 * No stock-item writer (INV2.0). A shelf is derived from an ingredient or from a
 * product the kitchen buys in to resell, so it appears when one of those does.
 */

/** A signed correction to one item's level at one branch. Creates the level row if none exists. */
export function useRecordStockAdjustmentMutation(): UseMutationResult<
    StockMovement,
    unknown,
    StockAdjustmentRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: (request: StockAdjustmentRequest) =>
            repositories.kitchenOps.recordStockAdjustment(request),
        onSuccess: onWritten,
    });
}

/** A positive quantity lost to waste; the server signs it negative on the ledger. */
export function useRecordStockWasteMutation(): UseMutationResult<
    StockMovement,
    unknown,
    StockWasteRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: (request: StockWasteRequest) =>
            repositories.kitchenOps.recordStockWaste(request),
        onSuccess: onWritten,
    });
}

/** Sets or clears a level's reorder threshold, then re-reads the ops lists (levels and the count). */
export function useSetStockThresholdMutation(): UseMutationResult<
    StockLevel,
    unknown,
    SetStockThresholdRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: (request: SetStockThresholdRequest) =>
            repositories.kitchenOps.setStockThreshold(request),
        onSuccess: onWritten,
    });
}

/* ── procurement (O2) — receipts-only ────────────────────────────────────────────────────────── */

/**
 * The supplier book, ordered by code.
 *
 * Archived suppliers are excluded unless `filter.includeArchived` asks for them: every other caller
 * is a picker, and a picker offering a supplier the kitchen stopped buying from is how an order gets
 * sent to a shuttered warehouse. The filter is part of the key, so the plain book and the book with
 * its archive are two cache entries rather than one that keeps flipping.
 */
export function useSuppliersQuery(
    filter: SupplierFilter = {},
    enabled = true,
): UseQueryResult<readonly Supplier[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.suppliers(filter),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOps.listSuppliers(filter);
        },
    });
}

/**
 * One supplier and its named contacts — the supplier's own page.
 *
 * Disabled until the route parameter parses as an identifier, so a hand-typed link produces the
 * screen's designed not-found state rather than a repository failure.
 */
export function useSupplierQuery(
    supplierId: SupplierId | null,
    enabled = true,
): UseQueryResult<SupplierDetail> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.supplier(supplierId ?? ('' as SupplierId)),
        enabled: enabled && supplierId !== null && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (supplierId === null) throw new Error('A supplier identifier is required.');
            return repositories.kitchenOps.getSupplier(supplierId);
        },
    });
}

/**
 * The goods-receipt form's reference data (INV1.1) — the currencies a price can be booked in, the
 * organisation's default currency, and the measurement units a line can be quoted in. Behind
 * `inventory.view_organisation`, the same code as the rest of the ops read surface.
 */
export function useProcurementReferenceQuery(enabled = true): UseQueryResult<ProcurementReference> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.procurementReference(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOps.getProcurementReference();
        },
    });
}

/** Adds a supplier to the book, then re-reads the ops lists so the new row appears and can be picked. */
export function useCreateSupplierMutation(): UseMutationResult<
    Supplier,
    unknown,
    CreateSupplierRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: (request: CreateSupplierRequest) =>
            repositories.kitchenOps.createSupplier(request),
        onSuccess: onWritten,
    });
}

export interface UpdateSupplierVariables {
    readonly supplierId: SupplierId;
    readonly request: UpdateSupplierRequest;
}

/** Edits the record, then re-reads the ops lists — the detail entry among them. */
export function useUpdateSupplierMutation(): UseMutationResult<
    Supplier,
    unknown,
    UpdateSupplierVariables
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: ({ supplierId, request }: UpdateSupplierVariables) =>
            repositories.kitchenOps.updateSupplier(supplierId, request),
        onSuccess: onWritten,
    });
}

/** Takes a supplier out of every picker. Reversible — see `useRestoreSupplierMutation`. */
export function useArchiveSupplierMutation(): UseMutationResult<Supplier, unknown, SupplierId> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: (supplierId: SupplierId) => repositories.kitchenOps.archiveSupplier(supplierId),
        onSuccess: onWritten,
    });
}

/** Puts an archived supplier back in the book. */
export function useRestoreSupplierMutation(): UseMutationResult<Supplier, unknown, SupplierId> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: (supplierId: SupplierId) => repositories.kitchenOps.restoreSupplier(supplierId),
        onSuccess: onWritten,
    });
}

export interface ReplaceSupplierContactsVariables {
    readonly supplierId: SupplierId;
    readonly request: ReplaceSupplierContactsRequest;
}

/**
 * Replaces the whole contact set in one call — the screen's single **Save contacts** action.
 *
 * Deliberately not fired per card: a set-replace on a keystroke would delete the card the person
 * was halfway through adding.
 */
export function useReplaceSupplierContactsMutation(): UseMutationResult<
    readonly SupplierContact[],
    unknown,
    ReplaceSupplierContactsVariables
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: ({ supplierId, request }: ReplaceSupplierContactsVariables) =>
            repositories.kitchenOps.replaceSupplierContacts(supplierId, request),
        onSuccess: onWritten,
    });
}

/** The most recent fifty goods receipts, newest first. */
export function useGoodsReceiptsQuery(enabled = true): UseQueryResult<readonly GoodsReceipt[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.goodsReceipts(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOps.listGoodsReceipts();
        },
    });
}

/** Posts every line straight into the inventory ledger. There is no draft to save and return to. */
export function usePostGoodsReceiptMutation(): UseMutationResult<
    GoodsReceiptResult,
    unknown,
    PostGoodsReceiptRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: (request: PostGoodsReceiptRequest) =>
            repositories.kitchenOps.postGoodsReceipt(request),
        onSuccess: onWritten,
    });
}

/**
 * The purchases ledger (INV1.1) — every receipt line, filtered and cursor-paginated. Behind
 * `inventory.view_costs_organisation` on the server, so a caller without that code gets a failure
 * rather than a page; the screen gates its card on the same permission.
 */
export function usePurchasesLedgerQuery(
    filter: PurchaseLedgerFilter = {},
    enabled = true,
): UseQueryResult<CursorPage<PurchaseLedgerLine>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.purchasesLedger(filter),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOps.listPurchasesLedger(filter);
        },
    });
}

/**
 * The monthly cost report (INV1.4) — spend, COGS, waste, revenue and margin per month and currency.
 * Behind `inventory.view_costs_organisation` on the server, so a caller without that code gets a
 * failure rather than the kitchen's economics; the screen gates its card on the same permission.
 */
export function useCostReportQuery(
    filter: MonthlyCostReportFilter = {},
    enabled = true,
): UseQueryResult<readonly MonthlyCostReportRow[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.costReport(filter),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOps.listCostReport(filter);
        },
    });
}

/* ── consumption exceptions (INV1.5) ─────────────────────────────────────────────────────────── */

/**
 * The consumption-exception review list (INV1.5) — what confirmed orders could not deduct honestly,
 * filtered by resolution state and date, cursor-paginated. Behind `inventory.view_organisation` on
 * the server; the screen gates its card on the same code.
 */
export function useConsumptionExceptionsQuery(
    filter: ConsumptionExceptionFilter = {},
    enabled = true,
): UseQueryResult<CursorPage<ConsumptionException>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.consumptionExceptions(filter),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOps.listConsumptionExceptions(filter);
        },
    });
}

/**
 * How many consumption exceptions are unresolved right now (INV1.5), for the hub badge and the
 * review KPI — scoped to the active branch context by the backend, or org-wide when none is set. A
 * dedicated count read so the hub never fetches the whole list to show one number, matching the
 * low-stock count beside it. `enabled` gates it on the permission the hub confirms before firing.
 */
export function useConsumptionExceptionCountQuery(enabled = true): UseQueryResult<number> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.consumptionExceptionCount(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOps.countUnresolvedConsumptionExceptions();
        },
    });
}

export interface ResolveConsumptionExceptionVariables {
    readonly exceptionId: string;
    readonly request?: ResolveConsumptionExceptionRequest | undefined;
}

/** Marks one exception handled, then re-reads the ops lists (the list and the count). */
export function useResolveConsumptionExceptionMutation(): UseMutationResult<
    ConsumptionException,
    unknown,
    ResolveConsumptionExceptionVariables
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: ({ exceptionId, request }: ResolveConsumptionExceptionVariables) =>
            repositories.kitchenOps.resolveConsumptionException(exceptionId, request),
        onSuccess: onWritten,
    });
}

/** Retries a blocked consumption, then re-reads the ops lists. */
export function useRetryConsumptionExceptionMutation(): UseMutationResult<
    ConsumptionException,
    unknown,
    string
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: (exceptionId: string) =>
            repositories.kitchenOps.retryConsumptionException(exceptionId),
        onSuccess: onWritten,
    });
}

/* ── production (O5) — no task UI ────────────────────────────────────────────────────────────── */

/** The most recent fifty production orders, newest first. */
export function useProductionOrdersQuery(
    enabled = true,
): UseQueryResult<readonly ProductionOrder[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.productionOrders(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOps.listProductionOrders();
        },
    });
}

export function useCreateProductionOrderMutation(): UseMutationResult<
    ProductionOrderResult,
    unknown,
    CreateProductionOrderRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: (request: CreateProductionOrderRequest) =>
            repositories.kitchenOps.createProductionOrder(request),
        onSuccess: onWritten,
    });
}

export interface CompleteProductionOrderVariables {
    readonly productionOrderId: ProductionOrderId;
    readonly request: CompleteProductionOrderRequest;
}

/** States what an order consumed and yielded. Not a checklist — see the module note. */
export function useCompleteProductionOrderMutation(): UseMutationResult<
    ProductionOrderResult,
    unknown,
    CompleteProductionOrderVariables
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: ({ productionOrderId, request }: CompleteProductionOrderVariables) =>
            repositories.kitchenOps.completeProductionOrder(productionOrderId, request),
        onSuccess: onWritten,
    });
}

/* ── quality control (O4) — hold/release only ────────────────────────────────────────────────── */

/** The most recent fifty checks, newest first, over both allow-listed subjects. */
export function useQualityChecksQuery(enabled = true): UseQueryResult<readonly QualityCheck[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOps.qualityChecks(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOps.listQualityChecks();
        },
    });
}

export function useCreateQualityCheckMutation(): UseMutationResult<
    QualityCheckResult,
    unknown,
    CreateQualityCheckRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: (request: CreateQualityCheckRequest) =>
            repositories.kitchenOps.createQualityCheck(request),
        onSuccess: onWritten,
    });
}

/**
 * Holds and releases are the entire lifecycle beyond opening a check (see the contract header), so
 * both take nothing but the identifier — there is no hold record distinct from the check's own
 * status for a request body to carry.
 */
export function useHoldQualityCheckMutation(): UseMutationResult<
    QualityCheckResult,
    unknown,
    QualityCheckId
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: (qualityCheckId: QualityCheckId) =>
            repositories.kitchenOps.holdQualityCheck(qualityCheckId),
        onSuccess: onWritten,
    });
}

export function useReleaseQualityCheckMutation(): UseMutationResult<
    QualityCheckResult,
    unknown,
    QualityCheckId
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOpsWriteEffects();

    return useMutation({
        mutationFn: (qualityCheckId: QualityCheckId) =>
            repositories.kitchenOps.releaseQualityCheck(qualityCheckId),
        onSuccess: onWritten,
    });
}
