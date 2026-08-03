import {
    KitchenId,
    MealId,
    PLAN_DURATION_WEEKS,
    PlanVariantId,
    SubscriptionId,
    SubscriptionPlanId,
    isCurrencyCode,
} from '@healthy360/domain-types';
import type {
    CurrencyCode,
    Money,
    PlanDuration,
    SubscriptionState,
} from '@healthy360/domain-types';

import {
    SUBSCRIPTION_DELIVERY_STATUSES,
    SUBSCRIPTION_QUOTE_REFUSALS,
    SUBSCRIPTION_SKIP_REASONS,
} from '../contracts/commerce.ts';
import type {
    CancelSubscriptionRequest,
    CreditMemo,
    DeliveryAddress,
    SetSubscriptionMealChoicesRequest,
    SetSubscriptionWeekdaysRequest,
    Subscription,
    SubscriptionBalance,
    SubscriptionCancellation,
    SubscriptionDelivery,
    SubscriptionDeliveryFilter,
    SubscriptionDeliveryStatus,
    SubscriptionMealChoice,
    SubscriptionQuote,
    SubscriptionQuoteRefusal,
    SubscriptionQuoteRequest,
    SubscriptionSkipReason,
} from '../contracts/commerce.ts';
import { ApiError, apiFailure, isSubscriptionRefusalFailure } from '../contracts/failure.ts';
import type { ApiFailure } from '../contracts/failure.ts';
import type { CursorPage } from '../contracts/pagination.ts';
import type {
    CreditMemo as WireCreditMemo,
    PlanQuoteEnvelope,
    SubscriptionAddressRef,
    SubscriptionBalance as WireBalance,
    SubscriptionCancellationEnvelope,
    SubscriptionChoicesEnvelope,
    SubscriptionDeliveriesEnvelope,
    SubscriptionDelivery as WireDelivery,
    SubscriptionEnvelope,
    SubscriptionMealChoice as WireMealChoice,
    SubscriptionStatus as WireStatus,
    Subscription as WireSubscription,
} from '../generated/types.ts';
import type { Transport } from './transport.ts';

/**
 * Subscriptions, over HTTP (plan Phase S1).
 *
 * **All six S1 methods, and it took two waves.** The first pass wired the balance and the ledger
 * and stopped: the other four could not be implemented without the client inventing something, and
 * each one's missing fact was recorded rather than papered over. The backend then closed all four
 * at the root, which is why this file now reads as mappers rather than as apologies. What was
 * fixed, and where:
 *
 * 1. **The quote was uncallable from the storefront.** It demanded a `sales_channel_id` and a
 *    `plan_duration_id`; a shopper can obtain neither. The server resolves the channel from the
 *    plan's own kitchen — restricted to its *consumer* channels, so a `b2b` tariff can no longer be
 *    probed through it at all — and names the run by its **number of days**, which
 *    `MarketplacePlanDuration.days` already publishes. Nothing was added to the public projection.
 * 2. **The quote answered price and nothing else.** It carries `available_weekdays`,
 *    `allows_free_selection` and `change_cutoff_hours` now. The first is the whole reason this
 *    method exists: it replaces `useAllowedDeliveryWeekdaysQuery`'s seven previews with one read.
 * 3. **The customer projection was a row of identifiers.** It carries the plan, the kitchen, the
 *    configuration, the run, the address, the start date and the weekly price now. That was
 *    projection thinness rather than confidentiality — it is the customer's own subscription — and
 *    the fix was a batched loader, so the unpaginated list did not become an N+1 in exchange.
 * 4. **A meal choice had no name.** It is server-derived, resolved from the catalogue in the
 *    caller's language, and there is still no request field for one: a caller-supplied label on a
 *    surface this close to safety could disagree with the dish actually recorded.
 *
 * ## The four places the models still differ, and how each is answered
 *
 * - **`duration`.** The contract's vocabulary is closed (`1w | 2w | 4w | 12w`) and the platform
 *   stores real runs of 5, 20, 40 and 60 days. Resolution is by *days* — the rule
 *   `plan-mappers.ts` has applied since M1, because the kitchen's `code` is an authored slug — and
 *   a run this build cannot name is reported rather than rounded. Rounding would show somebody
 *   "4 weeks" for a twelve-week commitment.
 * - **`pausedUntil` is always `null`.** Not a gap in the mapper: the platform has no scheduled
 *   resume. `paused_at` records when a pause *began*, and a pause lasts until somebody resumes it,
 *   so there is no instant to report. Reporting `paused_at` here would print a date in the past
 *   under the words "paused until".
 * - **`dietClassifications` and `excludeAllergens` are empty.** Neither is a property of a
 *   subscription. A plan's diet classification belongs to the plan and is on the plan page; there
 *   is no per-subscription allergen exclusion, because safety comes from the customer's dietary
 *   profile and is applied at generation. `no_substitutions` is the related switch and is a
 *   different fact.
 * - **The address has no area or city name.** The projection names the gazetteer entry by
 *   identifier, not by name — the same reason `mapOrderAddress` leaves `countryCode` empty. A
 *   screen that needs the area name has it from the address book, which serves the resolved entry.
 */

