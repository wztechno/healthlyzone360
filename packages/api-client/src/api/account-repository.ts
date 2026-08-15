import { IngredientId, ServiceAreaId } from '@healthy360/domain-types';

import type {
    AccountChecklistItem,
    AccountChecklistStep,
    AccountLifecycle,
    AccountOverview,
    AccountRepository,
    AccountServiceArea,
    AccountSetupChecklist,
    AllergenDeclaration,
    AllergenSeverity,
    ClosureBlocker,
    ClosureBlockerCode,
    ClosurePreconditions,
    ClosureReasonCode,
    ClosureTicket,
    ConsentState,
    CustomerAccount,
    CustomerAddress,
    DietaryProfile,
    RequestClosureRequest,
    SaveAddressRequest,
    SaveDietaryProfileRequest,
    SetConsentRequest,
    VerifyClosureRequest,
} from '../contracts/account.ts';
import { ApiError, apiFailure } from '../contracts/failure.ts';
import type {
    ContactPoint,
    OtpChallenge,
    VerificationRepository,
} from '../contracts/verification.ts';
import type {
    AddCustomerAddressRequest,
    CancelledClosureRequestEnvelope,
    ClosureAcknowledgement as WireClosure,
    ClosureAcknowledgementEnvelope,
    ClosureBlockerVerdict as WireClosureBlocker,
    CustomerAccount as WireAccount,
    CustomerAccountChecklistItem as WireChecklistItem,
    CustomerAddress as WireAddress,
    CustomerAllergenDeclaration as WireAllergen,
    CustomerConsent as WireConsent,
    CustomerDietaryProfile as WireDietaryProfile,
    LiveClosureRequestEnvelope,
    OpenClosureRequestRequest as WireOpenClosureRequest,
    UpdateCustomerAddressRequest,
} from '../generated/types.ts';
import { mapLocale } from './mappers.ts';
import type { ApiReferenceReads } from './reference-repository.ts';
import type { Transport } from './transport.ts';
import { PASSCODE_LENGTH } from './verification-repository.ts';

/**
 * The D2C account area, over HTTP (plan Phase J1).
 *
 * The backend models this family as six independent collections under `/me` plus an account root at
 * `/customer-account`; the contract models it as one repository with an overview. Most of the
 * translation is mechanical. Five things are not, and each is a place where the wire holds less
 * than the contract promises — recorded here rather than papered over.
 *
 * ## 1. The checklist is a code list, not a step list
 *
 * `CustomerAccountChecklistItem.code` is a *reason* (`account.email_unverified`), where
 * `AccountChecklistStep` is a *step* (`verify_email`). {@link CHECKLIST_STEPS} is the one-to-one
 * translation. `canActivate` comes from `is_ready` and is never recomputed from the items — which
 * is the rule the contract exists to encode: the server owns the activation evaluator.
 *
 * `blockedReason` reads the account's `outstanding` list, which carries the same codes with a
 * context object. When a step is outstanding *and* not merely incomplete, the server's own code is
 * shown; otherwise the reason is `null`, because "you have not done this yet" is not a blockage.
 *
 * ## 2. An address has an area identifier and no area name
 *
 * `CustomerAddress.delivery_area_id` is a foreign key and nothing on the payload resolves it, so a
 * list of three addresses would render three blank area labels. This repository therefore holds a
 * lazily-loaded **directory** of the delivery-area gazetteer (`./reference-repository.ts`) and
 * resolves names from it. The gazetteer is a closed list of a few hundred rows that changes when a
 * market opens, so one fetch per session is honest caching rather than a guess; an identifier the
 * directory does not know resolves to an empty name, never to a plausible-looking wrong one.
 *
 * ## 3. Consents carry no text
 *
 * `ConsentDefinition` promises `title` and `text` — the exact wording somebody agreed to, per
 * locale, because a consent has to be the text they were shown (OQ-033). `CustomerConsent` carries
 * `code`, `purpose` and a numeric `version` and no wording at all. The mapper puts the server's
 * `purpose` in both slots rather than inventing copy, so a consent screen prints something true and
 * obviously incomplete instead of something invented and plausible. This is the largest of the five
 * gaps and the one worth closing first backend-side.
 *
 * ## 4. `withdrawnAt` and `grantedAt` do not exist
 *
 * The wire says `status: 'granted' | 'pending'` and nothing about when. Both timestamps are `null`;
 * nothing in the app formats them today.
 *
 * ## 5. Diet categories are an identifier, allergens have a fourth severity
 *
 * `DietaryProfile.dietCategoryCodes` is a list of codes; the wire holds one
 * `diet_classification_id`, a UUID. The identifier is passed through as the single member of the
 * list, which is honest — it *is* the classification the person chose — and a screen that resolves
 * codes to labels will show the identifier until a code is published. `AllergenSeverity` on the
 * wire has a fourth member, `anaphylaxis`, which the contract's three do not: it maps to `allergy`,
 * the hard-exclusion severity, because that is what the configurator must do with it. The
 * distinction is lost on a round trip, and that is stated rather than hidden.
 */

