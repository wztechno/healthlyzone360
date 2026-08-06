import type { KitchenOpsRepository } from '../../contracts/kitchen-ops.ts';
import { KitchenOpsMockStore } from './store.ts';

export interface KitchenOpsMockRepositoriesOptions {
    /** Awaited by every method before touching the store. Set to `0` in unit tests. */
    readonly settle: () => Promise<void>;
}

export interface KitchenOpsMockWorld {
    readonly kitchenOps: KitchenOpsRepository;
    /** Exposed for tests, exactly as `prototypeStore` is — screens never see it. */
    readonly store: KitchenOpsMockStore;
}

/** In-memory `KitchenOpsRepository` over {@link KitchenOpsMockStore}. */
export function createKitchenOpsMockRepositories(
    options: KitchenOpsMockRepositoriesOptions,
): KitchenOpsMockWorld {
    const { settle } = options;
    const store = new KitchenOpsMockStore();

    const kitchenOps: KitchenOpsRepository = {
        async listStockItems() {
            await settle();
            return store.stockItems();
        },
        async createStockItem(request) {
            await settle();
            return store.createStockItem(request);
        },
        async listStockLevels() {
            await settle();
            return store.stockLevels();
        },
        async recordStockAdjustment(request) {
            await settle();
            return store.recordAdjustment(request);
        },
        async recordStockWaste(request) {
            await settle();
            return store.recordWaste(request);
        },
        async listSuppliers() {
            await settle();
            return store.suppliers();
        },
        async listGoodsReceipts() {
            await settle();
            return store.goodsReceipts();
        },
        async postGoodsReceipt(request) {
            await settle();
            return store.postGoodsReceipt(request);
        },
        async listProductionOrders() {
            await settle();
            return store.productionOrders();
        },
        async createProductionOrder(request) {
            await settle();
            return store.createProductionOrder(request);
        },
        async completeProductionOrder(productionOrderId, request) {
            await settle();
            return store.completeProductionOrder(productionOrderId, request);
        },
        async listQualityChecks() {
            await settle();
            return store.qualityChecks();
        },
        async createQualityCheck(request) {
            await settle();
            return store.createQualityCheck(request);
        },
        async holdQualityCheck(qualityCheckId) {
            await settle();
            return store.holdQualityCheck(qualityCheckId);
        },
        async releaseQualityCheck(qualityCheckId) {
            await settle();
            return store.releaseQualityCheck(qualityCheckId);
        },
    };

    return { kitchenOps, store };
}