/**
 * The change window, in hours, when the server does not state one.
 *
 * Every path that matters carries the plan's own `change_cutoff_hours` now; this is the fallback
 * for a payload that predates the enrichment. It is the column's default and the operating rule
 * both, and the same constant the fixture world serves
 * (`../mock/prototype/subscription-ledger.ts`).
 */
export const DEFAULT_CHANGE_CUTOFF_HOURS = 24;

/**
 * The currency a zero is denominated in when there is nothing to price.
 *
 * A refused quote has no currency — there was no tariff to read one from — and `Money` requires
 * one. The amount is zero and the contract says a screen showing refusals shows no prices, so the
 * code is inert; the fixture world states the same constant for the same case, which keeps a
 * rehearsed screen and a live one byte-identical.
 */
const REFUSAL_CURRENCY: CurrencyCode = 'AED';

/** Wire day counts → the closed duration vocabulary. Resolved by days, never by the code string. */
const DURATION_BY_DAYS: Readonly<Record<number, PlanDuration>> = {
    7: '1w',
    14: '2w',
    28: '4w',
    84: '12w',
};

/**
 * Wire status → the domain's state vocabulary.
 *
 * `completed` is the only projection: a plan whose balance is spent has ended, and `expired` is the
 * contract's word for that. The other three are one-for-one.
 */
export function mapSubscriptionState(status: WireStatus): SubscriptionState {
    return status === 'completed' ? 'expired' : status;
}

function money(amountMinor: number, currency: string): Money {
    if (!isCurrencyCode(currency)) {
        // A subscription this client cannot price is one whose refund arithmetic it must not print.
        // The subscription exists and is unaffected; this is a display failure and says so.
        throw new ApiError(
            apiFailure('server', {
                message:
                    'This subscription is priced in a currency this version of the app cannot ' +
                    'display. Updating the app will show it correctly.',
                retryable: false,
            }),
        );
    }
    return { amount: amountMinor, currency };
}

/** A decimal string on the wire, whole percent in the contract. `null` means nobody stated one. */
function discountPercent(value: string | null | undefined): number {
    return Math.round(Number.parseFloat(value ?? '0')) || 0;
}

function mapSkipReason(value: string | null | undefined): SubscriptionSkipReason | null {
    if (value === null || value === undefined) return null;
    return (SUBSCRIPTION_SKIP_REASONS as readonly string[]).includes(value)
        ? (value as SubscriptionSkipReason)
        : null;
}

function knownDeliveryStatus(value: string): value is SubscriptionDeliveryStatus {
    return (SUBSCRIPTION_DELIVERY_STATUSES as readonly string[]).includes(value);
}

