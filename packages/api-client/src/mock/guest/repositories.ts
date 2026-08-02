import type {
    ConfirmGuestContactRequest,
    ConfirmGuestDeletionRequest,
    ConvertGuestRequest,
    GuestCheckoutDraft,
    GuestContactChallenge,
    GuestConversionPrefill,
    GuestConversionResult,
    GuestDeletionAcknowledgement,
    GuestDeletionOutcome,
    GuestOrder,
    GuestRepository,
    GuestSession,
    RequestGuestDeletionRequest,
    StartGuestSessionRequest,
    UpdateGuestContactRequest,
} from '../../contracts/guest.ts';
import type { OtpChallenge, OtpChannel } from '../../contracts/verification.ts';
import type { GuestTokenStore } from '../../session/guest-token-store.ts';
import { GuestMockStore } from './store.ts';
import type { GuestMockStoreOptions } from './store.ts';

/**
 * The G1 mock guest repository.
 *
 * Deliberately **not** a member of the `MockRepositories` bundle's required shape, on exactly the
 * terms `../account/repositories.ts` records: `GuestRepository` is not in `contracts/index.ts`'s
 * required bundle either, and registering it is the same commit that writes the API-side stub.
 * Until then this is a standalone factory, which is enough for the world's own tests and for a
 * screen that is handed it through the application's shim.
 *
 * ## Resend and re-read are on the bundle, not on the contract
 *
 * `GuestRepository` has no `resendChallenge` or `getChallenge`: the guest journey's passcode is a
 * *step inside* verifying a contact, and the contract deliberately does not grow a second copy of
 * the OTP surface that `VerificationRepository` already publishes. But the panel needs both, and a
 * guest has no `contactPointId` to address `VerificationRepository` with — so the two live here, on
 * the returned bundle, named for what they are and impossible to mistake for contract methods.
 */
export interface GuestMockRepositories {
    readonly kind: 'mock-guest';
    readonly guest: GuestRepository;
    /** The mutable world, so a test can assert what a write did without a second round trip. */
    readonly store: GuestMockStore;
    /** The token store the world writes to, so a caller can clear it on sign-in. */
    readonly tokenStore: GuestTokenStore;
    /** Re-read a live challenge after a reload, with its cooldown intact. */
    readonly getGuestChallenge: (challengeId: string) => Promise<OtpChallenge>;
    /** Resend — and supersede, exactly as the account world's resend does. */
    readonly resendGuestChallenge: (
        challengeId: string,
        channel?: OtpChannel,
    ) => Promise<OtpChallenge>;
}

export interface GuestMockRepositoriesOptions extends GuestMockStoreOptions {
    /** Simulated round trip. Set to `0` in unit tests. */
    readonly latencyMs?: number | undefined;
    /** Reuse an existing world instead of building a fresh one. */
    readonly store?: GuestMockStore | undefined;
}

function sleep(ms: number): Promise<void> {
    return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

export const DEFAULT_GUEST_MOCK_LATENCY_MS = 200;

export function createGuestMockRepositories(
    options: GuestMockRepositoriesOptions = {},
): GuestMockRepositories {
    const store =
        options.store ??
        new GuestMockStore({
            ...(options.now === undefined ? {} : { now: options.now }),
            ...(options.tokenStore === undefined ? {} : { tokenStore: options.tokenStore }),
            ...(options.cart === undefined ? {} : { cart: options.cart }),
            ...(options.simulateChannels === undefined
                ? {}
                : { simulateChannels: options.simulateChannels }),
        });
    const latency = options.latencyMs ?? DEFAULT_GUEST_MOCK_LATENCY_MS;
    const settle = () => sleep(latency);

    const guest: GuestRepository = {
        async startSession(request?: StartGuestSessionRequest): Promise<GuestSession> {
            await settle();
            return store.startSession(request);
        },

        async getSession(): Promise<GuestSession> {
            await settle();
            return store.getSession();
        },

        async updateContact(request: UpdateGuestContactRequest): Promise<GuestContactChallenge> {
            await settle();
            return store.updateContact(request);
        },

        async confirmContact(request: ConfirmGuestContactRequest): Promise<GuestSession> {
            await settle();
            return store.confirmContact(request);
        },

        async placeOrder(draft: GuestCheckoutDraft): Promise<GuestOrder> {
            await settle();
            return store.placeOrder(draft);
        },

        async getOrder(reference: string): Promise<GuestOrder> {
            await settle();
            return store.getOrder(reference);
        },

        async getConversionPrefill(): Promise<GuestConversionPrefill> {
            await settle();
            return store.conversionPrefill();
        },

        async convert(request: ConvertGuestRequest): Promise<GuestConversionResult> {
            await settle();
            return store.convert(request);
        },

        async requestDeletion(
            request: RequestGuestDeletionRequest,
        ): Promise<GuestDeletionAcknowledgement> {
            await settle();
            return store.requestDeletion(request);
        },

        async confirmDeletion(request: ConfirmGuestDeletionRequest): Promise<GuestDeletionOutcome> {
            await settle();
            return store.confirmDeletion(request);
        },
    };

    return {
        kind: 'mock-guest',
        guest,
        store,
        tokenStore: store.tokenStore,
        getGuestChallenge: async (challengeId: string) => {
            await settle();
            return store.getChallenge(challengeId);
        },
        resendGuestChallenge: async (challengeId: string, channel?: OtpChannel) => {
            await settle();
            return store.resendChallenge(challengeId, channel);
        },
    };
}
