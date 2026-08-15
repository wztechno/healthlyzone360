import { OrderId, isCurrencyCode } from '@healthy360/domain-types';
import type { CartId, Money } from '@healthy360/domain-types';

import type { DeliveryAddress, PriceLine } from '../contracts/commerce.ts';
import { ApiError, apiFailure, validationFailure } from '../contracts/failure.ts';
import type {
    ConfirmGuestContactRequest,
    ConfirmGuestDeletionRequest,
    ConvertGuestRequest,
    GuestCapability,
    GuestCheckoutDraft,
    GuestContact,
    GuestContactChallenge,
    GuestConversionPrefill,
    GuestConversionResult,
    GuestDeletionAcknowledgement,
    GuestDeletionOutcome,
    GuestOrder,
    GuestOrderLine,
    GuestOrderState,
    GuestRepository,
    GuestSession,
    RequestGuestDeletionRequest,
    StartGuestSessionRequest,
    UpdateGuestContactRequest,
} from '../contracts/guest.ts';
import type { OtpChallenge, OtpChannel } from '../contracts/verification.ts';
import type {
    GuestCustomerAccount as WireGuestAccount,
    GuestOrder as WireGuestOrder,
    GuestOrderLine as WireGuestOrderLine,
    GuestOtpChallenge as WireGuestChallenge,
    GuestSession as WireGuestSession,
    StartedGuestSession as WireStartedSession,
} from '../generated/types.ts';
import { generateRequestId } from './config.ts';
import { PASSCODE_LENGTH } from './verification-repository.ts';
import type { Transport } from './transport.ts';

/**
 * Ordering without an account, and erasure without one, over HTTP (plan Phase G1).
 *
 * The nine endpoints line up with the contract one for one. What does not line up is the *shape* of
 * a session, and the difference is worth reading before the code, because four contract members
 * have no wire counterpart and each is handled differently.
 *
 * ## `capabilities` is derived, and the contract said it would not be
 *
 * `GuestSession.capabilities` exists so a screen can ask "may I place an order" rather than reason
 * about the grade — and the contract says it is never recomputed from `grade` on the device. The
 * wire sends only the grade. So it *is* recomputed here, in one place, by {@link capabilitiesFor},
 * and that is a real deviation rather than a mapping detail: until the endpoint publishes the list,
 * the day the server refuses for a reason the grade does not express is the day this client offers
 * a button that will be refused. The contract's shape is kept so that publishing the list later is
 * a change to this function and nothing else.
 *
 * ## `contact` is remembered, not read
 *
 * No session payload carries the contact. The repository remembers what `updateContact` was given
 * together with the mask the server authored for the challenge, which is exactly the pair a
 * checkout renders ("we will text 05••••1234"). After a reload the memo is empty and `contact` is
 * `null` while `contactVerified` still comes from the server — so a returning person is correctly
 * told they are verified, without the client inventing the address that proved it.
 *
 * ## `id` costs a second request
 *
 * `POST /guest/sessions` answers a token, a grade and two expiries — and no session identifier.
 * `startSession` therefore stores the token and immediately re-reads `GET /guest/session`, which is
 * the only payload that carries one. Two round trips for one honest object, on a call that happens
 * once per basket.
 *
 * ## An order is fetched by identifier, quoted by number
 *
 * `GET /guest/orders/{order}` resolves a UUID. `GuestOrder.reference` is the human-quotable
 * `order_number`, which is what a confirmation route carries. {@link orderIds} bridges the two for
 * the length of the session; after a reload a bare order *number* cannot be resolved, and the
 * confirmation page says the order could not be found rather than pretending otherwise. A
 * `GET /guest/orders/by-number/{number}` would close it.
 */

/**
 * What a grade allows, named for the action.
 *
 * `request_deletion` is on both grades because erasure is a right, not a privilege: the public
 * deletion endpoints do not even read a token.
 */
function capabilitiesFor(grade: WireGuestSession['grade']): readonly GuestCapability[] {
    return grade === 'place_order'
        ? ['build_basket', 'price_basket', 'place_order', 'request_deletion']
        : ['build_basket', 'price_basket', 'request_deletion'];
}

