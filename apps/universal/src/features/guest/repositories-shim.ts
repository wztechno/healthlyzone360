import type { CartId, Money, OrderId } from '@healthy360/domain-types';
import { useMemo } from 'react';

import { useRepositoryContext } from '../../data/repository-provider.tsx';
import { createAppGuestTokenStore } from '../../session/guest-storage.ts';

/**
 * ████ TEMPORARY — REMOVED BY THE INTEGRATOR WAVE ████
 *
 * `GuestRepository` landed in G1's groundwork as a **standalone** contract
 * (`packages/api-client/src/contracts/guest.ts`): declared, mocked, and deliberately *not* a member
 * of the required `Repositories` bundle. Adding a required field to that bundle is a change that
 * also has to write the API-side stub, and that pair of edits belongs in one commit owned by one
 * wave. This slice does not own it.
 *
 * This module is the bridge, written to disappear — the same shape and the same reasoning as
 * `features/account/repositories-shim.ts`, which the same wave deletes. Read that file's header for
 * why the resolution is a runtime `typeof` probe rather than a cast, and why nothing here may
 * import `@healthy360/api-client/mock`.
 *
 * ## What is on the bundle and is *not* a contract method
 *
 * Three of the five probed members are bare functions or objects rather than repository methods,
 * and each is deliberate:
 *
 * - **`guestTokenStore`** — the guest credential outlives no single screen. Signing in, converting
 *   to an account and requesting deletion all end the guest identity, and every one of those
 *   happens somewhere that is not the checkout.
 * - **`getGuestChallenge` / `resendGuestChallenge`** — `GuestRepository` deliberately does not grow
 *   a second copy of the OTP surface `VerificationRepository` already publishes, but the panel
 *   needs both and a guest has no `contactPointId` to address the account one with.
 *
 * ## What the integrator wave deletes
 *
 * This file, the extra fields on `MockRepositories`, and the shim import at the top of
 * `src/data/guest-hooks.ts` — which then reads `useRepositories().guest` like every other module.
 */

/* ── the contract, structurally ───────────────────────────────────────────────────────────────── */

export type GuestSessionGrade = 'checkout_draft' | 'place_order';

export type GuestCapability = 'build_basket' | 'price_basket' | 'place_order' | 'request_deletion';

export type OtpChannel = 'email' | 'sms' | 'whatsapp';

export type GuestPaymentMethod = 'cash_on_delivery';

export interface GuestContact {
    readonly id: string;
    readonly email: string | null;
    readonly mobile: string | null;
    readonly maskedDestination: string;
    readonly fullName: string;
    readonly preferredChannel: OtpChannel;
    readonly verified: boolean;
    readonly verifiedAt: string | null;
}

export interface GuestSession {
    readonly id: string;
    /** Plaintext on the answer to `startSession` and nowhere else. */
    readonly token: string | null;
    readonly grade: GuestSessionGrade;
    /** The server's answer to "what may this token do". Never recomputed from `grade`. */
    readonly capabilities: readonly GuestCapability[];
    readonly contactVerified: boolean;
    readonly contact: GuestContact | null;
    readonly expiresAt: string;
    readonly dataExpiresAt: string;
    readonly createdAt: string;
}

export interface OtpChallenge {
    readonly id: string;
    readonly purpose: string;
    readonly channel: OtpChannel;
    readonly maskedDestination: string;
    readonly codeLength: number;
    readonly expiresAt: string;
    readonly resendCooldownSeconds: number;
    readonly attemptsRemaining: number;
    readonly resendsRemaining: number;
    readonly availableChannels: readonly OtpChannel[];
    readonly simulatedChannels: readonly OtpChannel[];
}

export interface GuestContactChallenge {
    readonly contact: GuestContact;
    readonly challenge: OtpChallenge | null;
}

export interface UpdateGuestContactRequest {
    readonly fullName: string;
    readonly email?: string | undefined;
    readonly mobile?: string | undefined;
    readonly preferredChannel?: OtpChannel | undefined;
}

