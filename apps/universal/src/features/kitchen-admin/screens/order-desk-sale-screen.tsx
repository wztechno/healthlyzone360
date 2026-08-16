import type {
    KitchenOrder,
    KitchenOrderPaymentMethod,
    LocalisedText,
    OrderDeskCustomer,
    OrderDeskFulfilmentType,
    OrderDeskQuote,
    OrderDeskQuoteLine,
    OrderDeskRefusal,
    OrderDeskSaleRequest,
    ServiceArea,
} from '@healthy360/api-client/contracts';
import { ORDER_DESK_FULFILMENT_TYPES } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Icon,
    IconButton,
    Inline,
    NumberStepper,
    SegmentedControl,
    Select,
    Skeleton,
    Stack,
    Stepper,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useAdminMealPageQuery,
    useProductPageQuery,
    useServiceAreasQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import {
    CUSTOMER_SEARCH_MIN_LENGTH,
    useAddOrderDeskCustomerAddressMutation,
    useCreateOrderDeskCustomerMutation,
    useOrderDeskCustomerSearchQuery,
    useOrderDeskQuoteQuery,
    usePlaceOrderDeskSaleMutation,
} from '../../../data/order-desk-hooks.ts';
import { useAccessState, useSession } from '../../../session/session-provider.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { ORDER_CREATE_ON_BEHALF_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { kitchenOrderStatusKey, kitchenOrderStatusTone } from '../ops-format.ts';
import type { BasketLine } from '../order-desk/basket.ts';
import {
    MAX_LINE_QUANTITY,
    addItem,
    basketKey,
    lineKey,
    quantityAsNumber,
    quantityFromNumber,
    removeLine,
    setQuantity,
    toWire,
} from '../order-desk/basket.ts';
import type { OrderDeskSaleStep, SaleWizardState } from '../order-desk/steps.ts';
import {
    FIRST_SALE_STEP,
    applicableSteps,
    canProceed,
    clampStep,
    initialSaleWizardState,
    nextStep,
    paymentMethodsFor,
    previousStep,
    stepProgress,
    withCustomer,
    withFulfilmentType,
} from '../order-desk/steps.ts';

/**
 * `/kitchen/order-desk/sale` — ringing up a counter, pickup or telephone sale.
 *
 * ## The shape of the thing
 *
 * Six steps, of which any one sale uses four or five: `order-desk/steps.ts` owns which, in what
 * order, and what each needs before it may be left. `Stepper` here is a **progress indicator only**
 * — it draws "Step 3 of 5" and knows nothing about validity — so back, next and the review's
 * completeness all read the machine rather than each other. The basket lives in
 * `order-desk/basket.ts`, aggregated by `(article, pack)` because that is how `order_lines` is keyed
 * and because the agent has to see the quantity they are about to charge for.
 *
 * ## Every price on this screen comes from the quote endpoint, and none of them is computed here
 *
 * The counter's tariff is resolved server-side through the desk channel's own price lists in
 * priority order, and there is no client-reachable read of that resolution. So the basket shows no
 * price until it has been quoted, the totals are the quote's own fields, and nothing multiplies a
 * unit price by a quantity locally — the wire rounds once at the line total precisely so that
 * rounding cannot compound, and a client that re-derived it would eventually disagree with the sale
 * it had just quoted. The quote is re-asked, debounced, on every change to the basket, the fulfilment
 * type or the destination, because all three change the answer.
 *
 * Refusals arrive on a `200` as **data**, not as errors: a line the desk channel does not offer
 * comes back priced `null` with `channel_unavailable` on it, and the agent needs the total of
 * everything else while they take that line off. Proceeding is gated on `quote.quotable`, which is
 * the server's own verdict and is never re-derived from "are there refusals?".
 *
 * ## What the picker can and cannot offer, and why
 *
 * There is **no endpoint that lists a sales channel's offerings with prices** — the catalogue family
 * carries no price by design, the channel-assignment resources are `PUT`-only, and the marketplace
 * listing is scoped to listing channels, which structurally excludes the counter. So the picker is
 * the kitchen's own **published catalogue** (`GET /catalogue/items`, meals and products) and the
 * quote is the price oracle. Two consequences are stated rather than hidden:
 *
 * 1. The picker shows **no price** until a line is in the basket. A number beside a picker row could
 *    only have been guessed, and a guessed price at a counter is one somebody reads out loud.
 * 2. An article published but **not offered on the desk channel** is listed and then refused inline
 *    with `channel_unavailable`. That is the honest failure: the alternative is a picker that
 *    silently omits things the kitchen believes it sells.
 *
 * **Packs are not offered in v1.** The wire addresses a pack by `catalogue_item_variant_id`, and the
 * catalogue listing exposes pack variants by `code` with no identifier — so this picker sells the
 * plain article, and the basket keys on `(article, pack)` anyway so that packs land as a picker
 * change rather than a rewrite.
 *
 * **A dedicated `order_desk_agent` does not hold `catalogue.view_organisation`**, so the picker's
 * read is a `403` for exactly the role this screen is named after. It renders as a failure with its
 * own retry rather than as an empty list; the fix is a grant or a desk-scoped catalogue read, and
 * both are somebody else's commit.
 *
 * ## Addresses are written, never chosen
 *
 * There is no operation on this surface that *lists* a customer's addresses — the desk may add one
 * and nothing else. So a delivery taken here writes the destination down as the caller gives it,
 * every time, and a returning customer gets a second copy of their own street. That is a real cost
 * and it is the wire's shape rather than a choice made here; it is stated in the step's own copy so
 * an agent is not surprised by it.
 *
 * ## The a11y rule the basket is built around
 *
 * A basket line is a `Card` with a quantity stepper and a remove button inside it. The card
 * therefore **must not** take `onPress`: nested interactive content is a serious axe violation and
 * would fail the a11y project outright (`design-system/src/content/card.tsx` carries the rule). The
 * picker rows follow it too — the card is inert and the `Add` button is the control.
 */

/**
 * How long the wizard waits before re-asking for a price.
 *
 * The house has no shared debounce hook and says so twice — the gazetteer picker filters locally
 * because it can, and the marketplace filter bar refuses one because its state is the URL. This
 * surface is the case those two are not: every basket change is a **`POST` to a pricing engine**,
 * and a stepper held down would be one request per repeat. Modelled on
 * `recipe-edit-screen.tsx`'s `useDebouncedRollupDraft`, which debounces a preview for the same
 * reason, and set slightly shorter because this number is being read out to somebody waiting.
 */
const QUOTE_DEBOUNCE_MS = 300;

