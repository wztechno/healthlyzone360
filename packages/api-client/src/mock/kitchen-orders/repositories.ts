import type { KitchenOrdersRepository } from '../../contracts/kitchen-orders.ts';
import { KitchenOrdersMockStore } from './store.ts';

export interface KitchenOrdersMockRepositoriesOptions {
    /** Awaited by every method before touching the store. Set to `0` in unit tests. */
    readonly settle: () => Promise<void>;
}

export interface KitchenOrdersMockWorld {
    readonly kitchenOrders: KitchenOrdersRepository;
    /** Exposed for tests, exactly as `kitchenOpsStore` is — screens never see it. */
    readonly store: KitchenOrdersMockStore;
}

/** In-memory `KitchenOrdersRepository` over {@link KitchenOrdersMockStore}. */
export function createKitchenOrdersMockRepositories(
    options: KitchenOrdersMockRepositoriesOptions,
): KitchenOrdersMockWorld {
    const { settle } = options;
    const store = new KitchenOrdersMockStore();

    const kitchenOrders: KitchenOrdersRepository = {
        async listOrders(filters) {
            await settle();
            return store.list(filters);
        },
        async getOrder(orderId) {
            await settle();
            return store.get(orderId);
        },
        async confirmOrder(request) {
            await settle();
            return store.confirm(request);
        },
        async fulfilOrder(request) {
            await settle();
            return store.fulfil(request);
        },
        async cancelOrder(request) {
            await settle();
            return store.cancel(request);
        },
    };

    return { kitchenOrders, store };
}
