import {
    Button,
    Callout,
    DateField,
    FAILURE_MESSAGE_KEYS,
    Icon,
    Select,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type {
    Cart,
    CheckoutPreview,
    CustomerAddress,
    PlacedOrder,
} from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useAddressesQuery } from '../../../data/account-hooks.ts';
import {
    toFailure,
    useCartQuery,
    useCheckoutPreviewQuery,
    usePlaceOrderMutation,
} from '../../../data/commerce-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { usePrototypeAction } from '../../../prototype/index.ts';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { AccountSetupSteps, stepForRequirement } from '../../account/account-setup-steps.tsx';
import type { AccountSetupStep } from '../../account/account-setup-steps.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import {
    CheckoutCard,
    CheckoutColumns,
    CheckoutPage,
    CheckoutSteps,
    CheckoutTitle,
    ChoiceChips,
    FieldCell,
    FieldRow,
    OptionCard,
    RadioRow,
    SummaryItems,
    SummaryTotal,
    TextLink,
} from '../checkout-frame.tsx';
import type { SummaryItem } from '../checkout-frame.tsx';
import { earliestStartDate } from '../dates.ts';
import {
    defaultSlotCode,
    deliverySlotByCode,
    deliverySlotsForKitchen,
    offeredSlots,
} from '../delivery.ts';
import { displayableWarnings, isCriticalWarning, warningMessageKey } from '../warnings.ts';

/**
 * `/customer/checkout` — one-off order checkout against a saved address, in HealthZone's
 * `checkout` composition: "Checkout", the three-segment bar (Delivery · Payment · Confirmation),
 * and the step's card beside a sticky rail that lists what is being bought and its total.
 *
 * Placement requires `addressId` (D-084): delivery zone and fee resolve from the address book, not
 * a typed street line. Payment is cash on delivery — never card details in the app.
 *
 * ## How the design's delivery form maps onto a saved address
 *
 * The design types a name, a street, a city, a ZIP, a phone and a drop-off note. Placement takes a
 * saved address *identifier*, a window and a date, and nothing else. So the grid keeps its shape
 * with the one real control on top — the saved-address select — and the address's own street,
 * area and driver note shown beneath it in disabled fields: what the kitchen will receive, edited
 * in the address book ("Manage addresses"), not here. The date sits where the design's ZIP does;
 * the kitchen's own windows are the design's slot chips. Name and phone are not drawn: the order
 * carries neither, and the account's own contact is what the kitchen reaches.
 *
 * ## Delivery or pickup
 *
 * Both cards are drawn. Delivery is the real one and is chosen. `PlaceOrderRequest` has no
 * fulfilment mode, so Pickup is the prototype notice when the kitchen says it offers pickup at all,
 * and disabled — "Not offered by this kitchen" — when it does not.
 *
 * ## The payment step lists one method
 *
 * The design's three radio rows are a person's *saved instruments* — a Visa ending 4412, Apple Pay,
 * a corporate card. Nobody here has one: the contract is deliberately payment-free, and the order
 * is paid in cash at the door. So the card draws the design's radio list with the one true row in
 * it, chosen. A second, prototype "card" row was considered and rejected: it would put a dead end
 * directly above the button that places the order, and drawing an instrument nobody saved is the
 * fabrication the rest of the screen is built to avoid.
 */

type Phase = 'collecting' | 'placed';

interface CommittedDelivery {
    readonly addressId: string;
    readonly addressLabel: string;
    readonly slotCode: string;
    /**
     * The window's and the kitchen's names as they read when the details were committed. Placement
     * empties the basket, which disables the kitchen query the live names come from — the
     * confirmation would otherwise forget which kitchen has the order.
     */
    readonly slotLabel: string;
    readonly kitchenName: string | null;
    readonly deliveryDate: string;
}

function formatSavedAddress(address: CustomerAddress): string {
    const parts = [address.label, address.line1, address.areaName].filter(
        (part) => part.trim() !== '',
    );
    return parts.join(' · ');
}