/** Wire reason code → the checklist step it blocks. */
const CHECKLIST_STEPS: Readonly<Record<WireChecklistItem['code'], AccountChecklistStep>> = {
    'account.email_unverified': 'verify_email',
    'account.phone_unverified': 'verify_phone',
    'account.no_served_address': 'add_address',
    'account.dietary_declaration_missing': 'dietary_profile',
    'account.consents_outstanding': 'consents',
};

/**
 * Wire severity → the contract's three.
 *
 * `anaphylaxis` collapses onto `allergy`, which is the only severity the meal configurator treats
 * as a hard exclusion. Collapsing upward is the safe direction: the person is over-protected rather
 * than under-protected, and the note they wrote survives on the declaration.
 */
function mapSeverity(wire: WireAllergen['severity']): AllergenSeverity {
    return wire === 'anaphylaxis' ? 'allergy' : wire;
}

/** The wire's four account states are a subset of the contract's five; `closing` is never sent. */
function mapLifecycle(status: WireAccount['status']): AccountLifecycle {
    return status;
}

export function mapCustomerAccount(wire: WireAccount, loginEmail: string): CustomerAccount {
    return {
        id: wire.id,
        lifecycle: mapLifecycle(wire.status),
        // The account number is what a person quotes to support; the display name is optional and
        // frequently absent on a provisional account. Falling back keeps the header non-empty.
        displayName: wire.display_name ?? wire.account_number,
        // Not on this payload. The caller passes the address it already read from `/me`, which is
        // the same address `contact_points` mirrors as the login identity.
        loginEmail,
        locale: mapLocale(wire.preferred_language_code),
        createdAt: wire.created_at ?? '',
        activatedAt: wire.activated_at ?? null,
    };
}

export function mapChecklist(wire: WireAccount): AccountSetupChecklist {
    const outstanding = new Map(wire.outstanding.map((reason) => [reason.code, reason]));

    const items: AccountChecklistItem[] = wire.checklist.map((item): AccountChecklistItem => {
        const blocked = !item.satisfied && item.required && outstanding.has(item.code);
        return {
            step: CHECKLIST_STEPS[item.code],
            complete: item.satisfied,
            // The one field that stops the client owning the activation rules. Whether phone
            // verification counts at all is configuration (gate A-011), and this is where the
            // server says so.
            required: item.required,
            // The server's own reason code, not a sentence: the client owns the copy. `null` when
            // the step is merely undone, because an invitation is not a blockage.
            blockedReason: blocked ? item.code : null,
        };
    });

    return {
        lifecycle: mapLifecycle(wire.status),
        items,
        // Never recomputed from `items`. The evaluator is the server's.
        canActivate: wire.is_ready,
    };
}

/** Resolves a delivery-area identifier to a name, or to `''` when the gazetteer does not know it. */
export type AreaNames = (areaId: string) => string;

