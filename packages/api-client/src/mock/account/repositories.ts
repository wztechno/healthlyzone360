import { ServiceAreaId } from '@healthy360/domain-types';

import type {
    AccountOverview,
    AccountRepository,
    AccountServiceArea,
    AccountSetupChecklist,
    ClosurePreconditions,
    ClosureTicket,
    ConsentState,
    CustomerAddress,
    DietaryProfile,
    RequestClosureRequest,
    SaveAddressRequest,
    SaveDietaryProfileRequest,
    SetConsentRequest,
    VerifyClosureRequest,
} from '../../contracts/account.ts';
import type {
    AddContactPointRequest,
    ContactPoint,
    ContactPointAdded,
    IssueOtpRequest,
    OtpChallenge,
    OtpVerificationResult,
    ResendOtpRequest,
    VerificationRepository,
    VerifyOtpRequest,
} from '../../contracts/verification.ts';
import { AccountMockStore } from './store.ts';
import type { AccountMockStoreOptions } from './store.ts';

/**
 * The J1 mock repositories.
 *
 * Deliberately **not** members of the `MockRepositories` bundle yet. `VerificationRepository` and
 * `AccountRepository` are not in `contracts/index.ts`'s required bundle either, and adding a field
 * to a bundle both implementations must satisfy is a change that belongs in the slice that also
 * writes the API-side stub. Until then these are standalone factories, which is enough for the mock
 * world's own tests and for a screen that is handed them directly.
 */
export interface AccountMockRepositories {
    readonly kind: 'mock-account';
    readonly verification: VerificationRepository;
    readonly account: AccountRepository;
    /** The mutable world, so a test can assert what a write did without a second round trip. */
    readonly store: AccountMockStore;
}

export interface AccountMockRepositoriesOptions extends AccountMockStoreOptions {
    /** Simulated round trip. Set to `0` in unit tests. */
    readonly latencyMs?: number | undefined;
    /** Reuse an existing world instead of building a fresh one. */
    readonly store?: AccountMockStore | undefined;
}

function sleep(ms: number): Promise<void> {
    return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

export const DEFAULT_ACCOUNT_MOCK_LATENCY_MS = 200;

export function createAccountMockRepositories(
    options: AccountMockRepositoriesOptions = {},
): AccountMockRepositories {
    const store =
        options.store ??
        new AccountMockStore({
            ...(options.now === undefined ? {} : { now: options.now }),
            ...(options.simulateChannels === undefined
                ? {}
                : { simulateChannels: options.simulateChannels }),
            ...(options.closureWorld === undefined ? {} : { closureWorld: options.closureWorld }),
            ...(options.onAccountClosed === undefined
                ? {}
                : { onAccountClosed: options.onAccountClosed }),
        });
    const latency = options.latencyMs ?? DEFAULT_ACCOUNT_MOCK_LATENCY_MS;
    const settle = () => sleep(latency);

    const verification: VerificationRepository = {
        async listContactPoints(): Promise<readonly ContactPoint[]> {
            await settle();
            return store.listContacts();
        },

        async addContactPoint(request: AddContactPointRequest): Promise<ContactPointAdded> {
            await settle();
            return store.addContact(request);
        },

        async removeContactPoint(request: { readonly contactPointId: string }): Promise<void> {
            await settle();
            store.removeContact(request.contactPointId);
        },

        async setPrimaryContactPoint(request: {
            readonly contactPointId: string;
        }): Promise<ContactPoint> {
            await settle();
            return store.setPrimaryContact(request.contactPointId);
        },

        async issueChallenge(request: IssueOtpRequest): Promise<OtpChallenge> {
            await settle();
            return store.issueChallenge(request);
        },

        async getChallenge(request: { readonly challengeId: string }): Promise<OtpChallenge> {
            await settle();
            return store.getChallenge(request.challengeId);
        },

        async resendChallenge(request: ResendOtpRequest): Promise<OtpChallenge> {
            await settle();
            return store.resendChallenge(request);
        },

        async verifyChallenge(request: VerifyOtpRequest): Promise<OtpVerificationResult> {
            await settle();
            return store.verifyChallenge(request);
        },
    };

    const account: AccountRepository = {
        async getOverview(): Promise<AccountOverview> {
            await settle();
            return {
                account: store.account,
                contacts: store.listContacts(),
                checklist: store.checklist(),
            };
        },

        async getChecklist(): Promise<AccountSetupChecklist> {
            await settle();
            return store.checklist();
        },

        async listServiceAreas(): Promise<readonly AccountServiceArea[]> {
            await settle();
            return store
                .serviceAreas()
                .map((area) => ({ id: ServiceAreaId.unsafe(area.id), name: area.name }));
        },

        async listAddresses(): Promise<readonly CustomerAddress[]> {
            await settle();
            return store.listAddresses();
        },

        async addAddress(request: SaveAddressRequest): Promise<CustomerAddress> {
            await settle();
            return store.addAddress(request);
        },

        async updateAddress(
            request: SaveAddressRequest & { readonly addressId: string },
        ): Promise<CustomerAddress> {
            await settle();
            return store.updateAddress(request.addressId, request);
        },

        async removeAddress(request: { readonly addressId: string }): Promise<void> {
            await settle();
            store.removeAddress(request.addressId);
        },

        async getDietaryProfile(): Promise<DietaryProfile> {
            await settle();
            return store.dietaryProfile();
        },

        async saveDietaryProfile(request: SaveDietaryProfileRequest): Promise<DietaryProfile> {
            await settle();
            return store.saveDietaryProfile(request);
        },

        async listConsents(): Promise<readonly ConsentState[]> {
            await settle();
            return store.listConsents();
        },

        async setConsent(request: SetConsentRequest): Promise<ConsentState> {
            await settle();
            return store.setConsent(request);
        },

        async getClosurePreconditions(): Promise<ClosurePreconditions> {
            await settle();
            return store.closurePreconditions();
        },

        async getLiveClosureRequest(): Promise<ClosureTicket | null> {
            await settle();
            return store.liveClosureRequest();
        },

        async requestClosure(request: RequestClosureRequest): Promise<ClosureTicket> {
            await settle();
            return store.requestClosure(request);
        },

        async verifyClosure(request: VerifyClosureRequest): Promise<ClosureTicket> {
            await settle();
            return store.verifyClosure(request);
        },

        async cancelClosure(request: { readonly ticketId: string }): Promise<ClosureTicket> {
            await settle();
            return store.cancelClosure(request.ticketId);
        },
    };

    return { kind: 'mock-account', verification, account, store };
}