/** The street line as the driver reads it: line one, line two, building and floor. */
function streetOf(address: CustomerAddress | null, separator: string): string {
    if (address === null) return '';
    return [address.line1, address.line2, address.building, address.floor]
        .filter((part): part is string => part !== null && part.trim() !== '')
        .join(separator);
}

export function CheckoutScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const runPrototype = usePrototypeAction();
    const params = useLocalSearchParams<{ channel?: string }>();
    const channelCode =
        typeof params.channel === 'string' && params.channel !== '' ? params.channel : undefined;

    const cart = useCartQuery(true, channelCode);
    const basket: Cart | undefined = cart.data;
    const addresses = useAddressesQuery();
    const placeOrder = usePlaceOrderMutation(channelCode);

    const kitchenId = basket?.items[0]?.kitchenId ?? null;
    const kitchen = useKitchenQuery(kitchenId);
    const deliverySlots = deliverySlotsForKitchen(kitchen.data);
    const kitchenOffersPickup = kitchen.data?.channels.pickup === true;

    const [addressId, setAddressId] = useState<string | null>(null);
    const [chosenSlotCode, setSlotCode] = useState<string | null>(null);
    const [deliveryDate, setDeliveryDate] = useState<string | null>(() => earliestStartDate());
    const [showErrors, setShowErrors] = useState(false);
    const [committed, setCommitted] = useState<CommittedDelivery | null>(null);
    const [phase, setPhase] = useState<Phase>('collecting');
    const [placed, setPlaced] = useState<PlacedOrder | null>(null);

    /*
     * The slot is *derived* while nobody has chosen one, rather than seeded by an effect: the very
     * first render already shows the kitchen's default, and an explicit choice the kitchen turns
     * out not to offer — the basket changed kitchen under the person — falls back to the default
     * rather than sticking.
     */
    const addressList = addresses.data ?? [];
    const selectedAddress = addressList.find((entry) => entry.id === addressId) ?? null;

    const previewRequest = useMemo(() => {
        if (basket === undefined || basket.items.length === 0) return null;
        return {
            cartId: basket.id,
            ...(addressId === null ? {} : { addressId }),
            ...(deliveryDate === null ? {} : { deliveryDate }),
        };
    }, [addressId, basket, deliveryDate]);

    const preview = useCheckoutPreviewQuery(previewRequest);
    const quotation: CheckoutPreview | undefined = preview.data;

    /*
     * Only the slots the address's zone offers: placement refuses any other (`window_not_offered`).
     * `null` codes — no address yet, or no serving zone — filter nothing. A choice the zone does not
     * offer falls back to the default over what it does, and a zone offering none says so.
     */
    const slotOptions = offeredSlots(deliverySlots, quotation?.offeredWindowCodes ?? null);
    const chosenSlotIsOffered =
        chosenSlotCode !== null && slotOptions.some((slot) => slot.code === chosenSlotCode);
    const slotCode = chosenSlotIsOffered ? chosenSlotCode : defaultSlotCode(slotOptions);
    const placeFailure = toFailure(placeOrder.error);

    /*
     * A refusal names *every* reason it was refused for, and the checkout lists them — one sentence
     * saying the order could not be placed sends somebody back to a basket with nothing to change.
     * Reasons the catalogue has no copy for still appear, as the server's own code.
     */
    const refusalReasons =
        placeFailure?.code === 'order.placement_refused' ? placeFailure.reasons : [];

    /*
     * Account setup is not something the basket can fix, but it is never "go to the account page
     * and guess". The server sends one `account_not_ready` per outstanding requirement, naming it in
     * `outstanding` (and, for an address, whether one exists outside the served areas), so each
     * becomes a row saying what is missing with a button to the screen that fixes it. Every other
     * reason is about the order itself and stays in the refusal's list.
     */
    const setupSteps: AccountSetupStep[] = [];
    for (const entry of refusalReasons) {
        if (entry.reason !== 'account_not_ready') continue;
        const step = stepForRequirement(entry.context['outstanding']);
        if (step === null || setupSteps.some((existing) => existing.step === step)) continue;
        setupSteps.push({ step, hasAddress: entry.context['has_address'] === true });
    }
    // An `account_not_ready` this build cannot name a step for stays in the list, so it is never lost.
    const orderReasons = refusalReasons.filter(
        (entry) =>
            entry.reason !== 'account_not_ready' ||
            stepForRequirement(entry.context['outstanding']) === null,
    );
    /*
     * `account_not_active` comes only once the checklist is clean — a suspended or closed account —
     * so there is no step to do; the account page is where its state is explained. So is a setup
     * requirement with no step to name.
     */
    const accountInactive = orderReasons.some(
        (entry) => entry.reason === 'account_not_active' || entry.reason === 'account_not_ready',
    );

    const steps = [
        { key: 'delivery', label: t('commerce:checkout.steps.delivery') },
        { key: 'payment', label: t('commerce:checkout.steps.payment') },
        { key: 'placed', label: t('commerce:checkout.steps.placed') },
    ];

    const slotName = (code: string) =>
        deliverySlotByCode(code, kitchen.data)?.label ??
        // A kitchen may publish a window code this catalogue has never heard of, and the code
        // itself reads better than `commerce:slots.late_evening`.
        t(`commerce:slots.${code}`, { defaultValue: code });

    const slotSentence = (delivery: CommittedDelivery) =>
        t('commerce:checkout.committedSlot', {
            slot: delivery.slotLabel,
            date: formatter.formatDate(delivery.deliveryDate, { dateStyle: 'medium' }),
        });

    if (phase === 'placed' && placed !== null && committed !== null) {
        return (
            <CheckoutPage testID="checkout-success-screen">
                <CheckoutTitle testID="checkout-title">
                    {t('commerce:checkout.title')}
                </CheckoutTitle>
                <CheckoutSteps
                    testID="checkout-stepper"
                    label={t('commerce:checkout.progressLabel')}
                    steps={steps}
                    current={3}
                />
                <OrderPlaced
                    order={placed}
                    kitchenName={committed.kitchenName}
                    arriving={slotSentence(committed)}
                    onTrack={() => {
                        router.push(`/customer/orders/${placed.id}` as never);
                    }}
                />
            </CheckoutPage>
        );
    }

    const onReview = () => {
        setShowErrors(true);
        if (selectedAddress === null || deliveryDate === null || slotCode === null) return;
        setCommitted({
            addressId: selectedAddress.id,
            addressLabel: formatSavedAddress(selectedAddress),
            slotCode,
            slotLabel: slotName(slotCode),
            kitchenName: kitchen.data?.name ?? null,
            deliveryDate,
        });
    };

    const onPlace = () => {
        if (basket === undefined || committed === null) return;
        placeOrder.mutate(
            {
                cartId: basket.id,
                addressId: committed.addressId,
                slotCode: committed.slotCode,
                deliveryDate: committed.deliveryDate,
            },
            {
                onSuccess: (order) => {
                    setPlaced(order);
                    setPhase('placed');
                },
            },
        );
    };

    /* ── step one: delivery details ─────────────────────────────────────────────────────────── */

    const deliveryStep = (
        <View className="flex-col" testID="checkout-delivery-step">
            <StepHeading
                title={t('commerce:checkout.deliveryTitle')}
                body={t('commerce:checkout.deliveryBody')}
            />

            <View
                testID="checkout-mode"
                role="radiogroup"
                accessibilityRole="radiogroup"
                aria-label={t('commerce:checkout.modeLabel')}
                accessibilityLabel={t('commerce:checkout.modeLabel')}
                className="mt-5 flex-row gap-2"
            >
                <OptionCard
                    testID="checkout-mode-delivery"
                    label={t('commerce:checkout.modeDelivery')}
                    sub={
                        quotation?.deliveryFee === null || quotation === undefined
                            ? t('commerce:checkout.modeDeliverySub')
                            : t('commerce:checkout.modeDeliveryFee', {
                                  fee: formatMoney(formatter, quotation.deliveryFee),
                              })
                    }
                    chosen
                />
                <OptionCard
                    testID="checkout-mode-pickup"
                    label={t('commerce:checkout.modePickup')}
                    sub={
                        kitchenOffersPickup
                            ? t('commerce:checkout.modePickupSub')
                            : t('commerce:checkout.modePickupUnavailable')
                    }
                    chosen={false}
                    disabled={!kitchenOffersPickup}
                    accessibilityHint={t('marketplace:prototype.notBuilt')}
                    onPress={() => {
                        runPrototype({ contract: 'PlaceOrderRequest.fulfilment = "pickup"' });
                    }}
                />
            </View>

            <View className="mt-5 flex-col gap-3" testID="checkout-address">
                <QueryStates
                    query={addresses}
                    isEmpty={addressList.length === 0}
                    emptyTitle={t('commerce:checkout.noAddressTitle')}
                    emptyBody={t('commerce:checkout.noAddressBody')}
                    emptyActions={
                        <Button
                            testID="checkout-add-address"
                            label={t('commerce:checkout.addAddress')}
                            onPress={() => {
                                router.push('/customer/account/addresses' as never);
                            }}
                        />
                    }
                    skeletonCount={1}
                    testID="checkout-addresses"
                >
                    <View className="flex-col gap-3">
                        <FieldRow>
                            <FieldCell>
                                <Select
                                    testID="checkout-address-picker"
                                    label={t('commerce:checkout.addressTitle')}
                                    value={addressId}
                                    onChange={(next) => {
                                        setAddressId(next);
                                        setCommitted(null);
                                    }}
                                    options={addressList.map((entry) => ({
                                        value: entry.id,
                                        label: formatSavedAddress(entry),
                                    }))}
                                    placeholder={t('commerce:checkout.addressPlaceholder')}
                                    required
                                    {...(showErrors && addressId === null
                                        ? { error: t('commerce:validation.required') }
                                        : {})}
                                />
                            </FieldCell>
                        </FieldRow>
                        <FieldRow>
                            <FieldCell>
                                <TextInputField
                                    testID="checkout-street"
                                    label={t('commerce:checkout.streetLabel')}
                                    placeholder={t('commerce:checkout.fromAddress')}
                                    value={streetOf(
                                        selectedAddress,
                                        t('commerce:common.listSeparator'),
                                    )}
                                    disabled
                                />
                            </FieldCell>
                        </FieldRow>
                        <FieldRow>
                            <FieldCell>
                                <TextInputField
                                    testID="checkout-area"
                                    label={t('commerce:checkout.areaLabel')}
                                    placeholder={t('commerce:checkout.fromAddress')}
                                    value={selectedAddress?.areaName ?? ''}
                                    disabled
                                />
                            </FieldCell>
                            <FieldCell>
                                <View testID="checkout-date">
                                    <DateField
                                        testID="checkout-date-field"
                                        label={t('commerce:checkout.dateLabel')}
                                        value={deliveryDate}
                                        min={earliestStartDate()}
                                        required
                                        onChange={(next) => {
                                            setDeliveryDate(next);
                                            setCommitted(null);
                                        }}
                                        {...(showErrors && deliveryDate === null
                                            ? { error: t('commerce:validation.required') }
                                            : {})}
                                    />
                                </View>
                            </FieldCell>
                        </FieldRow>
                        <FieldRow>
                            <FieldCell>
                                <TextInputField
                                    testID="checkout-note"
                                    label={t('commerce:checkout.noteLabel')}
                                    placeholder={
                                        selectedAddress === null
                                            ? t('commerce:checkout.fromAddress')
                                            : t('commerce:checkout.noNote')
                                    }
                                    value={selectedAddress?.notes ?? ''}
                                    disabled
                                />
                            </FieldCell>
                        </FieldRow>
                        <View className="flex-row">
                            <TextLink
                                testID="checkout-manage-addresses"
                                label={t('commerce:checkout.addAddress')}
                                onPress={() => {
                                    router.push('/customer/account/addresses' as never);
                                }}
                            />
                        </View>
                    </View>
                </QueryStates>
            </View>

            <View className="mt-5" testID="checkout-slot">
                {slotCode === null ? (
                    <Callout
                        testID="checkout-slot-none"
                        role="alert"
                        tone="warning"
                        icon="warning"
                        title={t('commerce:checkout.slotTitle')}
                        body={t('commerce:checkout.noSlotsOffered')}
                    />
                ) : (
                    <ChoiceChips
                        testID="checkout-slot-picker"
                        label={t('commerce:checkout.slotTitle')}
                        value={slotCode}
                        onChange={(next) => {
                            setSlotCode(next);
                            setCommitted(null);
                        }}
                        options={slotOptions.map((slot) => ({
                            value: slot.code,
                            label: t('commerce:checkout.slotChip', {
                                slot: slotName(slot.code),
                                from: slot.startsAt,
                                to: slot.endsAt,
                            }),
                            testID: `checkout-slot-${slot.code}`,
                        }))}
                    />
                )}
            </View>

            <View className="mt-6 flex-row">
                <Button
                    testID="checkout-review"
                    size="lg"
                    label={t('commerce:checkout.review')}
                    onPress={onReview}
                />
            </View>
        </View>
    );

    /* ── step two: payment ──────────────────────────────────────────────────────────────────── */

    const paymentStep =
        committed === null ? null : (
            <View className="flex-col" testID="checkout-payment-step">
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="font-display text-2xl font-bold tracking-display text-content-primary text-start"
                >
                    {t('commerce:checkout.paymentTitle')}
                </RNText>
                {/* What is being committed to, in one muted line under the heading — the design's
                    payment card has no room for a review table, and the details step is one
                    "Back" away. */}
                <RNText className="mb-5 mt-1 text-sm text-content-secondary text-start">
                    <RNText testID="checkout-committed-address">
                        {t('commerce:checkout.deliveringTo', { address: committed.addressLabel })}
                    </RNText>
                    {t('commerce:checkout.committedSeparator')}
                    <RNText testID="checkout-committed-slot">{slotSentence(committed)}</RNText>
                </RNText>

                <View
                    testID="checkout-payment-methods"
                    role="radiogroup"
                    accessibilityRole="radiogroup"
                    aria-label={t('commerce:checkout.paymentTitle')}
                    accessibilityLabel={t('commerce:checkout.paymentTitle')}
                    className="flex-col gap-2.5"
                >
                    <RadioRow
                        testID="checkout-payment-cod"
                        label={t('commerce:checkout.paymentCod')}
                        meta={t('commerce:checkout.paymentCodMeta')}
                        chosen
                    />
                </View>

                {setupSteps.length === 0 ? null : (
                    <View className="mt-5">
                        <Callout
                            testID="checkout-setup-required"
                            role="alert"
                            tone="warning"
                            icon="warning"
                            title={t('commerce:checkout.setupTitle')}
                            body={t('commerce:checkout.setupBody', { count: setupSteps.length })}
                        >
                            <AccountSetupSteps steps={setupSteps} testID="checkout-setup-step" />
                        </Callout>
                    </View>
                )}

                {placeFailure === null ||
                (setupSteps.length > 0 && orderReasons.length === 0) ? null : (
                    <View className="mt-5">
                        <Callout
                            testID="checkout-place-error"
                            role="alert"
                            tone="danger"
                            icon="warning"
                            title={t('commerce:checkout.placeFailedTitle')}
                            body={t(
                                FAILURE_MESSAGE_KEYS[placeFailure.code],
                                // The server's own sentence only when this build has no copy for
                                // the code — never in preference to it.
                                { defaultValue: placeFailure.message },
                            )}
                            actions={
                                accountInactive ? (
                                    <Button
                                        testID="checkout-finish-setup"
                                        label={t('commerce:checkout.finishSetup')}
                                        onPress={() => {
                                            router.push('/customer/account' as never);
                                        }}
                                    />
                                ) : undefined
                            }
                        >
                            {orderReasons.length === 0 ? null : (
                                <View
                                    className="flex-col gap-1"
                                    testID="checkout-place-error-reasons"
                                >
                                    {orderReasons.map((entry) => (
                                        <Text
                                            key={entry.reason}
                                            variant="caption"
                                            testID={`checkout-place-error-reason-${entry.reason}`}
                                        >
                                            {`• ${t(`errors:orderRefusal.${entry.reason}`, {
                                                defaultValue: entry.reason,
                                            })}`}
                                        </Text>
                                    ))}
                                </View>
                            )}
                        </Callout>
                    </View>
                )}

                <View className="mt-6 flex-row gap-2.5">
                    <Button
                        testID="checkout-edit"
                        variant="secondary"
                        size="lg"
                        label={t('commerce:checkout.back')}
                        onPress={() => {
                            setCommitted(null);
                        }}
                    />
                    <View className="min-w-0 flex-1">
                        <Button
                            testID="checkout-place-order"
                            block
                            size="lg"
                            label={
                                quotation === undefined
                                    ? t('commerce:checkout.placeOrder')
                                    : t('commerce:checkout.placeOrderTotal', {
                                          total: formatMoney(formatter, quotation.total),
                                      })
                            }
                            accessibilityHint={t('commerce:checkout.placeOrderHint')}
                            loading={placeOrder.isPending}
                            // No confirmed total, no placement.
                            disabled={quotation === undefined}
                            onPress={onPlace}
                        />
                    </View>
                </View>
            </View>
        );

    /* ── the rail ───────────────────────────────────────────────────────────────────────────── */

    const summary =
        basket === undefined ? null : (
            <SummaryRail
                testID="checkout-summary"
                countTestID="checkout-summary-count"
                itemsTestID="checkout-items"
                itemCount={basket.itemCount}
                items={basket.items.map((item) => ({
                    key: item.id,
                    name: item.name,
                    quantity: item.quantity,
                    lineTotal: item.lineTotal,
                }))}
            >
                <QueryStates
                    query={preview}
                    isEmpty={false}
                    emptyTitle={t('commerce:cart.summaryEmpty')}
                    skeletonCount={1}
                    testID="checkout-preview"
                >
                    {quotation === undefined ? null : (
                        <View className="flex-col gap-4">
                            <SummaryTotal
                                testID="checkout-price-total"
                                label={t('commerce:cart.total')}
                                total={quotation.total}
                                rule
                            />
                            {displayableWarnings(quotation.warnings).map((code) => (
                                <Callout
                                    key={code}
                                    testID={`checkout-warning-${code.replace(/\./g, '-')}`}
                                    role={isCriticalWarning(code) ? 'alert' : 'note'}
                                    tone={isCriticalWarning(code) ? 'danger' : 'warning'}
                                    icon="warning"
                                    title={t('commerce:warnings.title')}
                                    body={t(warningMessageKey(code), { code })}
                                />
                            ))}
                        </View>
                    )}
                </QueryStates>
            </SummaryRail>
        );

    return (
        <CheckoutPage testID="checkout-screen">
            <CheckoutTitle testID="checkout-title">{t('commerce:checkout.title')}</CheckoutTitle>

            {/* Delivery → Payment → Confirmation. Payment is the committed state the two-phase
                flow below already tracks; the third segment is reached only by a placed order. */}
            <CheckoutSteps
                testID="checkout-stepper"
                label={t('commerce:checkout.progressLabel')}
                steps={steps}
                current={committed === null ? 1 : 2}
            />

            <QueryStates
                query={cart}
                isEmpty={basket !== undefined && basket.items.length === 0}
                emptyTitle={t('commerce:checkout.emptyTitle')}
                emptyBody={t('commerce:checkout.emptyBody')}
                emptyActions={
                    <Button
                        testID="checkout-browse"
                        label={t('commerce:cart.browse')}
                        onPress={() => {
                            router.push('/meals');
                        }}
                    />
                }
                skeletonCount={2}
                testID="checkout"
            >
                <CheckoutColumns
                    testID="checkout-layout"
                    asideWidth="md"
                    main={
                        <CheckoutCard padding="lg" testID="checkout-step-card">
                            {committed === null ? deliveryStep : paymentStep}
                        </CheckoutCard>
                    }
                    aside={summary}
                />
            </QueryStates>
        </CheckoutPage>
    );
}