/** The same wait for the customer search, which is a request per keystroke without it. */
const SEARCH_DEBOUNCE_MS = 300;

const EM_DASH = '—';

const FULFILMENT_LABEL_KEYS: Readonly<Record<OrderDeskFulfilmentType, string>> = {
    counter: 'kitchen:desk.sale.type.counter',
    pickup: 'kitchen:desk.sale.type.pickup',
    delivery: 'kitchen:desk.sale.type.delivery',
};

const STEP_LABEL_KEYS: Readonly<Record<OrderDeskSaleStep, string>> = {
    type: 'kitchen:desk.sale.step.type',
    customer: 'kitchen:desk.sale.step.customer',
    address: 'kitchen:desk.sale.step.address',
    basket: 'kitchen:desk.sale.step.basket',
    payment: 'kitchen:desk.sale.step.payment',
    review: 'kitchen:desk.sale.step.review',
};

const PAYMENT_METHOD_LABEL_KEYS: Readonly<Record<KitchenOrderPaymentMethod, string>> = {
    cash_on_delivery: 'kitchen:desk.sale.method.cashOnDelivery',
    cash_at_counter: 'kitchen:desk.sale.method.cashAtCounter',
    wish: 'kitchen:desk.sale.method.wish',
};

/**
 * A value that lags behind its source by `delayMs`.
 *
 * Two speeds, exactly as `useDebouncedRollupDraft` has: the first value lands immediately (there is
 * nothing to debounce about an empty basket becoming a basket), and every change after it waits. The
 * write happens in the timer callback, never in the effect body — the same rule
 * `online/online-status.tsx` follows.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [settled, setSettled] = useState(value);

    useEffect(() => {
        if (Object.is(settled, value)) return;
        const timer = setTimeout(() => {
            setSettled(value);
        }, delayMs);
        return () => {
            clearTimeout(timer);
        };
    }, [value, delayMs, settled]);

    return settled;
}

export function OrderDeskSaleScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_CREATE_ON_BEHALF_PERMISSION] }}
            testID="kitchen-order-desk-sale"
        >
            <SaleWizard />
        </Gate>
    );
}

/* ------------------------------------------------------------------------------------------------
 * The wizard
 * ---------------------------------------------------------------------------------------------- */