function money(amountMinor: number, currency: string): Money {
    if (!isCurrencyCode(currency)) {
        // A guest order priced in a currency this build cannot format is one whose total must not
        // reach a confirmation screen. `server` rather than a retry: asking again cannot change it.
        throw new ApiError(
            apiFailure('server', {
                message:
                    'This order is priced in a currency this version of the app cannot display. ' +
                    'Updating the app will fix it.',
                retryable: false,
            }),
        );
    }
    return { amount: amountMinor, currency };
}

export function mapGuestChallenge(wire: WireGuestChallenge): OtpChallenge {
    const available = wire.available_channels;
    return {
        id: wire.challenge_id,
        purpose: wire.purpose,
        channel: wire.channel,
        maskedDestination: wire.destination_masked,
        codeLength: PASSCODE_LENGTH,
        expiresAt: wire.expires_at,
        resendCooldownSeconds: wire.resend_cooldown_seconds,
        attemptsRemaining: wire.attempts_remaining,
        resendsRemaining: wire.resends_remaining,
        availableChannels: available.map((entry) => entry.channel),
        simulatedChannels: available
            .filter((entry) => entry.simulated)
            .map((entry) => entry.channel),
    };
}

export function mapGuestOrderLine(wire: WireGuestOrderLine): GuestOrderLine {
    return {
        id: wire.id,
        name: wire.variant_label === null ? wire.name : `${wire.name} — ${wire.variant_label}`,
        // The wire sends a decimal string, because a quantity may be fractional for a weighed
        // line. Screens count portions, so it is parsed; an unparseable value becomes one rather
        // than `NaN`, which would render as "NaN × Chicken Shawarma".
        quantity: Number.parseFloat(wire.quantity) || 1,
        unitPrice: money(wire.unit_price_minor, wire.currency_code),
        lineTotal: money(wire.line_total_minor, wire.currency_code),
    };
}

/**
 * The order's price breakdown, rebuilt from the three totals the wire sends.
 *
 * The endpoint has no `price_lines` array — it has a subtotal, an optional delivery fee and a
 * total. The breakdown is therefore assembled here from exactly those, with no line invented: a
 * discount the wire does not send does not appear, and the codes match the ones the checkout
 * preview already uses so a confirmation reads like the review it followed.
 */
export function mapGuestOrderPriceLines(wire: WireGuestOrder): readonly PriceLine[] {
    const lines: PriceLine[] = [
        {
            code: 'subtotal',
            label: 'Subtotal',
            amount: money(wire.subtotal_minor, wire.currency_code),
        },
    ];
    if (wire.delivery_fee_minor !== null) {
        lines.push({
            code: 'delivery',
            label: 'Delivery',
            amount: money(wire.delivery_fee_minor, wire.currency_code),
        });
    }
    return lines;
}

/** The wire's four order states against the contract's six; two of the six are never sent. */
function mapOrderState(status: WireGuestOrder['status']): GuestOrderState {
    // `fulfilled` is the wire's terminal success and `delivered` is the contract's. `preparing` and
    // `out_for_delivery` exist in the vocabulary for a fulfilment surface that does not report yet.
    return status === 'fulfilled' ? 'delivered' : status;
}

export function mapGuestOrderAddress(wire: WireGuestOrder['delivery']): DeliveryAddress {
    return {
        label: wire.label ?? '',
        line1: wire.line_one,
        line2: wire.line_two,
        area: wire.area ?? '',
        city: wire.city ?? '',
        // The delivery projection names the area and the city but not the market. Guessing one from
        // the area would be inventing a fact about where somebody lives.
        countryCode: '',
        instructions: null,
    };
}

