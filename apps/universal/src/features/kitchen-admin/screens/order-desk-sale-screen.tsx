import type { AllergenCode } from '@healthy360/domain-types';
import type {
    KitchenOrder,
    KitchenOrderPaymentMethod,
    LocalisedText,
    OrderDeskCustomer,
    OrderDeskFulfilmentType,
    OrderDeskQuote,
    OrderDeskSaleRequest,
    ServiceArea,
} from '@healthy360/api-client/contracts';
import { ORDER_DESK_FULFILMENT_TYPES } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    EmptyState,
    ErrorState,
    FormGrid,
    Icon,
    Inline,
    SearchInput,
    Select,
    Skeleton,
    Stack,
    StepProgress,
    Text,
    TextInputField,
    useFormSteps,
    useToast,
} from '@healthy360/design-system';
import { fieldWidth } from '@healthy360/design-tokens';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useAllergenClassesQuery,
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
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import { CATALOGUE_PRIORITY } from '../catalogue/catalogue-column-spec.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { ORDER_CREATE_ON_BEHALF_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import {
    kitchenOrderPaymentMethodKey,
    kitchenOrderStatusKey,
    kitchenOrderStatusTone,
} from '../ops-format.ts';
import type { BasketLine } from '../order-desk/basket.ts';
import { addItem, lineKey, quantityAsNumber, toWire } from '../order-desk/basket.ts';
import { BasketRail } from '../order-desk/basket-rail.tsx';
import { DeskFact } from '../order-desk/desk-parts.tsx';
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
    withCustomer,
    withFulfilmentType,
} from '../order-desk/steps.ts';
import { WithColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/order-desk/sale` — ringing up a counter, pickup or telephone sale.
 *
 * ## The shape of the thing
 *
 * Six steps, of which any one sale uses four or five: `order-desk/steps.ts` owns which, in what
 * order, and what each needs before it may be left. The step strip is a **progress indicator**
 * that can only be walked backwards — it knows nothing about validity — so back, next and the review's
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
 * A basket line holds a quantity stepper and a remove button. The line therefore **must not** take
 * `onPress`: nested interactive content is a serious axe violation and would fail the a11y project
 * outright. The picker and customer rows follow it too — the row is inert and its button is the
 * control. The choice cards for the kind of sale and the payment method are the exception that
 * proves the rule: each *is* its control and holds nothing else.
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
    const router = useRouter();
    const toast = useToast();

    const [state, setState] = useState<SaleWizardState>(initialSaleWizardState);
    /*
     * The open step and the steps already left, over the steps *this* sale has — a counter sale has
     * no Customer or Address. Which step comes next, and whether the open one may be left, is still
     * the machine's (`order-desk/steps.ts`); the hook only holds where the agent is.
     */
    const steps = applicableSteps(state.fulfilmentType);
    const form = useFormSteps(steps, { initial: FIRST_SALE_STEP });
    const step = form.current;
    const [pickerQuery, setPickerQuery] = useState('');
    /** The finished counter sale. Non-null puts the screen into its completed state. */
    const [completed, setCompleted] = useState<KitchenOrder | null>(null);

    const place = usePlaceOrderDeskSaleMutation();

    // No title and no Leave button: the trail reads `Kitchen workspace › Order desk › New sale`,
    // and naming a leaf is what makes "Order desk" a link back.
    useKitchenTrailLeaf(t('kitchen:desk.sale.title'));

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
        form.goTo(clampStep(next, step));
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
        form.reset();
        place.reset();
    }

    if (completed !== null) {
        return <CompletedSale order={completed} onNewSale={startAgain} />;
    }

    return (
        <Stack space="md" testID="kitchen-order-desk-sale-screen">
            {/*
             * The multi-step form's progress row, as the recipe editor draws it — numbered dots on
             * the green line — and one the agent can also walk *back* along. Steps ahead of the
             * current one are disabled rather than hidden: the row says how long the sale is, and a
             * step that could be jumped to would skip the checks the machine makes before each one
             * may be left.
             */}
            <StepProgress
                testID="kitchen-order-desk-sale-stepper"
                label={t('kitchen:desk.sale.progressLabel')}
                steps={steps.map((candidate, index) => ({
                    key: candidate,
                    label: t(STEP_LABEL_KEYS[candidate]),
                    disabled: index > form.index,
                    testID: `kitchen-order-desk-sale-step-${candidate}`,
                }))}
                current={form.index}
                completed={form.completed}
                onSelect={form.goToIndex}
                divided
            />

            {/*
             * Every step's opening lives in one slot of one height above the row, so the rail and
             * the step's content start on the same line on every step — the basket's search takes
             * the slot a heading takes elsewhere.
             */}
            <View style={{ minHeight: STEP_HEADER_HEIGHT }} className="justify-end">
                {step === 'basket' ? (
                    <View style={{ width: fieldWidth }}>
                        <SearchInput
                            testID="kitchen-order-desk-sale-picker-search"
                            label={t('kitchen:desk.sale.pickerSearchLabel')}
                            placeholder={t('kitchen:desk.sale.pickerSearchPlaceholder')}
                            value={pickerQuery}
                            onChangeText={setPickerQuery}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </View>
                ) : (
                    <View className="flex-col gap-hair">
                        <Text variant="section" role="heading" aria-level={3}>
                            {t(STEP_HEADER_KEYS[step].title)}
                        </Text>
                        <Text variant="caption" tone="secondary">
                            {t(STEP_HEADER_KEYS[step].description, {
                                count: CUSTOMER_SEARCH_MIN_LENGTH,
                            })}
                        </Text>
                    </View>
                )}
            </View>

            <View className="flex-row flex-wrap items-start gap-loose">
                <View
                    // eslint-disable-next-line no-restricted-syntax -- the step column is the row's filler beside the fixed rail.
                    className="min-w-0 flex-1 flex-col gap-loose"
                    style={{ minWidth: STEP_MIN_WIDTH }}
                >
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
                            query={pickerQuery}
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
                            onMethod={(method) => {
                                update({ ...state, paymentMethod: method });
                            }}
                        />
                    ) : null}

                    {placeFailure === null ? null : (
                        <Callout
                            testID="kitchen-order-desk-sale-refusal"
                            tone="danger"
                            role="alert"
                            title={t('kitchen:desk.sale.refusedTitle')}
                            body={
                                refusalReasons.length === 0
                                    ? t('kitchen:desk.sale.refusedBody')
                                    : undefined
                            }
                        >
                            {refusalReasons.length === 0 ? null : (
                                <View
                                    testID="kitchen-order-desk-sale-refusal-reasons"
                                    className="flex-col gap-hair"
                                >
                                    {/*
                                     * Every reason, never just the first: one sentence saying the
                                     * order could not be placed sends an agent back to a basket
                                     * with nothing to change. A reason this build has no copy for
                                     * still appears, as the server's own code — a refusal nobody
                                     * has translated yet is still a fact about somebody's dinner.
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
                                </View>
                            )}
                        </Callout>
                    )}
                </View>

                <BasketRail
                    testID="kitchen-order-desk-sale-rail"
                    lines={state.lines}
                    quote={quoted}
                    quoteStale={quoteStale}
                    quoteFailed={toFailure(quote.error) !== null}
                    quoteFailureMessage={toFailure(quote.error)?.message}
                    onLines={(lines) => {
                        update({ ...state, lines });
                    }}
                    navigation={
                        <>
                            <Button
                                testID="kitchen-order-desk-sale-back"
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:desk.sale.back')}
                                disabled={back === null || place.isPending}
                                onPress={() => {
                                    if (back !== null) form.goTo(back);
                                }}
                            />
                            {step === 'review' ? (
                                <Button
                                    testID="kitchen-order-desk-sale-submit"
                                    size="sm"
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
                                    size="sm"
                                    label={t('kitchen:desk.sale.next')}
                                    disabled={forward === null || !mayLeave(step)}
                                    onPress={() => {
                                        if (forward !== null) form.goTo(forward);
                                    }}
                                />
                            )}
                        </>
                    }
                />
            </View>
        </Stack>
    );
}

/**
 * The narrowest the step column may be before the rail wraps beneath it. A style: the design's
 * number, with no token behind it.
 */
const STEP_MIN_WIDTH = 320;

/** Tall enough for the basket's labelled search, the tallest opening. A style: no token for it. */
const STEP_HEADER_HEIGHT = 64;

const STEP_HEADER_KEYS = {
    type: {
        title: 'kitchen:desk.sale.typeLabel',
        description: 'kitchen:desk.sale.typeDescription',
    },
    customer: {
        title: 'kitchen:desk.sale.step.customer',
        description: 'kitchen:desk.sale.customerSearchHint',
    },
    address: {
        title: 'kitchen:desk.sale.step.address',
        description: 'kitchen:desk.sale.addressDescription',
    },
    payment: {
        title: 'kitchen:desk.sale.step.payment',
        description: 'kitchen:desk.sale.paymentDescription',
    },
    review: {
        title: 'kitchen:desk.sale.step.review',
        description: 'kitchen:desk.sale.reviewDescription',
    },
} as const satisfies Record<Exclude<OrderDeskSaleStep, 'basket'>, object>;

/* ------------------------------------------------------------------------------------------------
 * Choice cards — the kind of sale, and the way it is paid
 * ---------------------------------------------------------------------------------------------- */

/**
 * One of a small set of mutually exclusive choices, drawn as a card with its consequence under it.
 *
 * A radio rather than a segmented control, because each choice needs a sentence: "Counter" alone
 * does not tell a new agent that a counter sale needs no name, and that is the thing that decides
 * the rest of the sale. The card is the control — it holds no other interactive element — so a
 * pressable card is not nested-interactive here.
 */
function ChoiceCard({
    label,
    hint,
    selected,
    onPress,
    testID,
}: {
    readonly label: string;
    readonly hint?: string | undefined;
    readonly selected: boolean;
    readonly onPress: () => void;
    readonly testID: string;
}) {
    return (
        <Pressable
            testID={testID}
            role="radio"
            accessibilityRole="radio"
            aria-checked={selected}
            accessibilityState={{ checked: selected }}
            accessibilityLabel={hint === undefined ? label : `${label}. ${hint}`}
            onPress={onPress}
            style={{ width: fieldWidth }}
            className={
                selected
                    ? 'flex-col gap-hair rounded border border-surface-brand bg-surface-brand-subtle p-snug'
                    : 'flex-col gap-hair rounded border border-stroke-subtle bg-surface-raised p-snug hover:border-surface-brand'
            }
        >
            <View className="flex-row items-center justify-between gap-tight">
                <Text variant="strong">{label}</Text>
                {selected ? (
                    <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                ) : null}
            </View>
            {hint === undefined ? null : (
                <Text variant="caption" tone="secondary">
                    {hint}
                </Text>
            )}
        </Pressable>
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
        <View testID="kitchen-order-desk-sale-type" className="z-auto flex-col">
            <View
                role="radiogroup"
                aria-label={t('kitchen:desk.sale.typeLabel')}
                testID="kitchen-order-desk-sale-type-control"
                className="flex-row flex-wrap gap-tight"
            >
                {ORDER_DESK_FULFILMENT_TYPES.map((candidate) => (
                    <ChoiceCard
                        key={candidate}
                        testID={`kitchen-order-desk-sale-type-${candidate}`}
                        label={t(FULFILMENT_LABEL_KEYS[candidate])}
                        hint={t(`kitchen:desk.sale.typeHint.${candidate}`)}
                        selected={state.fulfilmentType === candidate}
                        onPress={() => {
                            onChange(candidate);
                        }}
                    />
                ))}
            </View>
        </View>
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
    const chosenId = state.customerAccountId === null ? null : (chosen?.id ?? null);

    function choose(customer: OrderDeskCustomer) {
        setChosen(customer);
        onChoose(customer);
    }

    return (
        <View testID="kitchen-order-desk-sale-customer" className="z-auto flex-col">
            <View className="flex-col gap-tight">
                {state.customerAccountId === null || chosen === null ? null : (
                    <Callout
                        testID="kitchen-order-desk-sale-customer-chosen"
                        tone="success"
                        role="status"
                        title={chosen.displayName ?? t('kitchen:desk.sale.customerUnnamed')}
                        body={chosen.phone ?? undefined}
                    />
                )}

                <View style={{ width: fieldWidth }}>
                    <SearchInput
                        testID="kitchen-order-desk-sale-customer-search"
                        label={t('kitchen:desk.sale.customerSearchLabel')}
                        placeholder={t('kitchen:desk.sale.customerSearchPlaceholder')}
                        value={query}
                        onChangeText={setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                </View>

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
                        heightClassName="h-row-md"
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
                    <View
                        testID="kitchen-order-desk-sale-customer-results"
                        className="flex-col border-t border-stroke"
                    >
                        {rows.map((row) => (
                            // The row is inert and the button is the control: a pressable row
                            // wrapping a button is nested-interactive, which axe reports as serious.
                            <View
                                key={row.id}
                                testID={`kitchen-order-desk-sale-customer-${row.id}`}
                                className={
                                    chosenId === row.id
                                        ? 'min-h-row-md flex-row flex-wrap items-center gap-tight border-b border-stroke-subtle bg-surface-brand-subtle px-control-sm'
                                        : 'min-h-row-md flex-row flex-wrap items-center gap-tight border-b border-stroke-subtle px-control-sm'
                                }
                            >
                                {/* eslint-disable-next-line no-restricted-syntax -- the name is the row's filler. */}
                                <View className="min-w-0 flex-1">
                                    <Text variant="strong">
                                        {row.displayName ?? t('kitchen:desk.sale.customerUnnamed')}
                                    </Text>
                                </View>
                                <Text variant="mono" tone="secondary">
                                    {row.phone ?? EM_DASH}
                                </Text>
                                {row.hasOrdersWithOrg ? (
                                    <Badge
                                        tone="success"
                                        icon={null}
                                        label={t('kitchen:desk.sale.customerRegular')}
                                    />
                                ) : null}
                                <Button
                                    testID={`kitchen-order-desk-sale-customer-${row.id}-choose`}
                                    size="sm"
                                    variant="quiet"
                                    label={t('kitchen:desk.sale.customerChoose')}
                                    onPress={() => {
                                        choose(row);
                                    }}
                                />
                            </View>
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
                    </View>
                ) : debounced.length >= CUSTOMER_SEARCH_MIN_LENGTH ? (
                    <EmptyState
                        testID="kitchen-order-desk-sale-customer-empty"
                        title={t('kitchen:desk.sale.customerNoneTitle')}
                        body={t('kitchen:desk.sale.customerNoneBody')}
                    />
                ) : null}

                {creating ? (
                    <View
                        testID="kitchen-order-desk-sale-customer-form"
                        className="flex-col gap-tight border-t border-stroke-subtle pt-tight"
                    >
                        <Text variant="micro" tone="secondary" accessibilityRole="header">
                            {t('kitchen:desk.sale.customerCreateTitle')}
                        </Text>
                        <FormGrid columns={2}>
                            <TextInputField
                                testID="kitchen-order-desk-sale-customer-name"
                                id="kitchen-order-desk-sale-customer-name"
                                label={t('kitchen:desk.sale.customerNameLabel')}
                                hint={t('kitchen:desk.sale.customerNameHint')}
                                size="sm"
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
                                size="sm"
                                required
                                value={phone}
                                onChangeText={setPhone}
                                autoCapitalize="none"
                                autoCorrect={false}
                                inputMode="tel"
                            />
                        </FormGrid>

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
                                <View className="flex-col gap-hair">
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
                                </View>
                            </Callout>
                        )}

                        <Inline space="xs" wrap>
                            <Button
                                testID="kitchen-order-desk-sale-customer-create"
                                size="sm"
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
                                size="sm"
                                variant="secondary"
                                label={t('kitchen:desk.sale.customerCancelCreate')}
                                onPress={() => {
                                    setCreating(false);
                                }}
                            />
                        </Inline>
                    </View>
                ) : (
                    <Inline space="xs">
                        <Button
                            testID="kitchen-order-desk-sale-customer-new"
                            size="sm"
                            variant="secondary"
                            label={t('kitchen:desk.sale.customerNew')}
                            iconStart={<Icon name="plus" size="sm" />}
                            onPress={() => {
                                setCreating(true);
                            }}
                        />
                    </Inline>
                )}
            </View>
        </View>
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
        <View testID="kitchen-order-desk-sale-address" className="z-auto flex-col">
            <View className="flex-col gap-snug">
                <Callout
                    testID="kitchen-order-desk-sale-address-note"
                    tone="warning"
                    role="note"
                    title={t('kitchen:desk.sale.addressNoteTitle')}
                    body={t('kitchen:desk.sale.addressNoteBody')}
                />

                <FormGrid columns={3}>
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
                        size="sm"
                        required
                        value={lineOne}
                        onChangeText={setLineOne}
                    />
                    <TextInputField
                        testID="kitchen-order-desk-sale-address-line-two"
                        id="kitchen-order-desk-sale-address-line-two"
                        label={t('kitchen:desk.sale.lineTwoLabel')}
                        size="sm"
                        value={lineTwo}
                        onChangeText={setLineTwo}
                    />
                    <TextInputField
                        testID="kitchen-order-desk-sale-address-building"
                        id="kitchen-order-desk-sale-address-building"
                        label={t('kitchen:desk.sale.buildingLabel')}
                        size="sm"
                        value={building}
                        onChangeText={setBuilding}
                    />
                    <TextInputField
                        testID="kitchen-order-desk-sale-address-label"
                        id="kitchen-order-desk-sale-address-label"
                        label={t('kitchen:desk.sale.addressLabelLabel')}
                        size="sm"
                        value={label}
                        onChangeText={setLabel}
                    />
                    <TextInputField
                        testID="kitchen-order-desk-sale-address-directions"
                        id="kitchen-order-desk-sale-address-directions"
                        label={t('kitchen:desk.sale.directionsLabel')}
                        hint={t('kitchen:desk.sale.directionsHint')}
                        size="sm"
                        span={2}
                        multiline
                        value={directions}
                        onChangeText={setDirections}
                    />
                </FormGrid>

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

                <Inline space="xs">
                    <Button
                        testID="kitchen-order-desk-sale-address-save"
                        size="sm"
                        label={t('kitchen:desk.sale.addressSave')}
                        loading={save.isPending}
                        disabled={
                            areaId === null ||
                            lineOne.trim() === '' ||
                            state.customerAccountId === null
                        }
                        onPress={() => {
                            if (areaId === null || state.customerAccountId === null) return;
                            save.mutate(
                                {
                                    customerAccountId: state.customerAccountId,
                                    deliveryAreaId: areaId,
                                    lineOne: lineOne.trim(),
                                    ...(lineTwo.trim() === '' ? {} : { lineTwo: lineTwo.trim() }),
                                    ...(building.trim() === ''
                                        ? {}
                                        : { building: building.trim() }),
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
                </Inline>
            </View>
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Step 4 — the menu
 * ---------------------------------------------------------------------------------------------- */

/** One thing the picker can add: an article, with the name to show while the quote is in flight. */
interface PickerRow {
    readonly id: string;
    readonly name: LocalisedText;
    readonly kind: 'meal' | 'product';
    /**
     * A meal's allergen codes, frozen at publication — an empty set is a real "none declared".
     * `null` for a product, which carries no allergen field at all: unknown, never "none".
     */
    readonly allergens: readonly string[] | null;
}

/**
 * The menu picker. What is *in* the basket is the rail's; this step only adds to it.
 *
 * No price column, deliberately — see the file header. A number beside a picker row could only have
 * been guessed, and a guessed price at a counter is one somebody reads out loud.
 */
function BasketStep({
    state,
    query,
    onLines,
}: {
    readonly state: SaleWizardState;
    /** Held by the screen: the search sits above the row so the table and the rail share a top. */
    readonly query: string;
    readonly onLines: (lines: readonly BasketLine[]) => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();

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

    /*
     * The column filters. Both are real narrowings rather than a pass over the loaded page:
     *
     * - **Kind** chooses which of the two reads is shown at all.
     * - **Allergens** travels to the server as `allergenCodes` on the meal read. Products carry no
     *   allergen field, so while it is set they are left out — listing a product under "contains
     *   gluten" would be a claim nothing on the record supports.
     */
    const [kind, setKind] = useState<PickerRow['kind'] | null>(null);
    const [allergen, setAllergen] = useState<AllergenCode | null>(null);

    const mealFilter = useMemo(
        () => ({ ...filter, ...(allergen === null ? {} : { allergenCodes: [allergen] }) }),
        [filter, allergen],
    );

    const showMeals = kind !== 'product';
    const showProducts = kind !== 'meal' && allergen === null;

    const meals = useAdminMealPageQuery(mealFilter, 1);
    const products = useProductPageQuery(filter, 1);
    const allergenClasses = useAllergenClassesQuery();

    const pickerFailure =
        (showMeals ? toFailure(meals.error) : null) ??
        (showProducts ? toFailure(products.error) : null);
    const loading = (showMeals && meals.isPending) || (showProducts && products.isPending);

    const rows = useMemo<readonly PickerRow[]>(
        () => [
            ...(showMeals ? (meals.data?.items ?? []) : []).map((row) => ({
                id: String(row.id),
                name: row.name,
                kind: 'meal' as const,
                allergens: row.allergens.map((code) => String(code)),
            })),
            ...(showProducts ? (products.data?.items ?? []) : []).map((row) => ({
                id: String(row.id),
                name: row.name,
                kind: 'product' as const,
                allergens: null,
            })),
        ],
        [meals.data, products.data, showMeals, showProducts],
    );

    const columns = useMemo<
        readonly ControlledColumn<PickerRow, CatalogueColumn<PickerRow>>[]
    >(() => {
        return [
            {
                key: 'name',
                label: t('kitchen:desk.sale.pickerColumnItem'),
                width: 240,
                min: 160,
                priority: CATALOGUE_PRIORITY.designation,
                role: 'title',
                value: (row) => displayName(row.name, locale).value,
                render: (row) => (
                    <Text testID={`kitchen-order-desk-sale-picker-${row.id}`}>
                        {displayName(row.name, locale).value}
                    </Text>
                ),
                // Ordering what is on screen, which is honest in a way filtering it would not be.
                sort: (left, right, direction) =>
                    compareText(
                        displayName(left.name, locale).value,
                        displayName(right.name, locale).value,
                        direction,
                    ),
            },
            {
                key: 'kind',
                label: t('kitchen:desk.sale.pickerColumnKind'),
                width: 120,
                min: 90,
                priority: CATALOGUE_PRIORITY.category,
                role: 'meta',
                value: (row) => t(`kitchen:desk.sale.itemKind.${row.kind}`),
                // Screen-owned: the kind decides which of the two reads is shown at all.
                filter: {
                    values: () =>
                        (['meal', 'product'] as const).map((candidate) => ({
                            key: candidate,
                            label: t(`kitchen:desk.sale.itemKind.${candidate}`),
                        })),
                    external: {
                        value: kind,
                        onChange: (next) => {
                            setKind(next as PickerRow['kind'] | null);
                        },
                    },
                },
            },
            {
                key: 'allergens',
                label: t('kitchen:desk.sale.pickerColumnAllergens'),
                width: 200,
                min: 130,
                priority: CATALOGUE_PRIORITY.allergens,
                role: 'meta',
                value: (row) =>
                    row.allergens === null
                        ? EM_DASH
                        : row.allergens.length === 0
                          ? t('kitchen:list.noAllergens')
                          : row.allergens.join(', '),
                render: (row) => (
                    <Text
                        tone={row.allergens === null ? 'disabled' : 'secondary'}
                        numberOfLines={1}
                        testID={`kitchen-order-desk-sale-picker-${row.id}-allergens`}
                    >
                        {row.allergens === null
                            ? EM_DASH
                            : row.allergens.length === 0
                              ? t('kitchen:list.noAllergens')
                              : row.allergens.join(', ')}
                    </Text>
                ),
                // Screen-owned: the class travels to the server as `allergenCodes`.
                filter: {
                    values: () =>
                        (allergenClasses.data ?? []).map((entry) => ({
                            key: entry.code,
                            label: displayName(entry.name, locale).value,
                        })),
                    external: {
                        value: allergen,
                        onChange: (next) => {
                            setAllergen(
                                (allergenClasses.data ?? []).find((entry) => entry.code === next)
                                    ?.code ?? null,
                            );
                        },
                    },
                },
            },
            {
                key: 'add',
                label: '',
                width: 96,
                min: 80,
                priority: CATALOGUE_PRIORITY.actions,
                // `metric`, not `actions`: below `md` the list draws a two-line row that renders only
                // title / status / metric / meta, and a picker whose Add vanished on a narrow window
                // could not sell anything. `actions` there means the ⋯ menu from `rowActions`.
                role: 'metric',
                align: 'end',
                value: () => '',
                // The row takes no press and this is its only control, so it is not nested.
                render: (row) => {
                    const name = displayName(row.name, locale).value;
                    return (
                        <Button
                            testID={`kitchen-order-desk-sale-picker-${row.id}-add`}
                            size="sm"
                            variant="quiet"
                            label={t('kitchen:desk.sale.pickerAdd')}
                            accessibilityLabel={t('kitchen:desk.sale.pickerAddItem', {
                                item: name,
                            })}
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
                    );
                },
            },
        ];
    }, [t, locale, kind, allergen, allergenClasses.data, onLines, state.lines]);

    const controls = useColumnControls(rows, columns, 'kitchen-order-desk-sale-picker');

    return (
        // No heading: the step tab above already says "Basket", and the rail beside it is the basket.
        <View testID="kitchen-order-desk-sale-basket">
            <View testID="kitchen-order-desk-sale-picker" className="flex-col gap-tight">
                {loading ? (
                    <Skeleton
                        testID="kitchen-order-desk-sale-picker-loading"
                        heightClassName="h-row-md"
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
                    <View testID="kitchen-order-desk-sale-picker-rows">
                        <WithColumnPicker picker={controls.picker}>
                            <CatalogueList
                                testID="kitchen-order-desk-sale-picker-table"
                                label={t('kitchen:desk.sale.pickerSearchLabel')}
                                columns={controls.columns}
                                rows={controls.rows}
                                rowKey={(row) => `${row.kind}-${row.id}`}
                                density="sm"
                                rowActionsLabel={t('kitchen:list.rowActions')}
                            />
                        </WithColumnPicker>
                    </View>
                )}
            </View>
        </View>
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
        <View testID="kitchen-order-desk-sale-payment" className="z-auto flex-col">
            <View className="flex-col gap-snug">
                <MethodChoices
                    testID="kitchen-order-desk-sale-payment-method"
                    state={state}
                    value={payment.method}
                    onChange={(method) => {
                        onChange({ ...payment, method });
                    }}
                />

                {payment.method === 'wish' ? (
                    <View
                        testID="kitchen-order-desk-sale-payment-wish"
                        className="flex-col gap-snug"
                    >
                        <Callout
                            testID="kitchen-order-desk-sale-payment-wish-note"
                            tone="warning"
                            role="note"
                            title={t('kitchen:desk.sale.wishNoteTitle')}
                            body={t('kitchen:desk.sale.wishNoteBody')}
                        />
                        <FormGrid columns={1}>
                            <TextInputField
                                testID="kitchen-order-desk-sale-payment-reference"
                                id="kitchen-order-desk-sale-payment-reference"
                                label={t('kitchen:desk.sale.referenceLabel')}
                                hint={t('kitchen:desk.sale.referenceHint')}
                                size="sm"
                                required
                                value={payment.reference}
                                onChangeText={(reference) => {
                                    onChange({ ...payment, reference });
                                }}
                                autoCapitalize="characters"
                                autoCorrect={false}
                            />
                        </FormGrid>
                    </View>
                ) : null}

                <FormGrid columns={2}>
                    <TextInputField
                        testID="kitchen-order-desk-sale-payment-notes"
                        id="kitchen-order-desk-sale-payment-notes"
                        label={t('kitchen:desk.sale.notesLabel')}
                        hint={t('kitchen:desk.sale.notesHint')}
                        size="sm"
                        span={2}
                        multiline
                        value={payment.notes}
                        onChangeText={(notes) => {
                            onChange({ ...payment, notes });
                        }}
                    />
                </FormGrid>
            </View>
        </View>
    );
}

/**
 * The payment methods a kind of sale may be taken on, as choice cards.
 *
 * Shared by the counter's payment step and the review's method selector, so the two cannot offer
 * different sets: `paymentMethodsFor` is the single answer to "what can this sale be paid with".
 */
function MethodChoices({
    state,
    value,
    onChange,
    testID,
}: {
    readonly state: SaleWizardState;
    readonly value: KitchenOrderPaymentMethod;
    readonly onChange: (method: KitchenOrderPaymentMethod) => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();

    return (
        <View
            testID={testID}
            role="radiogroup"
            aria-label={t('kitchen:desk.sale.methodLabel')}
            className="flex-row flex-wrap gap-tight"
        >
            {paymentMethodsFor(state.fulfilmentType).map((candidate) => (
                <ChoiceCard
                    key={candidate}
                    testID={`${testID}-${candidate}`}
                    label={t(kitchenOrderPaymentMethodKey(candidate))}
                    selected={value === candidate}
                    onPress={() => {
                        onChange(candidate);
                    }}
                />
            ))}
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Step 6 — read it back
 * ---------------------------------------------------------------------------------------------- */

function ReviewStep({
    state,
    quote,
    onMethod,
}: {
    readonly state: SaleWizardState;
    readonly quote: OrderDeskQuote | null;
    readonly onMethod: (method: KitchenOrderPaymentMethod) => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const itemCount = state.lines.reduce(
        (sum, line) => sum + (quantityAsNumber(line.quantity) ?? 0),
        0,
    );

    return (
        <View testID="kitchen-order-desk-sale-review" className="z-auto flex-col">
            <View className="flex-col gap-snug">
                <View className="flex-col">
                    <DeskFact
                        testID="kitchen-order-desk-sale-review-type"
                        label={t('kitchen:desk.sale.reviewType')}
                        value={t(FULFILMENT_LABEL_KEYS[state.fulfilmentType])}
                    />
                    <DeskFact
                        testID="kitchen-order-desk-sale-review-items"
                        label={t('kitchen:desk.sale.reviewItems')}
                        mono
                        value={formatter.formatNumber(itemCount)}
                    />
                    <View
                        testID="kitchen-order-desk-sale-review-lines"
                        className="flex-col border-b border-stroke-subtle py-tight"
                    >
                        {state.lines.map((line) => (
                            <Text key={lineKey(line)} variant="caption" tone="secondary">
                                {t('kitchen:desk.sale.reviewLine', {
                                    quantity: line.quantity,
                                    item: displayName(line.name, locale).value,
                                })}
                            </Text>
                        ))}
                    </View>
                    <DeskFact
                        testID="kitchen-order-desk-sale-review-total"
                        label={t('kitchen:desk.sale.total')}
                        mono
                        value={
                            quote === null
                                ? EM_DASH
                                : formatMoney(formatter, {
                                      amount: quote.totalMinor,
                                      currency: quote.currencyCode,
                                  })
                        }
                    />
                    {state.fulfilmentType === 'counter' ? (
                        <DeskFact
                            testID="kitchen-order-desk-sale-review-method"
                            label={t('kitchen:desk.paymentMethod')}
                            value={t(kitchenOrderPaymentMethodKey(state.paymentMethod))}
                        />
                    ) : null}
                </View>

                {state.fulfilmentType === 'counter' ? null : (
                    // A selector rather than a step: on a delivery or a pickup this is an *intent*
                    // recorded for later, with no transaction to describe, and a whole step for one
                    // control is a step somebody presses Next through.
                    <View className="flex-col gap-hair">
                        <Text variant="label">{t('kitchen:desk.sale.methodLabel')}</Text>
                        <MethodChoices
                            testID="kitchen-order-desk-sale-review-method"
                            state={state}
                            value={state.paymentMethod}
                            onChange={onMethod}
                        />
                    </View>
                )}
            </View>
        </View>
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
    const router = useRouter();

    return (
        <View
            testID="kitchen-order-desk-sale-completed"
            className="flex-col items-center gap-tight py-loose"
        >
            <Badge
                testID="kitchen-order-desk-sale-completed-status"
                tone={kitchenOrderStatusTone(order.status)}
                label={t(kitchenOrderStatusKey(order.status))}
            />
            <Text variant="display" tone="brand" testID="kitchen-order-desk-sale-completed-total">
                {formatMoney(formatter, { amount: order.totalMinor, currency: order.currencyCode })}
            </Text>
            <Text variant="title" align="center" testID="kitchen-order-desk-sale-completed-title">
                {t('kitchen:desk.sale.completedTitle')}
            </Text>
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
            />
            <Inline space="xs" wrap>
                <Button
                    testID="kitchen-order-desk-sale-completed-new"
                    size="md"
                    label={t('kitchen:desk.sale.newSale')}
                    onPress={onNewSale}
                />
                <Button
                    testID="kitchen-order-desk-sale-completed-queue"
                    size="md"
                    variant="secondary"
                    label={t('kitchen:desk.sale.backToQueue')}
                    onPress={() => {
                        router.push('/kitchen/order-desk');
                    }}
                />
            </Inline>
        </View>
    );
}
