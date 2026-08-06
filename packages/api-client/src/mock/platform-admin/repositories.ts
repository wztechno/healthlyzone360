import type { PlatformAdminRepository } from '../../contracts/platform-admin.ts';
import { PlatformAdminMockStore } from './store.ts';

export interface PlatformAdminMockRepositoriesOptions {
    /** Awaited by every method before touching the store. Set to `0` in unit tests. */
    readonly settle: () => Promise<void>;
}

export interface PlatformAdminMockWorld {
    readonly platformAdmin: PlatformAdminRepository;
    /** Exposed for tests, exactly as `prototypeStore` is — screens never see it. */
    readonly store: PlatformAdminMockStore;
}

/**
 * In-memory `PlatformAdminRepository` over {@link PlatformAdminMockStore}.
 *
 * Thin on purpose. The store holds every rule — lock versions, the conflict on suspending a
 * non-active kitchen, the slug clash, the last-owner revocation — so that the mock and the API
 * agree on behaviour and not merely on shape. This layer's only job is the `settle()` await, which
 * is what makes a loading state visible in the mock build.
 */
export function createPlatformAdminMockRepositories(
    options: PlatformAdminMockRepositoriesOptions,
): PlatformAdminMockWorld {
    const { settle } = options;
    const store = new PlatformAdminMockStore();

    const platformAdmin: PlatformAdminRepository = {
        async listKitchens(filter) {
            await settle();
            return store.listKitchens(filter);
        },
        async getKitchen(kitchen) {
            await settle();
            return store.getKitchen(kitchen);
        },
        async createKitchen(request) {
            await settle();
            return store.createKitchen(request);
        },
        async suspendKitchen(kitchen, request) {
            await settle();
            return store.suspendKitchen(kitchen, request);
        },
        async reactivateKitchen(kitchen, request) {
            await settle();
            return store.reactivateKitchen(kitchen, request);
        },
        async inviteOwner(kitchen, request) {
            await settle();
            return store.inviteOwner(kitchen, request);
        },
        async revokeOwner(kitchen, membership) {
            await settle();
            return store.revokeOwner(kitchen, membership);
        },
    };

    return { platformAdmin, store };
}