export function mapAddress(wire: WireAddress, areaName: AreaNames): CustomerAddress {
    return {
        id: wire.id,
        // A person's own name for the address. Absent is common — the first address is often
        // unlabelled — and an empty string renders as the street line rather than as "null".
        label: wire.label ?? '',
        areaId: ServiceAreaId.unsafe(wire.delivery_area_id),
        areaName: areaName(wire.delivery_area_id),
        line1: wire.line_one,
        line2: wire.line_two ?? null,
        building: wire.building ?? null,
        floor: wire.floor ?? null,
        // The wire calls them directions, which is the better name: they are for the driver, not
        // part of the address.
        notes: wire.directions ?? null,
        isDeliverable: wire.is_deliverable,
        isDefault: wire.is_default,
    };
}

export function mapDietaryProfile(wire: WireDietaryProfile): DietaryProfile {
    return {
        // One classification on the wire, a list in the contract. The identifier is carried rather
        // than dropped: it is what the person chose, and dropping it would lose their answer.
        dietCategoryCodes:
            wire.diet_classification_id === null || wire.diet_classification_id === undefined
                ? []
                : [wire.diet_classification_id],
        allergens: wire.allergens.map((allergen): AllergenDeclaration => ({
            allergenCode: allergen.allergen_code,
            severity: mapSeverity(allergen.severity),
            note: allergen.notes ?? null,
        })),
        excludedIngredientIds: wire.exclusions
            .filter((exclusion) => exclusion.subject_kind === 'ingredient')
            .map((exclusion) => exclusion.ingredient_id)
            .filter((id): id is string => typeof id === 'string' && id !== '')
            .map((id) => IngredientId.unsafe(id)),
        updatedAt: wire.updated_at ?? wire.declared_at ?? null,
    };
}

export function mapConsent(wire: WireConsent): ConsentState {
    return {
        definition: {
            key: wire.code,
            version: String(wire.version),
            // The endpoint publishes no authored wording. `purpose` is the nearest true thing it
            // does publish, and it is used for both rather than a phrase invented on the device.
            title: wire.purpose,
            text: wire.purpose,
            required: wire.is_required,
        },
        granted: wire.status === 'granted',
        grantedAt: null,
        withdrawnAt: null,
    };
}

/*
 * Closure (J2), over the wire that exists.
 *
 * Four endpoints serve the whole journey — `POST /me/closure-requests`, `GET /me/closure-requests/
 * live`, `POST /me/closure-requests/{request}/verify`, `DELETE /me/closure-requests/{request}` —
 * and the wire holds less than the contract promises in five places. Each is recorded here rather
 * than papered over, on the same terms as the file header above.
 *
 * ## 6. Preconditions ride on the live read
 *
 * There is no `/me/closure-preconditions` endpoint. The live read answers `blockers` re-evaluated
 * on every call whether or not a request exists, so `getClosurePreconditions` reads it and keeps
 * the verdicts. `canClose` is derived as "no verdict is `blocking`" — which is recomputing on the
 * device, and the contract forbids that *where the server publishes a verdict*. Here it publishes
 * none without a request row; the rule applied is the wire schema's own sentence ("whether anything
 * found **stops** the closure — an `advisory` verdict does not set this"), and the moment a request
 * exists the server's `blocked` is used instead ({@link mapClosureTicket}).
 *
 * ## 7. The challenge is bound to the request and never named
 *
 * The passcode is issued with the ticket and verified through the request's own `/verify` — the
 * acknowledgement carries a masked destination and a countdown but **no challenge identifier**, so
 * a resend through `/verification/challenges/{challenge}/resend` cannot be reached from what this
 * surface is told. The mapped {@link OtpChallenge} therefore carries the package's empty-string
 * sentinel for `id`, `resendsRemaining: 0` ("there is no resend from here", not "you used them
 * up"), and the OTP framework's own ceiling for `attemptsRemaining` — the live count arrives on
 * the `otp.invalid` failure (contract shape 2), which is the source a panel must use anyway.
 *
 * ## 8. A resumed wizard has no mask and no countdown
 *
 * The live read serves `verification_required` recomputed from the row but passes no
 * `destination_masked` and no `expires_in_seconds` — those travel only on the response that sent
 * the code. After a reload the challenge is still real, so it is still non-null; its mask and
 * expiry are the empty-string sentinel rather than values invented on the device.
 *
 * ## 9. The reason is write-only, and `completedAt` does not exist
 *
 * `reason_code` is confidential, deleted at finalisation, and never served back. `reasonCode` on a
 * ticket is echoed from what *this session* sent ({@link createApiAccountRepository} remembers it
 * per request identifier) and falls back to `other` — the vocabulary's own escape hatch — after a
 * reload. No closure payload carries a completion instant, so `completedAt` is `null` on the same
 * terms as §4's consent timestamps.
 */