function SaleWizard() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const toast = useToast();

    const [state, setState] = useState<SaleWizardState>(initialSaleWizardState);
    const [step, setStep] = useState<OrderDeskSaleStep>(FIRST_SALE_STEP);
    /** The finished counter sale. Non-null puts the screen into its completed state. */
    const [completed, setCompleted] = useState<KitchenOrder | null>(null);

    const place = usePlaceOrderDeskSaleMutation();

    /*
     * What the quote is asked. `null` while there is nothing to price — an empty basket has no
     * total, and asking for one would spend a request to be told so.
     *
     * Memoised because this object *is* the query key: an equal-but-new object per render would be
     * a fresh cache entry per render, and for a POST that is a request per render.
     */
    const saleRequest = useMemo<OrderDeskSaleRequest | null>(() => {
        const lines = toWire(state.lines);
        if (lines.length === 0) return null;
        return {
            fulfilmentType: state.fulfilmentType,
            lines,
            ...(state.customerAccountId === null
                ? {}
                : { customerAccountId: state.customerAccountId }),
            ...(state.customerAddressId === null
                ? {}
                : { customerAddressId: state.customerAddressId }),
        };
    }, [state.lines, state.fulfilmentType, state.customerAccountId, state.customerAddressId]);

    const quotedRequest = useDebouncedValue(saleRequest, QUOTE_DEBOUNCE_MS);
    const quote = useOrderDeskQuoteQuery(quotedRequest);

    /**
     * The quote, or `null` when there is nothing to price.
     *
     * The hook keeps the previous answer through `placeholderData` so a total does not blank between
     * keystrokes — which is right while a basket is *changing* and wrong the moment it is **emptied**:
     * carrying the last answer onto an empty basket would leave a price on screen for a sale that no
     * longer has any lines, and an agent could read it out. So an absent request drops it here rather
     * than in the hook, where the placeholder is doing useful work.
     */
    const quoted = saleRequest === null ? null : (quote.data ?? null);

    /** True while the basket has moved on from the quote on screen. The total shown is stale. */
    const quoteStale = quotedRequest !== saleRequest || quote.isFetching;

    const steps = applicableSteps(state.fulfilmentType);
    const progress = stepProgress(state, step);
    const back = previousStep(state, step);
    const forward = nextStep(state, step);
    const quotable = quoted?.quotable === true;

    /**
     * Whether this step may be left.
     *
     * The machine answers the state half; the quote answers the rest. Basket and review both wait
     * on a *fresh* `quotable`, so an agent cannot walk past a basket whose price is still in
     * flight and then read out a number that changes under them.
     */
    function mayLeave(candidate: OrderDeskSaleStep): boolean {
        if (!canProceed(state, candidate)) return false;
        if (candidate === 'basket' || candidate === 'review') return quotable && !quoteStale;
        return true;
    }

    function update(next: SaleWizardState) {
        setState(next);
        // Changing the type can delete the step somebody is standing on. The machine says where
        // they land — the nearest step they had already reached, not the beginning.
        setStep((current) => clampStep(next, current));
        place.reset();
    }

    const placeFailure = toFailure(place.error);
    const refusalReasons =
        placeFailure?.code === 'order.placement_refused' ? placeFailure.reasons : [];

    function onPlace() {
        const lines = toWire(state.lines);
        if (lines.length === 0) return;

        place.mutate(
            {
                fulfilmentType: state.fulfilmentType,
                lines,
                paymentMethod: state.paymentMethod,
                ...(state.customerAccountId === null
                    ? {}
                    : { customerAccountId: state.customerAccountId }),
                ...(state.customerAddressId === null
                    ? {}
                    : { customerAddressId: state.customerAddressId }),
                ...(state.fulfilmentType === 'counter' && state.payment !== null
                    ? {
                          payment: {
                              method: state.payment.method,
                              ...(state.payment.reference.trim() === ''
                                  ? {}
                                  : { reference: state.payment.reference.trim() }),
                              ...(state.payment.notes.trim() === ''
                                  ? {}
                                  : { notes: state.payment.notes.trim() }),
                          },
                      }
                    : {}),
            },
            {
                onSuccess: (order) => {
                    if (state.fulfilmentType === 'counter') {
                        // Nothing left to do: the wire performed place → confirm → receipt → fulfil
                        // in one transaction, so the screen shows a finished sale rather than
                        // sending somebody to a queue the order is not in.
                        setCompleted(order);
                        return;
                    }
                    toast.show({
                        testID: 'kitchen-order-desk-sale-placed-toast',
                        tone: 'success',
                        message: t('kitchen:desk.sale.placedToast', { number: order.orderNumber }),
                    });
                    router.replace('/kitchen/order-desk');
                },
            },
        );
    }

    function startAgain() {
        setCompleted(null);
        setState(initialSaleWizardState());
        setStep(FIRST_SALE_STEP);
        place.reset();
    }

    if (completed !== null) {
        return <CompletedSale order={completed} onNewSale={startAgain} />;
    }

    return (
        <Stack space="lg" testID="kitchen-order-desk-sale-screen">
            <Stack space="xs">
                <Heading level={1} testID="kitchen-order-desk-sale-title">
                    {t('kitchen:desk.sale.title')}
                </Heading>
                <Text tone="secondary" testID="kitchen-order-desk-sale-subtitle">
                    {t('kitchen:desk.sale.subtitle')}
                </Text>
            </Stack>

            <Stepper
                testID="kitchen-order-desk-sale-stepper"
                label={t('kitchen:desk.sale.progressLabel')}
                current={progress.position}
                total={progress.total}
                stepLabel={t(STEP_LABEL_KEYS[step])}
            />

            {step === 'type' ? (
                <TypeStep
                    state={state}
                    onChange={(type) => {
                        update(withFulfilmentType(state, type));
                    }}
                />
            ) : null}

            {step === 'customer' ? (
                <CustomerStep
                    state={state}
                    onChoose={(customer) => {
                        update(withCustomer(state, customer.id));
                    }}
                />
            ) : null}

            {step === 'address' ? (
                <AddressStep
                    state={state}
                    onSaved={(addressId) => {
                        update({ ...state, customerAddressId: addressId });
                    }}
                />
            ) : null}

            {step === 'basket' ? (
                <BasketStep
                    state={state}
                    quote={quoted}
                    quoteStale={quoteStale}
                    quoteFailed={toFailure(quote.error) !== null}
                    onLines={(lines) => {
                        update({ ...state, lines });
                    }}
                />
            ) : null}

            {step === 'payment' ? (
                <PaymentStep
                    state={state}
                    onChange={(payment) => {
                        update({ ...state, payment, paymentMethod: payment.method });
                    }}
                />
            ) : null}

            {step === 'review' ? (
                <ReviewStep
                    state={state}
                    quote={quoted}
                    quoteStale={quoteStale}
                    onMethod={(method) => {
                        update({ ...state, paymentMethod: method });
                    }}
                />
            ) : null}

            {placeFailure === null ? null : (
                <Callout
                    testID="kitchen-order-desk-sale-refusal"
                    tone="warning"
                    role="alert"
                    title={t('kitchen:desk.sale.refusedTitle')}
                    body={
                        refusalReasons.length === 0 ? t('kitchen:desk.sale.refusedBody') : undefined
                    }
                >
                    {refusalReasons.length === 0 ? null : (
                        <Stack space="xs" testID="kitchen-order-desk-sale-refusal-reasons">
                            {/*
                             * Every reason, never just the first: one sentence saying the order
                             * could not be placed sends an agent back to a basket with nothing to
                             * change. A reason this build has no copy for still appears, as the
                             * server's own code — a refusal nobody has translated yet is still a
                             * fact about somebody's dinner.
                             */}
                            {refusalReasons.map((entry) => (
                                <Text
                                    key={entry.reason}
                                    variant="caption"
                                    testID={`kitchen-order-desk-sale-refusal-${entry.reason}`}
                                >
                                    {`• ${t(`kitchen:desk.refusal.${entry.reason}`, {
                                        defaultValue: entry.reason,
                                    })}`}
                                </Text>
                            ))}
                        </Stack>
                    )}
                </Callout>
            )}

            <Inline space="sm" wrap testID="kitchen-order-desk-sale-navigation">
                <Button
                    testID="kitchen-order-desk-sale-back"
                    variant="quiet"
                    label={t('kitchen:desk.sale.back')}
                    disabled={back === null || place.isPending}
                    onPress={() => {
                        if (back !== null) setStep(back);
                    }}
                />
                {step === 'review' ? (
                    <Button
                        testID="kitchen-order-desk-sale-submit"
                        label={t(
                            state.fulfilmentType === 'counter'
                                ? 'kitchen:desk.sale.complete'
                                : 'kitchen:desk.sale.place',
                        )}
                        loading={place.isPending}
                        disabled={!mayLeave('review')}
                        onPress={onPlace}
                    />
                ) : (
                    <Button
                        testID="kitchen-order-desk-sale-next"
                        label={t('kitchen:desk.sale.next')}
                        disabled={forward === null || !mayLeave(step)}
                        onPress={() => {
                            if (forward !== null) setStep(forward);
                        }}
                    />
                )}
                <Text tone="secondary" variant="caption" testID="kitchen-order-desk-sale-position">
                    {t('kitchen:desk.sale.position', {
                        current: formatter.formatNumber(progress.position),
                        total: formatter.formatNumber(steps.length),
                    })}
                </Text>
            </Inline>
        </Stack>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Step 1 — what kind of sale
 * ---------------------------------------------------------------------------------------------- */

function TypeStep({
    state,
    onChange,
}: {
    readonly state: SaleWizardState;
    readonly onChange: (type: OrderDeskFulfilmentType) => void;
}) {
    const { t } = useTranslation();

    return (
        <Card tone="raised" padding="md" testID="kitchen-order-desk-sale-type">
            <Stack space="sm">
                <SegmentedControl<OrderDeskFulfilmentType>
                    testID="kitchen-order-desk-sale-type-control"
                    label={t('kitchen:desk.sale.typeLabel')}
                    block
                    value={state.fulfilmentType}
                    onChange={onChange}
                    items={ORDER_DESK_FULFILMENT_TYPES.map((candidate) => ({
                        value: candidate,
                        label: t(FULFILMENT_LABEL_KEYS[candidate]),
                        testID: `kitchen-order-desk-sale-type-${candidate}`,
                    }))}
                />
                <Text tone="secondary" testID="kitchen-order-desk-sale-type-hint">
                    {t(`kitchen:desk.sale.typeHint.${state.fulfilmentType}`)}
                </Text>
            </Stack>
        </Card>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Step 2 — who it is for
 * ---------------------------------------------------------------------------------------------- */

function CustomerStep({
    state,
    onChoose,
}: {
    readonly state: SaleWizardState;
    readonly onChoose: (customer: OrderDeskCustomer) => void;
}) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [chosen, setChosen] = useState<OrderDeskCustomer | null>(null);

    const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
    const search = useOrderDeskCustomerSearchQuery(debounced);
    const create = useCreateOrderDeskCustomerMutation();

    const searchFailure = toFailure(search.error);
    const createFailure = toFailure(create.error);
    const tooShort = debounced.length > 0 && debounced.length < CUSTOMER_SEARCH_MIN_LENGTH;
    const rows = search.data?.rows ?? [];

    function choose(customer: OrderDeskCustomer) {
        setChosen(customer);
        onChoose(customer);
    }

    return (
        <Card tone="raised" padding="md" testID="kitchen-order-desk-sale-customer">
            <Stack space="md">
                {state.customerAccountId === null || chosen === null ? null : (
                    <Callout
                        testID="kitchen-order-desk-sale-customer-chosen"
                        tone="success"
                        role="status"
                        title={chosen.displayName ?? t('kitchen:desk.sale.customerUnnamed')}
                        body={chosen.phone ?? undefined}
                    />
                )}

                <TextInputField
                    testID="kitchen-order-desk-sale-customer-search"
                    id="kitchen-order-desk-sale-customer-search"
                    label={t('kitchen:desk.sale.customerSearchLabel')}
                    placeholder={t('kitchen:desk.sale.customerSearchPlaceholder')}
                    hint={t('kitchen:desk.sale.customerSearchHint', {
                        count: CUSTOMER_SEARCH_MIN_LENGTH,
                    })}
                    value={query}
                    onChangeText={setQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    inputMode="search"
                    returnKeyType="search"
                    trailing={<Icon name="search" />}
                />

                {tooShort ? (
                    // A hint, not an error: the first two letters of a name are somebody typing,
                    // not somebody doing it wrong. The server would answer 422; this never asks.
                    <Text
                        variant="caption"
                        tone="secondary"
                        role="status"
                        testID="kitchen-order-desk-sale-customer-too-short"
                    >
                        {t('kitchen:desk.sale.customerSearchTooShort', {
                            count: CUSTOMER_SEARCH_MIN_LENGTH,
                        })}
                    </Text>
                ) : null}

                {search.isFetching ? (
                    <Skeleton
                        testID="kitchen-order-desk-sale-customer-loading"
                        heightClassName="h-5"
                    />
                ) : searchFailure !== null ? (
                    <ErrorState
                        testID="kitchen-order-desk-sale-customer-error"
                        title={t('kitchen:desk.sale.customerSearchErrorTitle')}
                        failure={searchFailure}
                        onRetry={() => {
                            void search.refetch();
                        }}
                        retrying={search.isFetching}
                    />
                ) : rows.length > 0 ? (
                    <Stack space="sm" testID="kitchen-order-desk-sale-customer-results">
                        {rows.map((row) => (
                            // The card is inert and the button is the control: a pressable card
                            // wrapping a button is nested-interactive, which axe reports as serious.
                            <Card
                                key={row.id}
                                padding="sm"
                                testID={`kitchen-order-desk-sale-customer-${row.id}`}
                            >
                                <Inline space="sm" align="center" wrap>
                                    <Stack space="none">
                                        <Text variant="bodyStrong">
                                            {row.displayName ??
                                                t('kitchen:desk.sale.customerUnnamed')}
                                        </Text>
                                        <Text variant="caption" tone="secondary">
                                            {row.phone ?? EM_DASH}
                                        </Text>
                                    </Stack>
                                    {row.hasOrdersWithOrg ? (
                                        <Badge
                                            tone="info"
                                            label={t('kitchen:desk.sale.customerRegular')}
                                        />
                                    ) : null}
                                    <Button
                                        testID={`kitchen-order-desk-sale-customer-${row.id}-choose`}
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:desk.sale.customerChoose')}
                                        onPress={() => {
                                            choose(row);
                                        }}
                                    />
                                </Inline>
                            </Card>
                        ))}
                        {rows.length >= (search.data?.limit ?? Number.POSITIVE_INFINITY) ? (
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID="kitchen-order-desk-sale-customer-capped"
                            >
                                {t('kitchen:desk.sale.customerCapped', {
                                    limit: search.data?.limit ?? 0,
                                })}
                            </Text>
                        ) : null}
                    </Stack>
                ) : debounced.length >= CUSTOMER_SEARCH_MIN_LENGTH ? (
                    <EmptyState
                        testID="kitchen-order-desk-sale-customer-empty"
                        title={t('kitchen:desk.sale.customerNoneTitle')}
                        body={t('kitchen:desk.sale.customerNoneBody')}
                    />
                ) : null}

                {creating ? (
                    <Stack space="sm" testID="kitchen-order-desk-sale-customer-form">
                        <Heading level={3}>{t('kitchen:desk.sale.customerCreateTitle')}</Heading>
                        <TextInputField
                            testID="kitchen-order-desk-sale-customer-name"
                            id="kitchen-order-desk-sale-customer-name"
                            label={t('kitchen:desk.sale.customerNameLabel')}
                            hint={t('kitchen:desk.sale.customerNameHint')}
                            required
                            value={name}
                            onChangeText={setName}
                        />
                        <TextInputField
                            testID="kitchen-order-desk-sale-customer-phone"
                            id="kitchen-order-desk-sale-customer-phone"
                            label={t('kitchen:desk.sale.customerPhoneLabel')}
                            hint={t('kitchen:desk.sale.customerPhoneHint')}
                            placeholder="+9613000111"
                            required
                            value={phone}
                            onChangeText={setPhone}
                            autoCapitalize="none"
                            autoCorrect={false}
                            inputMode="tel"
                        />

                        {createFailure === null ? null : (
                            <Text
                                tone="danger"
                                testID="kitchen-order-desk-sale-customer-create-error"
                            >
                                {createFailure.message}
                            </Text>
                        )}

                        {create.data === undefined ||
                        create.data.possibleDuplicates.length === 0 ? null : (
                            <Callout
                                testID="kitchen-order-desk-sale-customer-duplicates"
                                tone="warning"
                                role="status"
                                title={t('kitchen:desk.sale.customerDuplicatesTitle')}
                                body={t('kitchen:desk.sale.customerDuplicatesBody')}
                            >
                                <Stack space="xs">
                                    {create.data.possibleDuplicates.map((duplicate) => (
                                        <Inline
                                            key={duplicate.id}
                                            space="sm"
                                            align="center"
                                            wrap
                                            testID={`kitchen-order-desk-sale-customer-duplicate-${duplicate.id}`}
                                        >
                                            <Text variant="caption">
                                                {`${
                                                    duplicate.displayName ??
                                                    t('kitchen:desk.sale.customerUnnamed')
                                                } · ${duplicate.phone ?? EM_DASH}`}
                                            </Text>
                                            <Button
                                                testID={`kitchen-order-desk-sale-customer-duplicate-${duplicate.id}-choose`}
                                                size="sm"
                                                variant="secondary"
                                                label={t('kitchen:desk.sale.customerUseInstead')}
                                                onPress={() => {
                                                    choose(duplicate);
                                                }}
                                            />
                                        </Inline>
                                    ))}
                                </Stack>
                            </Callout>
                        )}

                        <Inline space="sm" wrap>
                            <Button
                                testID="kitchen-order-desk-sale-customer-create"
                                label={t('kitchen:desk.sale.customerCreate')}
                                loading={create.isPending}
                                disabled={name.trim() === '' || phone.trim() === ''}
                                onPress={() => {
                                    create.mutate(
                                        { displayName: name.trim(), phone: phone.trim() },
                                        {
                                            onSuccess: (result) => {
                                                // Chosen immediately: the agent typed this person's
                                                // details, so making them then pick the row they
                                                // just created would be a step that answers nothing.
                                                // The duplicate warning stays on screen beside it.
                                                choose(result.customer);
                                            },
                                        },
                                    );
                                }}
                            />
                            <Button
                                testID="kitchen-order-desk-sale-customer-cancel"
                                variant="quiet"
                                label={t('kitchen:desk.sale.customerCancelCreate')}
                                onPress={() => {
                                    setCreating(false);
                                }}
                            />
                        </Inline>
                    </Stack>
                ) : (
                    <Button
                        testID="kitchen-order-desk-sale-customer-new"
                        variant="secondary"
                        label={t('kitchen:desk.sale.customerNew')}
                        onPress={() => {
                            setCreating(true);
                        }}
                    />
                )}
            </Stack>
        </Card>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Step 3 — where it goes
 * ---------------------------------------------------------------------------------------------- */

/**
 * The country whose gazetteer this desk may write addresses in, from the session.
 *
 * The area table is a *platform* table spanning every market the platform has opened, and an
 * unscoped picker would offer an agent hundreds of places their kitchen can never deliver to. Read
 * from `me()`'s membership exactly as the delivery-zone editor reads it — `null` when no membership
 * answers the context, which the surrounding organisation gate makes unreachable here.
 */
function useOrganisationCountry(): string | null {
    const access = useAccessState();
    const { me } = useSession();
    const membershipId = access.organisation?.membershipId;

    return useMemo(() => {
        if (membershipId === undefined) return null;
        const membership = me?.memberships.find((candidate) => candidate.id === membershipId);
        return membership?.organisation.countryCode ?? null;
    }, [me, membershipId]);
}

function AddressStep({
    state,
    onSaved,
}: {
    readonly state: SaleWizardState;
    readonly onSaved: (addressId: string) => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const country = useOrganisationCountry();
    const gazetteer = useServiceAreasQuery(country);
    const save = useAddOrderDeskCustomerAddressMutation();

    const [areaId, setAreaId] = useState<string | null>(null);
    const [label, setLabel] = useState('');
    const [lineOne, setLineOne] = useState('');
    const [lineTwo, setLineTwo] = useState('');
    const [building, setBuilding] = useState('');
    const [directions, setDirections] = useState('');

    const saveFailure = toFailure(save.error);
    const saved = save.data ?? null;

    const options = useMemo(
        () =>
            (gazetteer.data?.areas ?? []).map((area: ServiceArea) => ({
                value: String(area.id),
                label: displayName(area.name, locale).value,
                // The governorate under the name, because two districts share a name often enough
                // that the picker has to say which one it means.
                ...(area.parentName === null
                    ? {}
                    : { description: displayName(area.parentName, locale).value }),
            })),
        [gazetteer.data, locale],
    );

    return (
        <Card tone="raised" padding="md" testID="kitchen-order-desk-sale-address">
            <Stack space="md">
                <Callout
                    testID="kitchen-order-desk-sale-address-note"
                    tone="info"
                    role="note"
                    title={t('kitchen:desk.sale.addressNoteTitle')}
                    body={t('kitchen:desk.sale.addressNoteBody')}
                />

                <Select
                    testID="kitchen-order-desk-sale-address-area"
                    label={t('kitchen:desk.sale.areaLabel')}
                    hint={t('kitchen:desk.sale.areaHint')}
                    placeholder={t('kitchen:desk.sale.areaPlaceholder')}
                    searchable
                    required
                    disabled={gazetteer.isPending || options.length === 0}
                    value={areaId}
                    options={options}
                    onChange={setAreaId}
                />

                <TextInputField
                    testID="kitchen-order-desk-sale-address-line-one"
                    id="kitchen-order-desk-sale-address-line-one"
                    label={t('kitchen:desk.sale.lineOneLabel')}
                    required
                    value={lineOne}
                    onChangeText={setLineOne}
                />
                <TextInputField
                    testID="kitchen-order-desk-sale-address-line-two"
                    id="kitchen-order-desk-sale-address-line-two"
                    label={t('kitchen:desk.sale.lineTwoLabel')}
                    value={lineTwo}
                    onChangeText={setLineTwo}
                />
                <TextInputField
                    testID="kitchen-order-desk-sale-address-building"
                    id="kitchen-order-desk-sale-address-building"
                    label={t('kitchen:desk.sale.buildingLabel')}
                    value={building}
                    onChangeText={setBuilding}
                />
                <TextInputField
                    testID="kitchen-order-desk-sale-address-label"
                    id="kitchen-order-desk-sale-address-label"
                    label={t('kitchen:desk.sale.addressLabelLabel')}
                    value={label}
                    onChangeText={setLabel}
                />
                <TextInputField
                    testID="kitchen-order-desk-sale-address-directions"
                    id="kitchen-order-desk-sale-address-directions"
                    label={t('kitchen:desk.sale.directionsLabel')}
                    hint={t('kitchen:desk.sale.directionsHint')}
                    multiline
                    value={directions}
                    onChangeText={setDirections}
                />

                {saveFailure === null ? null : (
                    <Text tone="danger" testID="kitchen-order-desk-sale-address-error">
                        {saveFailure.message}
                    </Text>
                )}

                {saved === null ? null : saved.isDeliverable ? (
                    <Callout
                        testID="kitchen-order-desk-sale-address-saved"
                        tone="success"
                        role="status"
                        title={t('kitchen:desk.sale.addressSavedTitle')}
                        body={saved.lineOne}
                    />
                ) : (
                    // A warning rather than a block: the address is real and saved, and whether a
                    // zone covers it is the *quote's* answer — which arrives as `area_not_served`
                    // with the sentence the agent reads out to the customer.
                    <Callout
                        testID="kitchen-order-desk-sale-address-undeliverable"
                        tone="warning"
                        role="alert"
                        title={t('kitchen:desk.sale.addressUndeliverableTitle')}
                        body={t('kitchen:desk.sale.addressUndeliverableBody')}
                    />
                )}

                <Button
                    testID="kitchen-order-desk-sale-address-save"
                    label={t('kitchen:desk.sale.addressSave')}
                    loading={save.isPending}
                    disabled={
                        areaId === null || lineOne.trim() === '' || state.customerAccountId === null
                    }
                    onPress={() => {
                        if (areaId === null || state.customerAccountId === null) return;
                        save.mutate(
                            {
                                customerAccountId: state.customerAccountId,
                                deliveryAreaId: areaId,
                                lineOne: lineOne.trim(),
                                ...(lineTwo.trim() === '' ? {} : { lineTwo: lineTwo.trim() }),
                                ...(building.trim() === '' ? {} : { building: building.trim() }),
                                ...(label.trim() === '' ? {} : { label: label.trim() }),
                                ...(directions.trim() === ''
                                    ? {}
                                    : { directions: directions.trim() }),
                            },
                            {
                                onSuccess: (address) => {
                                    onSaved(address.id);
                                },
                            },
                        );
                    }}
                />
            </Stack>
        </Card>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Step 4 — the basket
 * ---------------------------------------------------------------------------------------------- */

/** One thing the picker can add: an article, with the name to show while the quote is in flight. */
interface PickerRow {
    readonly id: string;
    readonly name: LocalisedText;
    readonly kind: 'meal' | 'product';
}

function BasketStep({
    state,
    quote,
    quoteStale,
    quoteFailed,
    onLines,
}: {
    readonly state: SaleWizardState;
    readonly quote: OrderDeskQuote | null;
    readonly quoteStale: boolean;
    readonly quoteFailed: boolean;
    readonly onLines: (lines: readonly BasketLine[]) => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const [query, setQuery] = useState('');
    const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

    /*
     * Published only, and both kinds. `statuses` survives the repository's filter only as a
     * single-entry array, which is exactly what is wanted here: a desk sells what is on sale.
     */
    const filter = useMemo(
        () => ({
            statuses: ['published'] as const,
            ...(debounced === '' ? {} : { query: debounced }),
        }),
        [debounced],
    );

    const meals = useAdminMealPageQuery(filter, 1);
    const products = useProductPageQuery(filter, 1);

    const pickerFailure = toFailure(meals.error) ?? toFailure(products.error);
    const loading = meals.isPending || products.isPending;

    const rows = useMemo<readonly PickerRow[]>(
        () => [
            ...(meals.data?.items ?? []).map((row) => ({
                id: String(row.id),
                name: row.name,
                kind: 'meal' as const,
            })),
            ...(products.data?.items ?? []).map((row) => ({
                id: String(row.id),
                name: row.name,
                kind: 'product' as const,
            })),
        ],
        [meals.data, products.data],
    );

    /** The quote's own line for a basket row, once one exists. Keyed on the pair, like the basket. */
    const quotedByKey = useMemo(() => {
        const map = new Map<string, OrderDeskQuoteLine>();
        for (const line of quote?.lines ?? []) {
            map.set(basketKey(line.catalogueItemId, line.catalogueItemVariantId), line);
        }
        return map;
    }, [quote]);

    return (
        <Stack space="md" testID="kitchen-order-desk-sale-basket">
            <Card tone="raised" padding="md" testID="kitchen-order-desk-sale-picker">
                <Stack space="sm">
                    <Heading level={3}>{t('kitchen:desk.sale.pickerTitle')}</Heading>
                    <Text tone="secondary" variant="caption">
                        {t('kitchen:desk.sale.pickerNote')}
                    </Text>
                    <TextInputField
                        testID="kitchen-order-desk-sale-picker-search"
                        id="kitchen-order-desk-sale-picker-search"
                        label={t('kitchen:desk.sale.pickerSearchLabel')}
                        placeholder={t('kitchen:desk.sale.pickerSearchPlaceholder')}
                        value={query}
                        onChangeText={setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                        inputMode="search"
                        trailing={<Icon name="search" />}
                    />

                    {loading ? (
                        <Skeleton
                            testID="kitchen-order-desk-sale-picker-loading"
                            heightClassName="h-5"
                        />
                    ) : pickerFailure !== null ? (
                        <ErrorState
                            testID="kitchen-order-desk-sale-picker-error"
                            title={t('kitchen:desk.sale.pickerErrorTitle')}
                            failure={pickerFailure}
                            onRetry={() => {
                                void meals.refetch();
                                void products.refetch();
                            }}
                            retrying={meals.isFetching || products.isFetching}
                        />
                    ) : rows.length === 0 ? (
                        <EmptyState
                            testID="kitchen-order-desk-sale-picker-empty"
                            title={t('kitchen:desk.sale.pickerEmptyTitle')}
                            body={t('kitchen:desk.sale.pickerEmptyBody')}
                        />
                    ) : (
                        <Stack space="xs" testID="kitchen-order-desk-sale-picker-rows">
                            {rows.map((row) => (
                                <Card
                                    key={`${row.kind}-${row.id}`}
                                    padding="sm"
                                    testID={`kitchen-order-desk-sale-picker-${row.id}`}
                                >
                                    <Inline space="sm" align="center" wrap>
                                        <Text variant="bodyStrong">
                                            {displayName(row.name, locale).value}
                                        </Text>
                                        <Badge
                                            tone="neutral"
                                            label={t(`kitchen:desk.sale.itemKind.${row.kind}`)}
                                        />
                                        <Button
                                            testID={`kitchen-order-desk-sale-picker-${row.id}-add`}
                                            size="sm"
                                            variant="secondary"
                                            label={t('kitchen:desk.sale.pickerAdd')}
                                            onPress={() => {
                                                onLines(
                                                    addItem(state.lines, {
                                                        catalogueItemId: row.id,
                                                        catalogueItemVariantId: null,
                                                        name: row.name,
                                                        variantLabel: null,
                                                    }),
                                                );
                                            }}
                                        />
                                    </Inline>
                                </Card>
                            ))}
                        </Stack>
                    )}
                </Stack>
            </Card>

            <Card tone="raised" padding="md" testID="kitchen-order-desk-sale-lines">
                <Stack space="sm">
                    <Heading level={3}>{t('kitchen:desk.sale.basketTitle')}</Heading>

                    {state.lines.length === 0 ? (
                        <EmptyState
                            testID="kitchen-order-desk-sale-basket-empty"
                            title={t('kitchen:desk.sale.basketEmptyTitle')}
                            body={t('kitchen:desk.sale.basketEmptyBody')}
                        />
                    ) : (
                        state.lines.map((line) => {
                            const key = lineKey(line);
                            const quoted = quotedByKey.get(key) ?? null;
                            return (
                                // No `onPress` on this card: it holds a stepper and a remove
                                // button, and a pressable card around them is nested-interactive.
                                <Card
                                    key={key}
                                    padding="sm"
                                    testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}`}
                                >
                                    <Stack space="xs">
                                        <Inline space="sm" align="center" wrap>
                                            <Text variant="bodyStrong">
                                                {displayName(line.name, locale).value}
                                            </Text>
                                            <Text
                                                variant="bodyStrong"
                                                testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-total`}
                                            >
                                                {quoted?.lineTotalMinor === null ||
                                                quoted === null ||
                                                quote === null
                                                    ? EM_DASH
                                                    : formatMoney(formatter, {
                                                          amount: quoted.lineTotalMinor,
                                                          currency: quoted.currencyCode,
                                                      })}
                                            </Text>
                                        </Inline>

                                        <Inline space="sm" align="center" wrap>
                                            <NumberStepper
                                                testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-quantity`}
                                                label={t('kitchen:desk.sale.quantityLabel', {
                                                    item: displayName(line.name, locale).value,
                                                })}
                                                value={quantityAsNumber(line.quantity)}
                                                min={1}
                                                max={MAX_LINE_QUANTITY}
                                                step={1}
                                                onChange={(next) => {
                                                    onLines(
                                                        setQuantity(
                                                            state.lines,
                                                            key,
                                                            quantityFromNumber(next),
                                                        ),
                                                    );
                                                }}
                                            />
                                            <IconButton
                                                testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-remove`}
                                                icon={<Icon name="close" />}
                                                variant="quiet"
                                                label={t('kitchen:desk.sale.removeLine', {
                                                    item: displayName(line.name, locale).value,
                                                })}
                                                onPress={() => {
                                                    onLines(removeLine(state.lines, key));
                                                }}
                                            />
                                        </Inline>

                                        {(quoted?.refusals ?? []).length === 0 ? null : (
                                            <Stack
                                                space="none"
                                                testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-refusals`}
                                            >
                                                {(quoted?.refusals ?? []).map((refusal) => (
                                                    <Text
                                                        key={refusal.reason}
                                                        variant="caption"
                                                        tone="danger"
                                                    >
                                                        {t(
                                                            `kitchen:desk.refusal.${refusal.reason}`,
                                                            { defaultValue: refusal.reason },
                                                        )}
                                                    </Text>
                                                ))}
                                            </Stack>
                                        )}
                                    </Stack>
                                </Card>
                            );
                        })
                    )}

                    <QuoteTotals
                        quote={quote}
                        stale={quoteStale}
                        failed={quoteFailed}
                        testID="kitchen-order-desk-sale-basket-totals"
                    />
                </Stack>
            </Card>
        </Stack>
    );
}

/* ------------------------------------------------------------------------------------------------
 * The totals, shared by the basket and the review
 * ---------------------------------------------------------------------------------------------- */

function QuoteTotals({
    quote,
    stale,
    failed,
    testID,
}: {
    readonly quote: OrderDeskQuote | null;
    readonly stale: boolean;
    readonly failed: boolean;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    if (failed) {
        return (
            <Callout
                testID={`${testID}-error`}
                tone="danger"
                role="alert"
                title={t('kitchen:desk.sale.quoteErrorTitle')}
                body={t('kitchen:desk.sale.quoteErrorBody')}
            />
        );
    }

    if (quote === null) {
        return (
            <Text tone="secondary" variant="caption" testID={`${testID}-none`}>
                {t('kitchen:desk.sale.noQuoteYet')}
            </Text>
        );
    }

    const money = (amount: number) =>
        formatMoney(formatter, { amount, currency: quote.currencyCode });

    return (
        <Stack space="xs" testID={testID}>
            <Inline space="sm" justify="between" wrap>
                <Text tone="secondary">{t('kitchen:desk.sale.subtotal')}</Text>
                <Text testID={`${testID}-subtotal`}>{money(quote.subtotalMinor)}</Text>
            </Inline>

            {/*
             * Null and zero are different facts: zero is a fee somebody decided on — a free-delivery
             * zone — and a counter sale has no fee at all. Printing "Delivery: 0.00" on a walk-in
             * would be inventing a line the order does not have.
             */}
            {quote.deliveryFeeMinor === null ? null : (
                <Inline space="sm" justify="between" wrap>
                    <Text tone="secondary">{t('kitchen:desk.sale.deliveryFee')}</Text>
                    <Text testID={`${testID}-fee`}>{money(quote.deliveryFeeMinor)}</Text>
                </Inline>
            )}

            <Inline space="sm" justify="between" wrap>
                <Text variant="bodyStrong">{t('kitchen:desk.sale.total')}</Text>
                <Text variant="bodyStrong" testID={`${testID}-total`}>
                    {money(quote.totalMinor)}
                </Text>
            </Inline>

            {stale ? (
                <Text variant="caption" tone="secondary" role="status" testID={`${testID}-stale`}>
                    {t('kitchen:desk.sale.quoteUpdating')}
                </Text>
            ) : null}

            {quote.refusals.length === 0 ? null : (
                <Callout
                    testID={`${testID}-refusals`}
                    tone="warning"
                    role="alert"
                    title={t('kitchen:desk.sale.orderRefusalsTitle')}
                >
                    <Stack space="none">
                        {quote.refusals.map((refusal: OrderDeskRefusal) => (
                            <Text
                                key={refusal.reason}
                                variant="caption"
                                testID={`${testID}-refusal-${refusal.reason}`}
                            >
                                {t(`kitchen:desk.refusal.${refusal.reason}`, {
                                    defaultValue: refusal.reason,
                                })}
                            </Text>
                        ))}
                    </Stack>
                </Callout>
            )}
        </Stack>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Step 5 — the money at the till
 * ---------------------------------------------------------------------------------------------- */

function PaymentStep({
    state,
    onChange,
}: {
    readonly state: SaleWizardState;
    readonly onChange: (payment: NonNullable<SaleWizardState['payment']>) => void;
}) {
    const { t } = useTranslation();
    const payment = state.payment ?? {
        method: 'cash_at_counter' as const,
        reference: '',
        notes: '',
    };

    return (
        <Card tone="raised" padding="md" testID="kitchen-order-desk-sale-payment">
            <Stack space="sm">
                <SegmentedControl<KitchenOrderPaymentMethod>
                    testID="kitchen-order-desk-sale-payment-method"
                    label={t('kitchen:desk.sale.methodLabel')}
                    block
                    value={payment.method}
                    onChange={(method) => {
                        onChange({ ...payment, method });
                    }}
                    items={paymentMethodsFor(state.fulfilmentType).map((candidate) => ({
                        value: candidate,
                        label: t(PAYMENT_METHOD_LABEL_KEYS[candidate]),
                        testID: `kitchen-order-desk-sale-payment-method-${candidate}`,
                    }))}
                />

                {payment.method === 'wish' ? (
                    <Stack space="sm" testID="kitchen-order-desk-sale-payment-wish">
                        <Callout
                            testID="kitchen-order-desk-sale-payment-wish-note"
                            tone="warning"
                            role="note"
                            title={t('kitchen:desk.sale.wishNoteTitle')}
                            body={t('kitchen:desk.sale.wishNoteBody')}
                        />
                        <TextInputField
                            testID="kitchen-order-desk-sale-payment-reference"
                            id="kitchen-order-desk-sale-payment-reference"
                            label={t('kitchen:desk.sale.referenceLabel')}
                            hint={t('kitchen:desk.sale.referenceHint')}
                            required
                            value={payment.reference}
                            onChangeText={(reference) => {
                                onChange({ ...payment, reference });
                            }}
                            autoCapitalize="characters"
                            autoCorrect={false}
                        />
                    </Stack>
                ) : null}

                <TextInputField
                    testID="kitchen-order-desk-sale-payment-notes"
                    id="kitchen-order-desk-sale-payment-notes"
                    label={t('kitchen:desk.sale.notesLabel')}
                    hint={t('kitchen:desk.sale.notesHint')}
                    multiline
                    value={payment.notes}
                    onChangeText={(notes) => {
                        onChange({ ...payment, notes });
                    }}
                />
            </Stack>
        </Card>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Step 6 — read it back
 * ---------------------------------------------------------------------------------------------- */

function ReviewStep({
    state,
    quote,
    quoteStale,
    onMethod,
}: {
    readonly state: SaleWizardState;
    readonly quote: OrderDeskQuote | null;
    readonly quoteStale: boolean;
    readonly onMethod: (method: KitchenOrderPaymentMethod) => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();

    return (
        <Card tone="raised" padding="md" testID="kitchen-order-desk-sale-review">
            <Stack space="md">
                <Inline space="sm" align="center" wrap>
                    <Text tone="secondary">{t('kitchen:desk.sale.reviewType')}</Text>
                    <Badge
                        testID="kitchen-order-desk-sale-review-type"
                        tone="info"
                        label={t(FULFILMENT_LABEL_KEYS[state.fulfilmentType])}
                    />
                </Inline>

                <Stack space="none" testID="kitchen-order-desk-sale-review-lines">
                    {state.lines.map((line) => (
                        <Text key={lineKey(line)} variant="caption">
                            {`${line.quantity} × ${displayName(line.name, locale).value}`}
                        </Text>
                    ))}
                </Stack>

                <QuoteTotals
                    quote={quote}
                    stale={quoteStale}
                    failed={false}
                    testID="kitchen-order-desk-sale-review-totals"
                />

                {state.fulfilmentType === 'counter' ? (
                    <Text testID="kitchen-order-desk-sale-review-method">
                        {t('kitchen:desk.sale.reviewMethod', {
                            method: t(PAYMENT_METHOD_LABEL_KEYS[state.paymentMethod]),
                        })}
                    </Text>
                ) : (
                    // A selector rather than a step: on a delivery or a pickup this is an *intent*
                    // recorded for later, with no transaction to describe, and a whole step for one
                    // control is a step somebody presses Next through.
                    <SegmentedControl<KitchenOrderPaymentMethod>
                        testID="kitchen-order-desk-sale-review-method-control"
                        label={t('kitchen:desk.sale.methodLabel')}
                        block
                        value={state.paymentMethod}
                        onChange={onMethod}
                        items={paymentMethodsFor(state.fulfilmentType).map((candidate) => ({
                            value: candidate,
                            label: t(PAYMENT_METHOD_LABEL_KEYS[candidate]),
                            testID: `kitchen-order-desk-sale-review-method-${candidate}`,
                        }))}
                    />
                )}
            </Stack>
        </Card>
    );
}

/* ------------------------------------------------------------------------------------------------
 * After a counter sale
 * ---------------------------------------------------------------------------------------------- */

/**
 * A finished counter sale.
 *
 * The placement performed place → confirm → receipt → fulfil in one transaction, so the order is
 * already `fulfilled` and there is nothing to send the agent to: the queue lists *open* work, and
 * this sale is not in it. So the screen states what happened, names the order so it can be quoted,
 * and offers the only thing a counter ever wants next.
 */
function CompletedSale({
    order,
    onNewSale,
}: {
    readonly order: KitchenOrder;
    readonly onNewSale: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Stack space="lg" testID="kitchen-order-desk-sale-completed">
            <Heading level={1} testID="kitchen-order-desk-sale-completed-title">
                {t('kitchen:desk.sale.completedTitle')}
            </Heading>
            <Callout
                testID="kitchen-order-desk-sale-completed-state"
                tone="success"
                role="status"
                title={t('kitchen:desk.sale.completedNumber', { number: order.orderNumber })}
                body={t('kitchen:desk.sale.completedBody', {
                    total: formatMoney(formatter, {
                        amount: order.totalMinor,
                        currency: order.currencyCode,
                    }),
                })}
                actions={
                    <Button
                        testID="kitchen-order-desk-sale-completed-new"
                        label={t('kitchen:desk.sale.newSale')}
                        onPress={onNewSale}
                    />
                }
            />
            <Inline space="sm" align="center" wrap>
                <Text tone="secondary">{t('kitchen:desk.sale.completedStatusLabel')}</Text>
                <Badge
                    testID="kitchen-order-desk-sale-completed-status"
                    tone={kitchenOrderStatusTone(order.status)}
                    label={t(kitchenOrderStatusKey(order.status))}
                />
            </Inline>
        </Stack>
    );
}