export function mapSubscriptionBalance(
    wire: WireBalance,
    subscriptionId: SubscriptionId,
    changeCutoffHours = DEFAULT_CHANGE_CUTOFF_HOURS,
): SubscriptionBalance {
    return {
        subscriptionId,
        state: mapSubscriptionState(wire.status),
        days: {
            total: wire.balance_days_total,
            consumed: wire.balance_days_consumed,
            remaining: wire.remaining_days,
        },
        // The *effective* per-day price — after the duration discount — because that is the number
        // a credit memo multiplies (semantics §3), and the wire serves exactly that column.
        perDayPrice: money(wire.per_day_minor, wire.currency_code),
        skippedDays: wire.skipped_days,
        nextDeliveryDate: wire.next_delivery_date,
        deliveryWeekdays: wire.weekdays,
        changeCutoffHours,
    };
}

/**
 * One row of the ledger, or `null` when this build cannot name its status.
 *
 * Dropped rather than defaulted: a day whose status is unknown is a day the client cannot say
 * anything true about, and showing it as `scheduled` would promise food.
 */
export function mapSubscriptionDelivery(wire: WireDelivery): SubscriptionDelivery | null {
    if (!knownDeliveryStatus(wire.status)) return null;

    return {
        id: wire.id,
        date: wire.delivery_date,
        status: wire.status,
        // Stored, never recomputed from `status` — the backend holds it as its own column with a
        // CHECK constraint tying the two together, and a second implementation of that rule here
        // would eventually disagree about whether somebody's twenty days became nineteen.
        consumed: wire.consumed,
        skipReason: mapSkipReason(wire.skip_reason),
        slotCode: wire.delivery_window_code ?? '',
    };
}

export function mapDeliveryAddress(
    wire: SubscriptionAddressRef | null | undefined,
): DeliveryAddress {
    return {
        label: wire?.label ?? '',
        line1: wire?.line_one ?? '',
        line2: wire?.line_two ?? null,
        // The projection names the gazetteer entry by identifier, not by name. Guessing one from
        // the identifier would be inventing a fact about where somebody lives.
        area: '',
        city: '',
        countryCode: '',
        instructions: wire?.directions ?? null,
    };
}

/**
 * The run that was bought, in the contract's closed vocabulary.
 *
 * Resolved from the duration's **own** day count and never from `balance_days_total`, which counts
 * delivery days: a four-week plan delivering five weekdays buys twenty of them, not twenty-eight.
 * A run this build cannot name rejects rather than rounds — the write it followed already
 * succeeded, so this is a display failure and says so, on the same terms an unformattable currency
 * is handled.
 */
function mapDuration(wire: WireSubscription): PlanDuration {
    const days = wire.duration?.days ?? null;
    const duration = days === null ? undefined : DURATION_BY_DAYS[days];

    if (duration === undefined) {
        throw new ApiError(
            apiFailure('server', {
                message:
                    'This subscription runs for a length this version of the app cannot name. ' +
                    'The change was saved; updating the app will show it correctly.',
                retryable: false,
            }),
        );
    }

    return duration;
}

/**
 * A customer's own subscription, whole.
 *
 * Every named fact comes from the projection the backend serves. The three it cannot serve —
 * `pausedUntil`, `dietClassifications`, `excludeAllergens` — are documented in the file header and
 * are honest absences rather than unfinished mapping.
 */
export function mapSubscription(wire: WireSubscription): Subscription {
    return {
        id: SubscriptionId.unsafe(wire.id),
        state: mapSubscriptionState(wire.status),
        configuration: {
            planId: SubscriptionPlanId.unsafe(wire.catalogue_item_id),
            variantId: PlanVariantId.unsafe(wire.catalogue_item_variant_id),
            duration: mapDuration(wire),
            startDate: wire.starts_on ?? '',
            deliveryWeekdays: wire.weekdays,
            slotCode: wire.delivery_window_code ?? '',
            address: mapDeliveryAddress(wire.delivery_address),
            // Not properties of a subscription — see the file header.
            dietClassifications: [],
            excludeAllergens: [],
            selectedMealIds: (wire.chosen_catalogue_item_ids ?? []).map((id) => MealId.unsafe(id)),
        },
        planName: wire.plan?.name ?? '',
        kitchenId: KitchenId.unsafe(wire.kitchen?.id ?? ''),
        weeklyPrice: money(wire.weekly_price_minor ?? 0, wire.currency_code),
        days: {
            total: wire.balance_days_total,
            consumed: wire.balance_days_consumed,
            remaining: wire.remaining_days,
        },
        nextDeliveryDate: wire.next_delivery_date,
        skippedDates: wire.skipped_dates ?? [],
        // Always null: a pause lasts until somebody resumes it, so there is no instant to report.
        pausedUntil: null,
        createdAt: wire.created_at ?? wire.captured_at,
        updatedAt: wire.updated_at ?? wire.created_at ?? wire.captured_at,
    };
}