/**
 * Where a person goes to deal with a blocker. Client-side routing, deliberately: the server knows
 * *what* is in the way, the application knows *which screen* resolves it. The mock world keeps its
 * own copy of this table (`../mock/account/closure.ts`) — the two must name the same screens.
 */
const CLOSURE_RESOLVE_HREFS: Readonly<Record<ClosureBlockerCode, string | null>> = {
    open_orders: '/customer/orders',
    active_subscriptions: '/customer/subscriptions',
    organisation_memberships: null,
    pending_b2b_signatures: '/apply/agreement',
    unsettled_credit_memos: '/customer/subscriptions',
    wallet_balance: null,
    payment_methods: null,
};

/**
 * What survives the purge. The backend publishes no named vocabulary for this (its `ClosureReport`
 * counts *actions*, not retained categories), so these codes are the application's own, translated
 * client-side — the same four the mock world states (`../mock/account/closure.ts`).
 */
export const CLOSURE_RETAINED_RECORD_CODES: readonly string[] = [
    'orders_anonymised',
    'credit_memos',
    'contact_suppression',
    'closure_tombstone',
];

/** Three wrong codes close a challenge (`otp.attempts_exceeded`). The ceiling, not a live count. */
const OTP_ATTEMPT_CEILING = 3;

export function mapClosureBlocker(wire: WireClosureBlocker): ClosureBlocker {
    return {
        code: wire.code,
        status: wire.status,
        count: wire.count,
        reason: wire.reason ?? null,
        resolveHref: CLOSURE_RESOLVE_HREFS[wire.code] ?? null,
    };
}

export function mapClosurePreconditions(
    blockers: readonly WireClosureBlocker[],
): ClosurePreconditions {
    const mapped = blockers.map(mapClosureBlocker);
    return {
        // §6 above: only `blocking` stops a closure — the wire schema's own summary rule, applied
        // here because no request row exists yet for the server to summarise onto.
        canClose: !mapped.some((blocker) => blocker.status === 'blocking'),
        blockers: mapped,
        retainedRecordCodes: CLOSURE_RETAINED_RECORD_CODES,
    };
}

/**
 * The step-up, from the two fields the acknowledgement carries.
 *
 * Non-null exactly when a passcode is what the journey waits on: the scope required verification,
 * nothing blocks, and the request still sits at `requested`. A blocked request and an opt-out both
 * answer `null`, which is the contract's own sentence about them.
 */
function mapClosureChallenge(wire: WireClosure): OtpChallenge | null {
    if (!wire.verification_required || wire.blocked || wire.status !== 'requested') return null;

    const expiresIn = wire.expires_in_seconds;
    return {
        // §7 above: the wire binds the challenge to the request row and never names it.
        id: '',
        purpose: 'closure_step_up',
        // The only channel with a real driver; the closure passcode goes to the login contact.
        channel: 'email',
        maskedDestination: wire.destination_masked ?? '',
        codeLength: PASSCODE_LENGTH,
        expiresAt:
            typeof expiresIn === 'number'
                ? new Date(Date.now() + expiresIn * 1000).toISOString()
                : '',
        resendCooldownSeconds: 0,
        attemptsRemaining: OTP_ATTEMPT_CEILING,
        resendsRemaining: 0,
        availableChannels: [],
        simulatedChannels: [],
    };
}

export function mapClosureTicket(wire: WireClosure, reasonCode: ClosureReasonCode): ClosureTicket {
    return {
        id: wire.request_id,
        scope: wire.scope,
        status: wire.status,
        reasonCode,
        blockers: wire.blockers.map(mapClosureBlocker),
        // The server's summary, never recomputed from the verdicts here.
        blocked: wire.blocked,
        verificationRequired: wire.verification_required,
        challenge: mapClosureChallenge(wire),
        scheduledFor: wire.scheduled_for ?? null,
        // §9 above: no closure payload carries a completion instant.
        completedAt: null,
    };
}