export interface ConfirmGuestContactRequest {
    readonly challengeId: string;
    readonly code: string;
}

export interface DeliveryAddress {
    readonly label: string;
    readonly line1: string;
    readonly line2: string | null;
    readonly area: string;
    readonly city: string;
    readonly countryCode: string;
    readonly instructions: string | null;
}

/**
 * `Money` and the two identifiers come from `@healthy360/domain-types` rather than being restated
 * here, unlike the rest of this file. The brands are the whole point of those types — a currency
 * union that degraded to `string` would let a formatter be handed a currency it cannot format — and
 * `domain-types` is an ordinary dependency of this application, so nothing is being reached past.
 * `features/account/repositories-shim.ts` imports `ServiceAreaId` on exactly these terms.
 */
export interface PriceLine {
    readonly code: string;
    readonly label: string;
    readonly amount: Money;
}

export interface GuestCheckoutDraft {
    readonly cartId: CartId;
    readonly address: DeliveryAddress;
    readonly slotCode: string;
    readonly deliveryDate: string;
    /** One member. There is no shape here a card could be poured into. */
    readonly paymentMethod: GuestPaymentMethod;
    /** Sent explicitly, always. An absent opt-in is an opt-in somebody has to interpret. */
    readonly marketingOptIn: boolean;
    readonly notes?: string | undefined;
}

export type GuestOrderState =
    'placed' | 'confirmed' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled';

export interface GuestOrderLine {
    readonly id: string;
    readonly name: string;
    readonly quantity: number;
    readonly unitPrice: Money;
    readonly lineTotal: Money;
}

export interface GuestOrder {
    readonly id: OrderId;
    readonly reference: string;
    readonly state: GuestOrderState;
    readonly lines: readonly GuestOrderLine[];
    readonly priceLines: readonly PriceLine[];
    readonly total: Money;
    readonly paymentMethod: GuestPaymentMethod;
    readonly address: DeliveryAddress;
    readonly slotCode: string;
    readonly deliveryDate: string;
    readonly contact: GuestContact;
    readonly placedAt: string;
}

export interface GuestConversionPrefill {
    readonly fullName: string;
    readonly email: string | null;
    readonly mobile: string | null;
    readonly contactVerified: boolean;
    readonly orderReferences: readonly string[];
}

export interface ConvertGuestRequest {
    readonly password: string;
    readonly fullName: string;
    readonly marketingOptIn: boolean;
}

export interface GuestConversionResult {
    readonly accountId: string;
    readonly sessionToken: string;
    readonly orderReferences: readonly string[];
    readonly convertedAt: string;
}

export interface RequestGuestDeletionRequest {
    readonly email?: string | undefined;
    readonly mobile?: string | undefined;
}

export interface GuestDeletionAcknowledgement {
    readonly accepted: true;
    readonly destinationMasked: string;
    readonly verificationRequired: boolean;
    readonly expiresInSeconds: number;
    readonly codeLength: number;
}

export interface ConfirmGuestDeletionRequest {
    readonly email?: string | undefined;
    readonly mobile?: string | undefined;
    readonly code: string;
}

export interface GuestDeletionOutcome {
    readonly accepted: true;
    readonly completedAt: string;
    readonly marketingSuppressed: boolean;
}

export interface GuestRepository {
    startSession(request?: { readonly cartId?: CartId | undefined }): Promise<GuestSession>;
    getSession(): Promise<GuestSession>;
    updateContact(request: UpdateGuestContactRequest): Promise<GuestContactChallenge>;
    confirmContact(request: ConfirmGuestContactRequest): Promise<GuestSession>;
    placeOrder(draft: GuestCheckoutDraft): Promise<GuestOrder>;
    getOrder(reference: string): Promise<GuestOrder>;
    getConversionPrefill(): Promise<GuestConversionPrefill>;
    convert(request: ConvertGuestRequest): Promise<GuestConversionResult>;
    requestDeletion(request: RequestGuestDeletionRequest): Promise<GuestDeletionAcknowledgement>;
    confirmDeletion(request: ConfirmGuestDeletionRequest): Promise<GuestDeletionOutcome>;
}