/**
 * The refund, as a record rather than a payment.
 *
 * `reason` is the one value the backend's CHECK constraint admits and the contract types it as that
 * literal. The wire sends it as an open string; it is mapped to the literal rather than silently
 * widening the contract here.
 */
export function mapCreditMemo(wire: WireCreditMemo, subscriptionId: SubscriptionId): CreditMemo {
    return {
        id: wire.id,
        subscriptionId,
        reason: 'subscription_cancelled',
        unusedDays: wire.unused_days,
        perDayPrice: money(wire.per_day_minor, wire.currency_code),
        amount: money(wire.amount_minor, wire.currency_code),
        status: wire.status,
        settlement: 'manual',
        recordedAt: wire.recorded_at,
    };
}

export function mapMealChoice(wire: WireMealChoice, date: string): SubscriptionMealChoice {
    return {
        date,
        slot: wire.slot,
        mealId: MealId.unsafe(wire.catalogue_item_id),
        // Server-derived: the request has no field for a name and must not grow one.
        mealName: wire.name,
        source: wire.source,
    };
}

/** Refusal reasons this build can render. Anything else is dropped rather than shown as a code. */
function knownRefusal(value: string): value is SubscriptionQuoteRefusal {
    return (SUBSCRIPTION_QUOTE_REFUSALS as readonly string[]).includes(value);
}

/**
 * A quote nobody could give, drawn rather than thrown.
 *
 * `subscription.refused` reaches the client as a structured failure carrying `reasons` — the
 * machinery `api/failures.ts` builds — and this turns it back into the shape a configurator
 * expects: `available: false`, zero prices, and the reasons listed. The contract is explicit that
 * "this plan cannot be subscribed to for that duration" is something a configurator **draws**, not
 * something it crashes on, and this is the one place that translation happens.
 */
function refusedQuote(request: SubscriptionQuoteRequest, failure: ApiFailure): SubscriptionQuote {
    const refusals = isSubscriptionRefusalFailure(failure)
        ? failure.reasons
              .map((entry) => entry.reason)
              .filter((reason): reason is SubscriptionQuoteRefusal => knownRefusal(reason))
        : [];

    const nothing = money(0, REFUSAL_CURRENCY);

    return {
        planId: request.planId,
        variantId: request.variantId,
        duration: request.duration,
        available: false,
        availableWeekdays: [],
        days: 0,
        listPrice: nothing,
        discountPercent: 0,
        perDayPrice: nothing,
        total: nothing,
        allowsFreeSelection: false,
        changeCutoffHours: DEFAULT_CHANGE_CUTOFF_HOURS,
        refusals,
    };
}

/** The six S1 methods, built per bundle because they hold the transport. */
export interface ApiSubscriptionReads {
    getSubscriptionQuote(request: SubscriptionQuoteRequest): Promise<SubscriptionQuote>;
    getSubscriptionBalance(subscriptionId: SubscriptionId): Promise<SubscriptionBalance>;
    listSubscriptionDeliveries(
        subscriptionId: SubscriptionId,
        filter?: SubscriptionDeliveryFilter,
    ): Promise<CursorPage<SubscriptionDelivery>>;
    cancelSubscription(
        subscriptionId: SubscriptionId,
        request?: CancelSubscriptionRequest,
    ): Promise<SubscriptionCancellation>;
    setSubscriptionWeekdays(
        subscriptionId: SubscriptionId,
        request: SetSubscriptionWeekdaysRequest,
    ): Promise<Subscription>;
    setSubscriptionMealChoices(
        subscriptionId: SubscriptionId,
        request: SetSubscriptionMealChoicesRequest,
    ): Promise<readonly SubscriptionMealChoice[]>;
}