/* ── pieces ─────────────────────────────────────────────────────────────────────────────────── */

function StepHeading({ title, body }: { readonly title: string; readonly body: string }) {
    return (
        <View className="flex-col gap-1">
            <RNText
                accessibilityRole="header"
                aria-level={2}
                className="font-display text-2xl font-bold tracking-display text-content-primary text-start"
            >
                {title}
            </RNText>
            <RNText className="text-sm text-content-secondary text-start">{body}</RNText>
        </View>
    );
}

interface SummaryRailProps {
    readonly testID: string;
    readonly countTestID?: string | undefined;
    readonly itemsTestID: string;
    readonly itemCount: number;
    readonly items: readonly SummaryItem[];
    readonly children: ReactNode;
}

/** The design's checkout rail: "N ITEMS", one line per meal, then the total under a rule. */
function SummaryRail({
    testID,
    countTestID,
    itemsTestID,
    itemCount,
    items,
    children,
}: SummaryRailProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <CheckoutCard testID={testID}>
            <View className="flex-col">
                <Eyebrow testID={countTestID}>
                    {t('commerce:checkout.itemCount', {
                        count: itemCount,
                        items: formatter.formatNumber(itemCount),
                    })}
                </Eyebrow>
                <View className="mb-4 mt-3">
                    <SummaryItems testID={itemsTestID} items={items} />
                </View>
                {children}
            </View>
        </CheckoutCard>
    );
}