export interface GuestTokenStore {
    get(): string | null;
    set(token: string): void;
    clear(): void;
    subscribe(listener: () => void): () => void;
}

/* ── resolution ───────────────────────────────────────────────────────────────────────────────── */

export interface GuestRepositories {
    readonly guest: GuestRepository;
    readonly tokenStore: GuestTokenStore;
    readonly getChallenge: (challengeId: string) => Promise<OtpChallenge>;
    readonly resendChallenge: (challengeId: string, channel?: OtpChannel) => Promise<OtpChallenge>;
    readonly ready: boolean;
}

/** The shapes the resolved bundle *may* carry. Probed, never asserted. */
interface MaybeRegistered {
    readonly guest?: unknown;
    readonly guestTokenStore?: unknown;
    readonly getGuestChallenge?: unknown;
    readonly resendGuestChallenge?: unknown;
}

function isRepositoryLike(value: unknown): boolean {
    return typeof value === 'object' && value !== null;
}

function unregistered(): never {
    throw new Error(
        'GuestRepository is not registered in the Repositories bundle. Register it in ' +
            'packages/api-client/src/contracts/index.ts, implement it in src/api/, and then delete ' +
            'src/features/guest/repositories-shim.ts.',
    );
}

/** A repository whose every method throws the registration message, so no screen renders a lie. */
function refusing<T extends object>(): T {
    return new Proxy({} as T, { get: unregistered });
}

const REFUSING_GUEST = refusing<GuestRepository>();

/**
 * A token store that exists even when the bundle carries none.
 *
 * Built once at module scope rather than per render, because a store rebuilt on every render would
 * lose every subscriber — and the token is read through `useSyncExternalStore`, so losing the
 * subscribers means the checkout never notices the session it just started.
 *
 * It is the *platform* store (`sessionStorage` on web, the keychain on native), so the fallback is
 * not a weaker thing than the real one; it is the same thing, unattached to a repository.
 */
const FALLBACK_TOKEN_STORE: GuestTokenStore = createAppGuestTokenStore();

export function useGuestRepositories(): GuestRepositories {
    const { repositories } = useRepositoryContext();

    return useMemo<GuestRepositories>(() => {
        // `Repositories` and `MaybeRegistered` have no members in common — which is precisely the
        // fact this file exists for — so the probe reads the object through `unknown`. The `typeof`
        // test below is what makes that safe; nothing is assumed about the shape.
        const bundle = (repositories ?? {}) as unknown as MaybeRegistered;

        if (!isRepositoryLike(bundle.guest)) {
            return {
                guest: REFUSING_GUEST,
                tokenStore: FALLBACK_TOKEN_STORE,
                getChallenge: unregistered,
                resendChallenge: unregistered,
                // `false` whether the bundle is still resolving or will never carry this: either
                // way nothing here may be called, and the queries stay disabled.
                ready: false,
            };
        }

        const store = bundle.guestTokenStore;
        const read = bundle.getGuestChallenge;
        const resend = bundle.resendGuestChallenge;

        return {
            guest: bundle.guest as GuestRepository,
            tokenStore: isRepositoryLike(store) ? (store as GuestTokenStore) : FALLBACK_TOKEN_STORE,
            getChallenge:
                typeof read === 'function'
                    ? (read as (challengeId: string) => Promise<OtpChallenge>)
                    : unregistered,
            resendChallenge:
                typeof resend === 'function'
                    ? (resend as (
                          challengeId: string,
                          channel?: OtpChannel,
                      ) => Promise<OtpChallenge>)
                    : unregistered,
            ready: true,
        };
    }, [repositories]);
}