export function createApiSubscriptionReads(transport: Transport): ApiSubscriptionReads {
    function path(subscriptionId: SubscriptionId, suffix = ''): string {
        return `/me/subscriptions/${encodeURIComponent(String(subscriptionId))}${suffix}`;
    }

    return {
        /**
         * Availability and price for a proposed plan — the read that deletes the seven-probe hack.
         *
         * Three coordinates, and every one is a fact the public plan read already publishes. The
         * duration crosses as a **day count** rather than as the kitchen's own code, because the
         * contract's vocabulary is `1w | 2w | 4w | 12w` and the code is an authored slug: a client
         * holding `4w` can compute twenty-eight without a second read, and could not have guessed
         * `28d` or `monthly`.
         *
         * A refusal is a `409` on the wire and a *drawn* answer here — see {@link refusedQuote}.
         */
        async getSubscriptionQuote(request: SubscriptionQuoteRequest): Promise<SubscriptionQuote> {
            const query = new URLSearchParams({
                catalogue_item_id: String(request.planId),
                catalogue_item_variant_id: String(request.variantId),
                plan_duration_days: String(PLAN_DURATION_WEEKS[request.duration] * 7),
            });

            let wire: PlanQuoteEnvelope['data'];
            try {
                wire = await transport.request<PlanQuoteEnvelope['data']>({
                    method: 'GET',
                    path: `/subscriptions/quote?${query.toString()}`,
                });
            } catch (caught: unknown) {
                if (caught instanceof ApiError && caught.code === 'subscription.refused') {
                    return refusedQuote(request, caught.failure);
                }
                throw caught;
            }

            const quote = wire.quote;

            return {
                planId: request.planId,
                variantId: request.variantId,
                duration: request.duration,
                available: true,
                availableWeekdays: quote.available_weekdays,
                days: quote.days,
                listPrice: money(quote.list_price_minor, quote.currency_code),
                discountPercent: discountPercent(quote.discount_percent),
                perDayPrice: money(quote.per_day_minor, quote.currency_code),
                total: money(quote.total_minor, quote.currency_code),
                allowsFreeSelection: quote.allows_free_selection,
                changeCutoffHours: quote.change_cutoff_hours,
                refusals: [],
            };
        },

        /**
         * The balance.
         *
         * `GET /me/subscriptions/{subscription}` rather than a balance endpoint, because there is
         * no balance endpoint: the single read carries `balance` and the *list* deliberately omits
         * it, since counting a ledger per row would be an N+1 the server refuses to commit on the
         * client's behalf. A single read that arrived without one is a broken envelope rather than
         * an empty balance — answering zero days would tell somebody their plan is spent.
         */
        async getSubscriptionBalance(subscriptionId: SubscriptionId): Promise<SubscriptionBalance> {
            const data = await transport.request<SubscriptionEnvelope['data']>({
                method: 'GET',
                path: path(subscriptionId),
            });

            const balance = data.subscription.balance;
            if (balance === undefined) {
                throw new ApiError(
                    apiFailure('server', {
                        message: 'This subscription came back without its balance.',
                        retryable: true,
                    }),
                );
            }

            return mapSubscriptionBalance(
                balance,
                SubscriptionId.unsafe(data.subscription.id),
                // The plan's own cut-off, now that the projection carries it.
                data.subscription.change_cutoff_hours ?? DEFAULT_CHANGE_CUTOFF_HOURS,
            );
        },

        /**
         * The ledger.
         *
         * **Unpaginated on the wire, and answered as a single complete page.** The endpoint takes
         * no cursor and no limit — a subscription's ledger is bounded by the days it bought — so
         * `cursor` and `limit` on the filter are accepted and ignored rather than turned into query
         * parameters the server would reject. `hasMore` is `false` and `nextCursor` is `null`
         * because both are true: there is no second page.
         *
         * `statuses` is applied here for the same reason: the wire has no status filter, and a
         * filter silently dropped would show a person their skipped days on a screen that asked for
         * delivered ones. `totalCount` is `meta.count`, which is the server's count of the whole
         * ledger — so a filtered page honestly reports fewer items than the total it names.
         */
        async listSubscriptionDeliveries(
            subscriptionId: SubscriptionId,
            filter?: SubscriptionDeliveryFilter,
        ): Promise<CursorPage<SubscriptionDelivery>> {
            const envelope = await transport.requestEnvelope<
                SubscriptionDeliveriesEnvelope['data']
            >({ method: 'GET', path: path(subscriptionId, '/deliveries') });

            const wanted = filter?.statuses;
            const items = envelope.data
                .map(mapSubscriptionDelivery)
                .filter((delivery): delivery is SubscriptionDelivery => delivery !== null)
                .filter((delivery) => wanted === undefined || wanted.includes(delivery.status));

            const meta = envelope.meta as { count?: unknown } | null;
            const count = typeof meta?.count === 'number' ? meta.count : items.length;

            return { items, nextCursor: null, hasMore: false, totalCount: count };
        },

        /**
         * Cancellation — terminal, and it answers with the money.
         *
         * Both halves in one response because they are one fact: a dialog that had to make a second
         * request for the memo could not state its own consequence. `credit_memo` is `null` when
         * nothing is owed, which is not the same as a zero memo — a zero would be an obligation
         * somebody eventually tries to settle.
         *
         * **No `If-Match`.** The header is *honoured* on every subscription write and demanded by
         * none (`ReadsOptionalPrecondition`): a lost update needs two authors, and a subscription
         * has one. The contract carries no lock version to send, and fetching one first would
         * introduce the very race the header exists to prevent.
         */
        async cancelSubscription(
            subscriptionId: SubscriptionId,
            request?: CancelSubscriptionRequest,
        ): Promise<SubscriptionCancellation> {
            const data = await transport.request<SubscriptionCancellationEnvelope['data']>({
                method: 'POST',
                path: path(subscriptionId, '/cancel'),
                body:
                    request?.reason === undefined || request.reason === ''
                        ? {}
                        : { reason: request.reason },
            });

            return {
                subscription: mapSubscription(data.subscription),
                creditMemo:
                    data.credit_memo === null
                        ? null
                        : mapCreditMemo(
                              data.credit_memo,
                              SubscriptionId.unsafe(data.subscription.id),
                          ),
            };
        },

        /**
         * Re-plan the remaining ledger.
         *
         * Separate from a slot change, which moves the hour: a weekday change re-plans every
         * delivery that has not happened. Refused with `inside_cut_off` when it would touch a
         * delivery less than the plan's cut-off away, and that refusal carries the true
         * `cut_off_hours` and the `effective_from` the change *would* take — which is the
         * difference between "not allowed" and "not allowed until Thursday".
         */
        async setSubscriptionWeekdays(
            subscriptionId: SubscriptionId,
            request: SetSubscriptionWeekdaysRequest,
        ): Promise<Subscription> {
            const data = await transport.request<SubscriptionEnvelope['data']>({
                method: 'PUT',
                path: path(subscriptionId, '/weekdays'),
                body: { weekdays: [...request.deliveryWeekdays] },
            });

            return mapSubscription(data.subscription);
        },

        /**
         * Free Selection, choosing ahead of the cut-off.
         *
         * A **replace**, not a merge: the request carries the whole day, so "I no longer want a
         * second meal" is expressible. The answer is the day as it now stands — including the
         * `kitchen_default` rows nobody overrode — so the editor redraws from one response, and
         * every dish comes back named by the server.
         */
        async setSubscriptionMealChoices(
            subscriptionId: SubscriptionId,
            request: SetSubscriptionMealChoicesRequest,
        ): Promise<readonly SubscriptionMealChoice[]> {
            const data = await transport.request<SubscriptionChoicesEnvelope['data']>({
                method: 'PUT',
                path: path(subscriptionId, '/choices'),
                body: {
                    date: request.date,
                    meals: request.choices.map((choice) => ({
                        slot: choice.slot,
                        catalogue_item_id: String(choice.mealId),
                    })),
                },
            });

            return data.meals.map((meal) => mapMealChoice(meal, data.delivery_date));
        },
    };
}
