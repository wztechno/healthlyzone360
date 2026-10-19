import {
    Button,
    Callout,
    DateField,
    FAILURE_MESSAGE_KEYS,
    Icon,
    Inline,
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
import { OrderId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useAccountChecklistQuery, useAddressesQuery } from '../../../data/account-hooks.ts';
import {
    toFailure,
    useCartQuery,
    useCheckoutPreviewQuery,
    useMyOrderQuery,
    usePlaceOrderMutation,
} from '../../../data/commerce-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { queryKeys } from '../../../data/query-keys.ts';
import { withReturnTo } from '../../../navigation/return-to.ts';
import { usePreviousEntry } from '../../../navigation/use-return-to.ts';
import { usePrototypeAction } from '../../../prototype/index.ts';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { AccountSetupPanel, stepForRequirement } from '../../account/account-setup-steps.tsx';
import type { AccountSetupStep } from '../../account/account-setup-steps.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import {
    CHECKOUT_PATH,
    checkoutHref,
    isIsoDate,
    LATEST_PLACED,
    placedOrders,
    readCheckoutDraft,
} from '../checkout-draft.ts';
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
    SummaryRow,
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
 * in the address book ("Edit this address"), not here. The date sits where the design's ZIP does;
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
 *
 * ## Nothing here lives in component memory
 *
 * Address, date, window, step and the placed order are all in the URL (`../checkout-draft.ts`).
 * The customer area is one `<Slot/>`, so a detour to add an address unmounts this screen; with the
 * choices in the query, it comes back exactly as it was left, and so does a refresh.
 */

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
    const queryClient = useQueryClient();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const runPrototype = usePrototypeAction();
    const draft = readCheckoutDraft(useLocalSearchParams());
    const previous = usePreviousEntry();
    const channelCode = draft.channel;

    const cart = useCartQuery(true, channelCode);
    const basket: Cart | undefined = cart.data;
    const addresses = useAddressesQuery();
    const checklist = useAccountChecklistQuery();
    const placeOrder = usePlaceOrderMutation(channelCode);
    const latestPlaced = placedOrders.useDraft(LATEST_PLACED);

    const placedId = draft.placed === undefined ? null : OrderId.safeParse(draft.placed);
    const placedOrder = useMyOrderQuery(placedId);

    const kitchenId = basket?.items[0]?.kitchenId ?? null;
    const kitchen = useKitchenQuery(kitchenId);
    const deliverySlots = deliverySlotsForKitchen(kitchen.data);
    const kitchenOffersPickup = kitchen.data?.channels.pickup === true;

    const [showErrors, setShowErrors] = useState(false);

    const addressList = addresses.data ?? [];
    /*
     * Every choice comes from the URL (`../checkout-draft.ts`) and is checked against live data
     * before it is believed; anything missing or no longer valid falls back to what the screen
     * would have picked on its own. So the address is the one in the URL when it is still in the
     * book, else the default address, else the only one there is (HA-22) — somebody with one
     * address is never made to open a list of one to pick it.
     */
    const addressId =
        (draft.address !== undefined && addressList.some((entry) => entry.id === draft.address)
            ? draft.address
            : null) ??
        addressList.find((entry) => entry.isDefault)?.id ??
        (addressList.length === 1 ? (addressList[0]?.id ?? null) : null);
    const selectedAddress = addressList.find((entry) => entry.id === addressId) ?? null;

    const earliestDate = earliestStartDate();
    const deliveryDate =
        isIsoDate(draft.date) && draft.date >= earliestDate ? draft.date : earliestDate;

    // A plain object: the query hashes its key, so a new one each render asks for nothing new.
    const previewRequest =
        basket === undefined || basket.items.length === 0
            ? null
            : {
                  cartId: basket.id,
                  ...(addressId === null ? {} : { addressId }),
                  deliveryDate,
              };

    const preview = useCheckoutPreviewQuery(previewRequest);
    const quotation: CheckoutPreview | undefined = preview.data;

    /*
     * Only the slots the address's zone offers: placement refuses any other (`window_not_offered`).
     * `null` codes — no address yet, or no serving zone — filter nothing. A choice the zone does not
     * offer falls back to the default over what it does, and a zone offering none says so.
     */
    const slotOptions = offeredSlots(deliverySlots, quotation?.offeredWindowCodes ?? null);
    const slotCode =
        draft.slot !== undefined && slotOptions.some((slot) => slot.code === draft.slot)
            ? draft.slot
            : defaultSlotCode(slotOptions);
    const placeFailure = toFailure(placeOrder.error);

    /*
     * The payment step is `?step=payment`, honoured only while the delivery details it commits to
     * are exactly the ones in its URL and all still valid. The delivery step may fill a gap with a
     * default; the payment step may not — it is the page that says "delivering to … on …" above
     * Place order, so a Back (or a link) that lands on it after the address was removed, the window
     * withdrawn or the date overtaken must not quietly swap in a different one and offer to place
     * that. Such an entry is put back on the delivery step, with the problem marked.
     *
     * Only once the data has *settled*, and the address book counts as settled only when it is not
     * fetching at all: coming back from adding an address, the book is refetched on remount, and
     * judging `?address=` against the copy from before the detour would throw the person off the
     * step they were on.
     */
    const committedToUrl =
        selectedAddress !== null &&
        slotCode !== null &&
        draft.address === addressId &&
        draft.date === deliveryDate &&
        draft.slot === slotCode;
    const onPayment = draft.step === 'payment' && committedToUrl;
    const settled =
        basket !== undefined && !addresses.isFetching && !kitchen.isLoading && !preview.isFetching;
    const strandedOnPayment = draft.step === 'payment' && !committedToUrl && settled;
    useEffect(() => {
        if (!strandedOnPayment) return;
        router.setParams({ step: undefined } as never);
    }, [router, strandedOnPayment]);

    /*
     * A refusal names *every* reason it was refused for, and the checkout lists them — one sentence
     * saying the order could not be placed sends somebody back to a basket with nothing to change.
     * Reasons the catalogue has no copy for still appear, as the server's own code.
     */
    const refusalReasons =
        placeFailure?.code === 'order.placement_refused' ? placeFailure.reasons : [];

    /*
     * Account setup is never "go to the account page and guess", and it is no longer a surprise at
     * the end. The account checklist is read up front, so the steps a new account still has to do
     * are listed on the first step, each a row that opens the screen that does it and comes back
     * here (`returnTo`) with every choice intact. Place order waits until the list is empty.
     *
     * The server's refusal stays as the backstop for a race — a step that became outstanding after
     * the checklist was read: one `account_not_ready` per requirement, naming it in `outstanding`
     * (and, for an address, whether one exists outside the served areas). Every other reason is
     * about the order itself and stays in the refusal's list.
     */
    const setupSteps: AccountSetupStep[] = [];
    for (const item of checklist.data?.items ?? []) {
        if (!item.required || item.complete) continue;
        setupSteps.push({
            step: item.step,
            blockedReason: item.blockedReason,
            ...(item.step === 'add_address' ? { hasAddress: addressList.length > 0 } : {}),
        });
    }
    let refusedForSetup = false;
    for (const entry of refusalReasons) {
        if (entry.reason !== 'account_not_ready') continue;
        const step = stepForRequirement(entry.context['outstanding']);
        if (step === null) continue;
        refusedForSetup = true;
        if (setupSteps.some((existing) => existing.step === step)) continue;
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

    /*
     * Where a detour comes back to: this page as it stands, with the defaults the screen derived
     * written out, so returning restores exactly what was on screen.
     */
    const here = checkoutHref({
        channel: channelCode,
        address: addressId ?? undefined,
        date: deliveryDate,
        slot: slotCode ?? undefined,
        step: onPayment ? 'payment' : undefined,
    });
    const openDetour = (href: string) => {
        router.push(withReturnTo(href, here) as never);
    };

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

    const slotSentence = (slotLabel: string, date: string) =>
        t('commerce:checkout.committedSlot', {
            slot: slotLabel,
            date: formatter.formatDate(date, { dateStyle: 'medium' }),
        });

    /*
     * The confirmation is `?placed={order}`, read back from the order itself, so a refresh, or Back
     * from "Track this order", shows it again rather than an empty checkout.
     */
    if (placedId !== null) {
        const order = placedOrder.data;
        const note = latestPlaced?.orderId === placedId ? latestPlaced : null;
        const orderSlot =
            order === undefined
                ? ''
                : (note?.slotLabel ??
                  (locale.toLowerCase().startsWith('ar')
                      ? order.slotNames?.ar
                      : order.slotNames?.en) ??
                  order.slotNames?.en ??
                  slotName(order.slotCode));
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
                <QueryStates
                    query={placedOrder}
                    isEmpty={false}
                    treatFailuresAsEmpty={['resource.not_found']}
                    emptyTitle={t('account:orders.notFoundTitle')}
                    emptyBody={t('account:orders.notFoundBody')}
                    skeletonCount={2}
                    testID="checkout-placed"
                >
                    {order === undefined ? null : (
                        <OrderPlaced
                            order={order}
                            kitchenName={note?.kitchenName ?? null}
                            arriving={slotSentence(orderSlot, order.deliveryDate)}
                            onTrack={() => {
                                router.push(`/customer/orders/${order.id}` as never);
                            }}
                        />
                    )}
                </QueryStates>
            </CheckoutPage>
        );
    }

    const onReview = () => {
        setShowErrors(true);
        if (selectedAddress === null || slotCode === null) return;
        // A step of its own in history, so Back from Payment returns to Delivery.
        router.push(
            checkoutHref({
                channel: channelCode,
                address: selectedAddress.id,
                date: deliveryDate,
                slot: slotCode,
                step: 'payment',
            }) as never,
        );
    };

    const onBackToDelivery = () => {
        // Back when the delivery step is the entry underneath; otherwise (a refresh, a link) the
        // step is taken off this entry, so the in-card Back never leaves the checkout.
        if (
            previous !== null &&
            previous.pathname === CHECKOUT_PATH &&
            previous.params['step'] !== 'payment'
        ) {
            router.back();
        } else {
            router.setParams({ step: undefined } as never);
        }
    };

    const committed =
        onPayment && selectedAddress !== null && slotCode !== null
            ? {
                  addressId: selectedAddress.id,
                  addressLabel: formatSavedAddress(selectedAddress),
                  slotCode,
                  slotLabel: slotName(slotCode),
                  kitchenName: kitchen.data?.name ?? null,
                  deliveryDate,
              }
            : null;

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
                    placedOrders.write(LATEST_PLACED, {
                        orderId: order.id,
                        kitchenName: committed.kitchenName,
                        slotLabel: committed.slotLabel,
                    });
                    // Replaces the payment step: Back from the confirmation is not a second chance
                    // to place the same order.
                    router.replace(
                        checkoutHref({ channel: channelCode, placed: order.id }) as never,
                    );
                },
                onError: () => {
                    // A setup refusal means the checklist read earlier is out of date.
                    void queryClient.invalidateQueries({
                        queryKey: queryKeys.account.checklist(),
                    });
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
                            label={t('commerce:checkout.addAddressAction')}
                            onPress={() => {
                                openDetour('/customer/account/addresses/new');
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
                                        router.setParams({ address: next ?? undefined } as never);
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
                                            router.setParams({ date: next ?? undefined } as never);
                                        }}
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
                        <View className="flex-row flex-wrap gap-x-5 gap-y-2">
                            {selectedAddress === null ? null : (
                                <TextLink
                                    testID="checkout-edit-address"
                                    label={t('commerce:checkout.editAddress')}
                                    onPress={() => {
                                        openDetour(
                                            `/customer/account/addresses/${selectedAddress.id}`,
                                        );
                                    }}
                                />
                            )}
                            <TextLink
                                testID="checkout-manage-addresses"
                                label={t('commerce:checkout.addAnotherAddress')}
                                onPress={() => {
                                    openDetour('/customer/account/addresses/new');
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
                            router.setParams({ slot: next } as never);
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
                    // No saved address, nothing to continue with — the empty state above says what
                    // to do, and the disabled button says it again to somebody who cannot see it.
                    disabled={addresses.isSuccess && addressList.length === 0}
                    {...(addresses.isSuccess && addressList.length === 0
                        ? { accessibilityHint: t('commerce:checkout.noAddressTitle') }
                        : {})}
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
                    <RNText testID="checkout-committed-slot">
                        {slotSentence(committed.slotLabel, committed.deliveryDate)}
                    </RNText>
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
                                            openDetour('/customer/account');
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
                        onPress={onBackToDelivery}
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
                            accessibilityHint={
                                setupSteps.length > 0
                                    ? t('commerce:checkout.placeOrderBlockedHint')
                                    : t('commerce:checkout.placeOrderHint')
                            }
                            loading={placeOrder.isPending}
                            // No confirmed total, no placement; nor while account steps are left.
                            disabled={quotation === undefined || setupSteps.length > 0}
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
                            {/*
                             * What the total is made of, as the basket showed it (HA-22): a total
                             * that grew by the delivery fee with no line saying so read as an error.
                             */}
                            <View className="flex-col gap-3">
                                <SummaryRow
                                    testID="checkout-price-subtotal"
                                    label={t('commerce:cart.subtotal')}
                                    value={formatMoney(formatter, quotation.subtotal)}
                                />
                                {/* Unknown until an address is chosen; the warning below says so. */}
                                {quotation.deliveryFee === null ? null : (
                                    <SummaryRow
                                        testID="checkout-price-delivery"
                                        label={t('commerce:cart.delivery')}
                                        value={formatMoney(formatter, quotation.deliveryFee)}
                                    />
                                )}
                            </View>
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
                    <Inline space="sm">
                        {/* Back from a confirmation lands here, on the now-empty basket's
                            checkout: the order that emptied it is one press away. */}
                        {latestPlaced === null ? null : (
                            <Button
                                testID="checkout-track-latest"
                                label={t('commerce:checkout.successTrack')}
                                onPress={() => {
                                    router.push(
                                        `/customer/orders/${latestPlaced.orderId}` as never,
                                    );
                                }}
                            />
                        )}
                        <Button
                            testID="checkout-browse"
                            variant={latestPlaced === null ? 'primary' : 'secondary'}
                            label={t('commerce:cart.browse')}
                            onPress={() => {
                                router.push('/meals');
                            }}
                        />
                    </Inline>
                }
                skeletonCount={2}
                testID="checkout"
            >
                <CheckoutColumns
                    testID="checkout-layout"
                    asideWidth="md"
                    main={
                        <CheckoutCard padding="lg" testID="checkout-step-card">
                            {setupSteps.length === 0 ? null : (
                                <View className="mb-6">
                                    <AccountSetupPanel
                                        testID="checkout-setup-required"
                                        role={refusedForSetup ? 'alert' : 'status'}
                                        title={t('commerce:checkout.setupTitle')}
                                        body={t('commerce:checkout.setupBody', {
                                            count: setupSteps.length,
                                        })}
                                        steps={setupSteps}
                                        stepsTestID="checkout-setup-step"
                                        returnTo={here}
                                    />
                                </View>
                            )}
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