export interface ApiAccountRepositoryOptions {
    readonly transport: Transport;
    readonly reference: ApiReferenceReads;
    /** Reads the contacts the overview re-exposes; the same repository the screens use. */
    readonly verification: VerificationRepository;
    /** The sign-in address, which `/customer-account` does not carry. Read once from `/me`. */
    readonly loginEmail: () => string;
}

export function createApiAccountRepository(
    options: ApiAccountRepositoryOptions,
): AccountRepository {
    const { transport, reference, verification, loginEmail } = options;

    /**
     * What this session said when it asked to close, per request identifier.
     *
     * The wire never serves the reason back (§9 above), so this is the only place the echo can
     * come from. A map rather than a single slot so a cancelled request followed by a fresh one
     * cannot cross-contaminate; unbounded growth is not a concern for a journey a person walks
     * once.
     */
    const closureReasons = new Map<string, ClosureReasonCode>();

    function closureReason(requestId: string): ClosureReasonCode {
        return closureReasons.get(requestId) ?? 'other';
    }

    async function readLiveClosure(): Promise<LiveClosureRequestEnvelope['data']> {
        return transport.request<LiveClosureRequestEnvelope['data']>({
            method: 'GET',
            path: '/me/closure-requests/live',
        });
    }

    /**
     * The gazetteer, fetched at most once per bundle.
     *
     * A promise rather than a resolved map, so two screens mounting together share one request
     * instead of racing. A failed fetch is *not* cached: a picker that failed to load once must be
     * able to load on the next attempt, and caching the rejection would mean an address editor that
     * stays broken until a reload.
     */
    let directory: Promise<ReadonlyMap<string, string>> | null = null;

    function areaDirectory(): Promise<ReadonlyMap<string, string>> {
        directory ??= reference
            .listAccountServiceAreas()
            .then((areas) => new Map(areas.map((area) => [String(area.id), area.name])))
            .catch((caught: unknown) => {
                directory = null;
                throw caught;
            });
        return directory;
    }

    /**
     * A name resolver that never invents.
     *
     * When the gazetteer could not be read at all, every name resolves to `''` and the addresses
     * still render — with the street lines the person typed, which is the part they recognise.
     * Refusing the whole list because a label is missing would be the worse trade.
     */
    async function names(): Promise<AreaNames> {
        try {
            const map = await areaDirectory();
            return (areaId: string) => map.get(areaId) ?? '';
        } catch {
            return () => '';
        }
    }

    function addressBody(request: SaveAddressRequest): AddCustomerAddressRequest {
        return {
            // Every address this surface writes is a delivery address; billing addresses are a
            // payment concern and no screen collects one.
            address_type: 'delivery',
            delivery_area_id: String(request.areaId),
            label: request.label,
            line_one: request.line1,
            line_two: request.line2 ?? null,
            building: request.building ?? null,
            floor: request.floor ?? null,
            directions: request.notes ?? null,
            ...(request.makeDefault === undefined ? {} : { is_default: request.makeDefault }),
        };
    }

    async function readAccount(): Promise<WireAccount> {
        return transport.request<WireAccount>({ method: 'GET', path: '/customer-account' });
    }

    return {
        /**
         * The account, its contacts and its checklist, in one call from a screen's point of view.
         *
         * Two requests in parallel rather than one: the backend does not join contacts onto the
         * account root, and the checklist screen needs both to say "your email is confirmed and
         * your phone is not". Running them together costs one round trip rather than two.
         */
        async getOverview(): Promise<AccountOverview> {
            const [account, contacts] = await Promise.all([
                readAccount(),
                verification.listContactPoints() as Promise<readonly ContactPoint[]>,
            ]);

            return {
                account: mapCustomerAccount(account, loginEmail()),
                contacts,
                checklist: mapChecklist(account),
            };
        },

        async getChecklist(): Promise<AccountSetupChecklist> {
            return mapChecklist(await readAccount());
        },

        async listServiceAreas(): Promise<readonly AccountServiceArea[]> {
            return reference.listAccountServiceAreas();
        },

        async listAddresses(): Promise<readonly CustomerAddress[]> {
            const [wire, areaName] = await Promise.all([
                transport.request<WireAddress[]>({ method: 'GET', path: '/me/addresses' }),
                names(),
            ]);
            return wire.map((address) => mapAddress(address, areaName));
        },

        async addAddress(request: SaveAddressRequest): Promise<CustomerAddress> {
            const [wire, areaName] = await Promise.all([
                transport.request<WireAddress>({
                    method: 'POST',
                    path: '/me/addresses',
                    body: addressBody(request),
                }),
                names(),
            ]);
            return mapAddress(wire, areaName);
        },

        /**
         * Update, and make default if asked.
         *
         * `PATCH /me/addresses/{address}` does not carry `is_default` — defaulting is its own
         * endpoint, because it is a change to *every other* address as much as to this one. The
         * contract's `makeDefault` therefore becomes a second call, made only when it is `true`:
         * sending `false` has no endpoint at all, since an address cannot un-default itself without
         * another taking its place.
         */
        async updateAddress(
            request: SaveAddressRequest & { readonly addressId: string },
        ): Promise<CustomerAddress> {
            const path = `/me/addresses/${encodeURIComponent(request.addressId)}`;
            const body: UpdateCustomerAddressRequest = {
                delivery_area_id: String(request.areaId),
                label: request.label,
                line_one: request.line1,
                line_two: request.line2 ?? null,
                building: request.building ?? null,
                floor: request.floor ?? null,
                directions: request.notes ?? null,
            };

            let wire = await transport.request<WireAddress>({ method: 'PATCH', path, body });

            if (request.makeDefault === true && !wire.is_default) {
                wire = await transport.request<WireAddress>({
                    method: 'POST',
                    path: `${path}/default`,
                });
            }

            return mapAddress(wire, await names());
        },

        async removeAddress(request: { readonly addressId: string }): Promise<void> {
            await transport.requestVoid({
                method: 'DELETE',
                path: `/me/addresses/${encodeURIComponent(request.addressId)}`,
            });
        },

        async getDietaryProfile(): Promise<DietaryProfile> {
            const wire = await transport.request<WireDietaryProfile>({
                method: 'GET',
                path: '/me/dietary-profile',
            });
            return mapDietaryProfile(wire);
        },

        /**
         * Replace the declaration wholesale.
         *
         * `PUT`, and the contract agrees: the allergy declaration is the store of record, and a
         * partial write would leave a client and a server disagreeing about which allergens were
         * removed. Ingredient exclusions are sent as `ingredient` exclusions; the free-text and
         * diet-classification kinds the wire also supports have no screen and are not invented here.
         */
        async saveDietaryProfile(request: SaveDietaryProfileRequest): Promise<DietaryProfile> {
            const wire = await transport.request<WireDietaryProfile>({
                method: 'PUT',
                path: '/me/dietary-profile',
                body: {
                    allergens: request.allergens.map((allergen) => ({
                        allergen_code: allergen.allergenCode,
                        severity: allergen.severity,
                        notes: allergen.note,
                    })),
                    exclusions: request.excludedIngredientIds.map((id) => ({
                        kind: 'forbidden' as const,
                        ingredient_id: String(id),
                    })),
                    // One classification on the wire; the contract's list is sent as its first
                    // member, and an empty list clears it.
                    diet_classification_id: request.dietCategoryCodes[0] ?? null,
                },
            });
            return mapDietaryProfile(wire);
        },

        async listConsents(): Promise<readonly ConsentState[]> {
            const wire = await transport.request<WireConsent[]>({
                method: 'GET',
                path: '/me/consents',
            });
            return wire.map(mapConsent);
        },

        /**
         * Grant or withdraw one consent, and answer its new state.
         *
         * Two endpoints — `POST /me/consents` takes a list of codes to grant, `DELETE
         * /me/consents/{code}` withdraws one — and neither answers the consent it changed. The
         * state is therefore re-read, which is one extra request on a screen a person visits rarely
         * and is the only way to answer the contract honestly: returning a locally-flipped copy
         * would report a grant the server may have refused for a version the client did not know
         * about.
         */
        async setConsent(request: SetConsentRequest): Promise<ConsentState> {
            if (request.granted) {
                await transport.request({
                    method: 'POST',
                    path: '/me/consents',
                    body: { codes: [request.key] },
                });
            } else {
                await transport.requestVoid({
                    method: 'DELETE',
                    path: `/me/consents/${encodeURIComponent(request.key)}`,
                });
            }

            const wire = await transport.request<WireConsent[]>({
                method: 'GET',
                path: '/me/consents',
            });
            const updated = wire.find((consent) => consent.code === request.key);

            if (updated === undefined) {
                // The consent set is served whole and every member is defined by the platform, so
                // a code that vanishes between the write and the read is a consent that was
                // retired underneath the screen.
                throw new ApiError(
                    apiFailure('resource.not_found', {
                        message: 'That consent is no longer part of the set.',
                    }),
                );
            }

            return mapConsent(updated);
        },

        /* ── J2: closure — see the numbered notes above the mappers ──────────────────────────── */

        async getClosurePreconditions(): Promise<ClosurePreconditions> {
            const wire = await readLiveClosure();
            return mapClosurePreconditions(wire.blockers);
        },

        async getLiveClosureRequest(): Promise<ClosureTicket | null> {
            const wire = await readLiveClosure();
            const live = wire.closure_request;
            if (live === null) return null;
            return mapClosureTicket(live, closureReason(live.request_id));
        },

        /**
         * Ask to close — and the code, when one is owed, arrives in the same answer.
         *
         * A blocked `full` request is a **success** carrying `blocked: true` (D-073): the endpoint
         * answers `202` with the verdicts, no error is thrown, and the wizard renders work to do.
         * Only the transport-level failures (`closure.refused` for a second in-flight request,
         * `otp.channel_unavailable`, validation) reject.
         */
        async requestClosure(request: RequestClosureRequest): Promise<ClosureTicket> {
            const body: WireOpenClosureRequest = {
                reason_code: request.reasonCode,
                scope: request.scope,
                ...(request.reasonNote === undefined ? {} : { reason_note: request.reasonNote }),
            };

            const wire = await transport.request<ClosureAcknowledgementEnvelope['data']>({
                method: 'POST',
                path: '/me/closure-requests',
                body,
            });

            closureReasons.set(wire.closure_request.request_id, request.reasonCode);
            return mapClosureTicket(wire.closure_request, request.reasonCode);
        },

        /**
         * The irreversible step. The code travels alone: the challenge is bound to the request row
         * server-side, which is what stops a code obtained for one closure finalising another. A
         * wrong code rejects with `otp.invalid` and the panel reads `attemptsRemaining` from that
         * failure, never from the ticket.
         */
        async verifyClosure(request: VerifyClosureRequest): Promise<ClosureTicket> {
            const wire = await transport.request<ClosureAcknowledgementEnvelope['data']>({
                method: 'POST',
                path: `/me/closure-requests/${encodeURIComponent(request.ticketId)}/verify`,
                body: { code: request.code },
            });
            return mapClosureTicket(wire.closure_request, closureReason(request.ticketId));
        },

        /**
         * Changed their mind. A `200` with the row rather than a `204`, because somebody calling
         * off an account deletion needs to see that it is off. The cancelled projection is smaller
         * than the acknowledgement — no verdicts travel with it — and the empty lists here are
         * that fact, not a claim that nothing stood in the way.
         */
        async cancelClosure(request: { readonly ticketId: string }): Promise<ClosureTicket> {
            const wire = await transport.request<CancelledClosureRequestEnvelope['data']>({
                method: 'DELETE',
                path: `/me/closure-requests/${encodeURIComponent(request.ticketId)}`,
            });

            const cancelled = wire.closure_request;
            return {
                id: cancelled.request_id,
                scope: cancelled.scope,
                status: cancelled.status,
                reasonCode: closureReason(cancelled.request_id),
                blockers: [],
                blocked: false,
                verificationRequired: false,
                challenge: null,
                scheduledFor: null,
                completedAt: null,
            };
        },
    };
}