interface OrderPlacedProps {
    readonly order: PlacedOrder;
    readonly kitchenName: string | null;
    /** "Midday on 13 Aug 2026" — the committed window, already worded. */
    readonly arriving: string;
    readonly onTrack: () => void;
}

/**
 * The confirmation, as the design's third step: a centred acknowledgement in the step card — the
 * check badge, "Order … confirmed", one line, "Track this order" — and the order's own lines and
 * total in the rail.
 *
 * Priced from the order, not from the checkout preview. Placement empties the basket, which
 * disables the preview query — a confirmation that read its figures from there rendered an empty
 * price block. The placed order carries the figures the platform actually charged for.
 *
 * "Track this order" goes to `/customer/orders/{order}` — the identifier, not the printed
 * reference, because that is what `GET /me/orders/{order}` takes.
 */
function OrderPlaced({ order, kitchenName, arriving, onTrack }: OrderPlacedProps) {
    const { t } = useTranslation();
    const itemCount = order.lines.reduce((count, line) => count + line.quantity, 0);

    const main = (
        <CheckoutCard padding="lg" testID="checkout-success-card">
            <View className="flex-col items-center px-2 py-6">
                <View className="h-14 w-14 items-center justify-center rounded-full bg-surface-brand-subtle">
                    <Icon name="check" size="lg" className="text-content-on-brand-subtle" />
                </View>
                <RNText
                    testID="checkout-success-title"
                    accessibilityRole="header"
                    aria-level={2}
                    className="mb-2 mt-4 font-display text-3xl font-bold tracking-display text-content-primary text-center"
                >
                    {t('commerce:checkout.confirmedTitle', { reference: order.reference })}
                </RNText>
                <RNText
                    testID="checkout-success-body"
                    role="status"
                    className="mb-5 max-w-[52ch] text-base text-content-secondary text-center"
                >
                    {t('commerce:checkout.confirmedBody', {
                        kitchen: kitchenName ?? t('commerce:checkout.theKitchen'),
                        arriving,
                    })}
                </RNText>
                <Button
                    testID="checkout-success-track"
                    label={t('commerce:checkout.successTrack')}
                    onPress={onTrack}
                />
            </View>
        </CheckoutCard>
    );

    const aside = (
        <SummaryRail
            testID="checkout-success-rail"
            itemsTestID="checkout-success-items"
            itemCount={itemCount}
            items={order.lines.map((line) => ({
                key: line.id,
                name: line.name,
                quantity: line.quantity,
                lineTotal: line.lineTotal,
            }))}
        >
            <SummaryTotal
                testID="checkout-success-total"
                label={t('commerce:cart.total')}
                total={order.total}
                rule
            />
        </SummaryRail>
    );

    return (
        <CheckoutColumns
            testID="checkout-success-layout"
            asideWidth="md"
            main={main}
            aside={aside}
        />
    );
}