export function createApiGuestRepository(transport: Transport): GuestRepository {
    const store = transport.guestTokenStore;

    /** The contact the person gave, with the server's mask. Session-scoped; empty after a reload. */
    let contact: GuestContact | null = null;
    /** `order_number` → identifier, so a confirmation route survives within the session. */
    const orderIds = new Map<string, string>();

    function mapSession(
        wire: WireGuestSession,
        account: WireGuestAccount | null,
        token: string | null,
    ): GuestSession {
        return {
            id: wire.id,
            token,
            grade: wire.grade,
            capabilities: capabilitiesFor(wire.grade),
            contactVerified: wire.contact_verified,
            contact,
            expiresAt: wire.expires_at,
            // The token dies first and the data a little after. When the account is not on the
            // payload the two are reported as the same instant, which understates the window
            // rather than promising one the server never named.
            dataExpiresAt: account?.guest_expires_at ?? wire.expires_at,
            createdAt: wire.last_used_at ?? wire.expires_at,
        };
    }

    async function readSession(token: string | null): Promise<GuestSession> {
        const envelope = await transport.request<{
            session: WireGuestSession;
            customer_account: WireGuestAccount;
        }>({ method: 'GET', path: '/guest/session', guest: true });

        return mapSession(envelope.session, envelope.customer_account, token);
    }

    function mapOrder(wire: WireGuestOrder): GuestOrder {
        orderIds.set(wire.order_number, wire.id);

        return {
            id: OrderId.unsafe(wire.id),
            reference: wire.order_number,
            state: mapOrderState(wire.status),
            lines: wire.lines.map(mapGuestOrderLine),
            priceLines: mapGuestOrderPriceLines(wire),
            total: money(wire.total_minor, wire.currency_code),
            paymentMethod: wire.payment_method,
            address: mapGuestOrderAddress(wire.delivery),
            slotCode: wire.delivery.window_code ?? '',
            deliveryDate: wire.delivery.requested_date ?? '',
            // The order payload carries no contact. The one the session remembers is used when it
            // is there; otherwise an empty contact, which renders as blank rather than as somebody
            // else's address.
            contact: contact ?? {
                id: '',
                email: null,
                mobile: null,
                maskedDestination: '',
                fullName: '',
                preferredChannel: 'email',
                verified: true,
                verifiedAt: null,
            },
            placedAt: wire.placed_at,
        };
    }

    return {
        /**
         * Start a session, then read it.
         *
         * The token is written to the store *before* the second request, because that request is
         * the first one that needs it. `cartId` is accepted by the contract and not sent: the
         * backend adopts whatever basket the guest account already owns, and there is no field on
         * `POST /guest/sessions` to nominate one.
         */
        async startSession(request?: StartGuestSessionRequest): Promise<GuestSession> {
            void request;
            const started = await transport.request<WireStartedSession>({
                method: 'POST',
                path: '/guest/sessions',
                anonymous: true,
                body: {},
            });

            store.set(started.token);
            contact = null;
            orderIds.clear();

            return readSession(started.token);
        },

        /** Every later read carries `null` where the token was, so a cached session cannot replay. */
        async getSession(): Promise<GuestSession> {
            return readSession(null);
        },

        /**
         * Give or correct the contact, and get the challenge that will prove it.
         *
         * One call on the wire as well as in the contract. The contact object is assembled from
         * what the caller supplied plus the mask the *server* authored for the challenge — never
         * from a mask computed here, because the mask is the sentence telling somebody where their
         * code went.
         */
        async updateContact(request: UpdateGuestContactRequest): Promise<GuestContactChallenge> {
            const email = request.email ?? null;
            const mobile = request.mobile ?? null;

            if (email === null && mobile === null) {
                throw new ApiError(
                    validationFailure({
                        email: ['Give an email address or a mobile number.'],
                    }),
                );
            }

            const wire = await transport.request<WireGuestChallenge>({
                method: 'POST',
                path: '/guest/contacts',
                guest: true,
                body: {
                    channel: email !== null ? 'email' : 'phone',
                    value: email ?? mobile,
                    ...(request.preferredChannel === undefined
                        ? {}
                        : { delivery_channel: request.preferredChannel }),
                },
            });

            const challenge = mapGuestChallenge(wire);
            contact = {
                id: wire.challenge_id,
                email,
                mobile,
                maskedDestination: challenge.maskedDestination,
                fullName: request.fullName,
                preferredChannel: request.preferredChannel ?? (email !== null ? 'email' : 'sms'),
                verified: false,
                verifiedAt: null,
            };

            return { contact, challenge };
        },

        /** A correct code promotes the session; the promoted session is what the caller is given. */
        async confirmContact(request: ConfirmGuestContactRequest): Promise<GuestSession> {
            await transport.request({
                method: 'POST',
                path: '/guest/contacts/verify',
                guest: true,
                body: { challenge_id: request.challengeId, code: request.code },
            });

            if (contact !== null) {
                contact = { ...contact, verified: true, verifiedAt: new Date().toISOString() };
            }

            return readSession(null);
        },

        /**
         * Place the order.
         *
         * `Idempotency-Key` is a fresh UUID **per attempt**, which is the whole point: the same key
         * with the same body is replayed rather than duplicated, so a retry after a dropped
         * connection returns the order that was already placed instead of placing a second one.
         * Generating it here rather than taking it from the caller means no screen can forget.
         */
        async placeOrder(draft: GuestCheckoutDraft): Promise<GuestOrder> {
            if (draft.addressId === undefined || draft.addressId === '') {
                throw new ApiError(
                    validationFailure(
                        { addressId: ['Choose a saved delivery address before ordering.'] },
                        {
                            message:
                                'This order has no delivery address to resolve a zone, a window ' +
                                'and a fee from.',
                        },
                    ),
                );
            }

            // `{ data: { order } }` — the transport peels the envelope's `data`, and the endpoint's
            // own `order` wrapper is peeled here rather than mistaken for the order itself.
            const payload = await transport.request<{ order: WireGuestOrder }>({
                method: 'POST',
                path: '/guest/orders',
                guest: true,
                // `generateRequestId` rather than `crypto.randomUUID`: the latter is missing on
                // some React Native runtimes, and this is the one header whose absence would let a
                // dropped connection turn into a second dinner.
                headers: { 'Idempotency-Key': generateRequestId() },
                body: {
                    cart_id: String(draft.cartId satisfies CartId),
                    customer_address_id: draft.addressId,
                    delivery_window_code: draft.slotCode === '' ? null : draft.slotCode,
                    requested_delivery_date: draft.deliveryDate === '' ? null : draft.deliveryDate,
                },
            });

            return mapOrder(payload.order);
        },

        async getOrder(reference: string): Promise<GuestOrder> {
            // The memo first, then the value as given — which is correct when a caller already
            // holds an identifier, and is the only thing left to try when it does not.
            const identifier = orderIds.get(reference) ?? reference;
            const payload = await transport.request<{ order: WireGuestOrder }>({
                method: 'GET',
                path: `/guest/orders/${encodeURIComponent(identifier)}`,
                guest: true,
            });
            return mapOrder(payload.order);
        },

        /**
         * What the conversion prompt pre-fills from.
         *
         * Assembled from the live session rather than from an endpoint, because there is none: the
         * name and contact are what this repository was given, and the orders are the ones placed
         * in this session. Reading the session first is what makes the promise honest — a session
         * the server has ended cannot pre-fill anything, and rejects here rather than at submit.
         */
        async getConversionPrefill(): Promise<GuestConversionPrefill> {
            const session = await readSession(null);

            return {
                fullName: contact?.fullName ?? '',
                email: contact?.email ?? null,
                mobile: contact?.mobile ?? null,
                contactVerified: session.contactVerified,
                orderReferences: [...orderIds.keys()],
            };
        },

        /**
         * Become an account holder.
         *
         * `POST /guest/convert` takes a full registration body and answers the account it created —
         * and no session token, because it does not issue one: the guest token is revoked and the
         * person signs in. `sessionToken` is therefore empty, and the caller's next step is the
         * sign-in screen rather than a session it was handed. The guest store is cleared here so a
         * dead token cannot be replayed even if the caller forgets.
         */
        async convert(request: ConvertGuestRequest): Promise<GuestConversionResult> {
            const email = contact?.email;
            if (email === undefined || email === null || email === '') {
                throw new ApiError(
                    validationFailure({
                        email: ['An email address is needed to make an account.'],
                    }),
                );
            }

            const parts = request.fullName.trim().split(/\s+/);
            const familyName = parts.length > 1 ? parts[parts.length - 1]! : (parts[0] ?? '');
            const givenName = parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] ?? '');
            const references = [...orderIds.keys()];

            const account = await transport.request<WireGuestAccount>({
                method: 'POST',
                path: '/guest/convert',
                guest: true,
                body: {
                    email,
                    password: request.password,
                    password_confirmation: request.password,
                    given_name: givenName,
                    family_name: familyName,
                    accepts_terms: true,
                    accepts_privacy: true,
                },
            });

            store.clear();
            contact = null;
            orderIds.clear();

            return {
                accountId: account.id,
                sessionToken: '',
                orderReferences: references,
                convertedAt: account.converted_at ?? new Date().toISOString(),
            };
        },

        /**
         * Public, and deliberately tokenless.
         *
         * `guest: true` is **not** set on either deletion call. An erasure right conditional on
         * holding a credential is not a right, and the endpoints are reached from a public page by
         * somebody who may have cleared their browser months ago.
         */
        async requestDeletion(
            request: RequestGuestDeletionRequest,
        ): Promise<GuestDeletionAcknowledgement> {
            const email = request.email ?? null;
            const wire = await transport.request<{
                accepted: true;
                destination_masked: string;
                verification_required: boolean;
                expires_in_seconds: number;
            }>({
                method: 'POST',
                path: '/guest/deletion-requests',
                anonymous: true,
                body: {
                    channel: email !== null ? 'email' : 'phone',
                    value: email ?? request.mobile,
                },
            });

            return {
                accepted: true,
                destinationMasked: wire.destination_masked,
                verificationRequired: wire.verification_required,
                expiresInSeconds: wire.expires_in_seconds,
                // Not on the wire, and the same six digits every Healthy360 passcode has.
                codeLength: PASSCODE_LENGTH,
            };
        },

        async confirmDeletion(request: ConfirmGuestDeletionRequest): Promise<GuestDeletionOutcome> {
            const email = request.email ?? null;
            await transport.request<{ accepted: true; purged: boolean }>({
                method: 'POST',
                path: '/guest/deletion-requests/verify',
                anonymous: true,
                body: {
                    channel: email !== null ? 'email' : 'phone',
                    value: email ?? request.mobile,
                    code: request.code,
                },
            });

            // Whatever the token was, it is meaningless now.
            store.clear();
            contact = null;
            orderIds.clear();

            return {
                accepted: true,
                // The wire says *whether* it was carried out, never when. Guest erasure is
                // immediate, so the moment the answer arrived is the moment it completed.
                completedAt: new Date().toISOString(),
                // Always true, and said out loud: a hash of the address survives erasure precisely
                // so "never contact me again" outlives the deletion of everything else. The wire's
                // `report.suppressions_written` is not read, because it would leak whether there
                // was anything to suppress — the one fact this endpoint must not disclose.
                marketingSuppressed: true,
            };
        },

        /**
         * Re-read a live challenge.
         *
         * `GET /verification/challenges/{challenge}` is the only endpoint that reads one back, and
         * it is reached here with the guest token: a guest challenge belongs to a guest session,
         * not to an account contact point.
         */
        async getChallenge(request: { readonly challengeId: string }): Promise<OtpChallenge> {
            const wire = await transport.request<WireGuestChallenge>({
                method: 'GET',
                path: `/verification/challenges/${encodeURIComponent(request.challengeId)}`,
                guest: true,
            });
            return mapGuestChallenge(wire);
        },

        async resendChallenge(request: {
            readonly challengeId: string;
            readonly channel?: OtpChannel | undefined;
        }): Promise<OtpChallenge> {
            const wire = await transport.request<WireGuestChallenge>({
                method: 'POST',
                path: `/verification/challenges/${encodeURIComponent(request.challengeId)}/resend`,
                guest: true,
                body: request.channel === undefined ? {} : { delivery_channel: request.channel },
            });
            return mapGuestChallenge(wire);
        },
    };
}
