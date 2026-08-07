import {
    Button,
    Callout,
    Card,
    DateField,
    FAILURE_MESSAGE_KEYS,
    Heading,
    Inline,
    SegmentedControl,
    Select,
    Stack,
    Text,
} from '@healthy360/design-system';
import type {
    Cart,
    CheckoutPreview,
    CustomerAddress,
    PlacedOrder,
} from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAddressesQuery } from '../../../data/account-hooks.ts';
import {
    toFailure,
    useCartQuery,
    useCheckoutPreviewQuery,
    usePlaceOrderMutation,
} from '../../../data/commerce-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { earliestStartDate } from '../dates.ts';
import {
    defaultSlotCodeForKitchen,
    deliverySlotByCode,
    deliverySlotsForKitchen,
} from '../delivery.ts';
import { PriceSummary } from '../price-summary.tsx';
import type { PriceRow } from '../price-summary.tsx';
import { displayableWarnings, isCriticalWarning, warningMessageKey } from '../warnings.ts';

/**
 * `/customer/checkout` — one-off order checkout against a saved address.
 *
 * Placement requires `addressId` (D-084): delivery zone/fee resolve from the address book, not a
 * typed street line. Payment is collected at the door (COD) or via the card
 * sandbox when a payment intent is created after placement — never card PAN in-app.
 */

type Phase = 'collecting' | 'placed';

interface CommittedDelivery {
    readonly addressId: string;
    readonly addressLabel: string;
    readonly slotCode: string;
    readonly deliveryDate: string;
}

function formatSavedAddress(address: CustomerAddress): string {
    const parts = [address.label, address.line1, address.areaName].filter(
        (part) => part.trim() !== '',
    );
    return parts.join(' · ');
}

export function CheckoutScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
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

    const [addressId, setAddressId] = useState<string | null>(null);
    const [chosenSlotCode, setSlotCode] = useState<string | null>(null);
    const [deliveryDate, setDeliveryDate] = useState<string | null>(() => earliestStartDate());
    const [showErrors, setShowErrors] = useState(false);
    const [committed, setCommitted] = useState<CommittedDelivery | null>(null);
    const [phase, setPhase] = useState<Phase>('collecting');
    const [placed, setPlaced] = useState<PlacedOrder | null>(null);

    /*
     * The slot is *derived* while nobody has chosen one, rather than seeded by an effect.
     *
     * The effect this replaces set state during render-commit, which the linter flags for a real
     * reason: it produced a first paint showing a slot the kitchen does not offer, then a second
     * one correcting it. Deriving means the very first render already shows the kitchen's default,
     * and an explicit choice that the kitchen turns out not to offer — the basket changed kitchen
     * under the person — falls back to the default rather than sticking.
     */
    const chosenSlotIsOffered =
        chosenSlotCode !== null && deliverySlots.some((slot) => slot.code === chosenSlotCode);
    const slotCode = chosenSlotIsOffered ? chosenSlotCode : defaultSlotCodeForKitchen(kitchen.data);

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
    const placeFailure = toFailure(placeOrder.error);

    /*
     * A refusal names *every* reason it was refused for, and the checkout lists them.
     *
     * The alternative — one sentence saying the order could not be placed — sends somebody back to
     * a basket with nothing to change. Reasons the catalogue has no copy for still appear, as the
     * server's own code, because a refusal this build has not learned about yet is still a fact
     * about somebody's dinner.
     */
    const refusalReasons =
        placeFailure?.code === 'order.placement_refused' ? placeFailure.reasons : [];

    const rows: readonly PriceRow[] =
        quotation === undefined
            ? []
            : [
                  {
                      key: 'subtotal',
                      label: t('commerce:cart.subtotal'),
                      amount: quotation.subtotal,
                  },
                  ...(quotation.deliveryFee === null
                      ? [
                            {
                                key: 'delivery-free',
                                label: t('commerce:cart.delivery'),
                                amount: { amount: 0, currency: quotation.total.currency },
                                note: t('commerce:cart.deliveryAtPlacement'),
                            },
                        ]
                      : [
                            {
                                key: 'delivery',
                                label: t('commerce:cart.delivery'),
                                amount: quotation.deliveryFee,
                            },
                        ]),
                  {
                      key: 'total',
                      label: t('commerce:cart.total'),
                      amount: quotation.total,
                      emphasis: true,
                  },
              ];

    if (phase === 'placed' && placed !== null && committed !== null) {
        return (
            <OrderPlaced
                order={placed}
                delivery={committed}
                onBrowse={() => {
                    router.push('/meals');
                }}
                onCart={() => {
                    router.push('/customer/cart' as never);
                }}
                onSubscriptions={() => {
                    router.push('/customer/subscriptions' as never);
                }}
            />
        );
    }

    const onReview = () => {
        setShowErrors(true);
        if (selectedAddress === null || deliveryDate === null) return;
        setCommitted({
            addressId: selectedAddress.id,
            addressLabel: formatSavedAddress(selectedAddress),
            slotCode,
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

    return (
        <Stack space="lg" testID="checkout-screen">
            <Stack space="xs">
                <Heading level={1} testID="checkout-title">
                    {t('commerce:checkout.title')}
                </Heading>
                <Text tone="secondary">{t('commerce:checkout.body')}</Text>
            </Stack>

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
                {basket === undefined ? null : (
                    <Stack space="lg">
                        <Stack space="sm" testID="checkout-address">
                            <Text variant="label">{t('commerce:checkout.addressTitle')}</Text>
                            <Text tone="secondary" variant="caption">
                                {t('commerce:checkout.addressBody')}
                            </Text>
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
                                    placeholder={t('commerce:checkout.addressTitle')}
                                />
                                {showErrors && addressId === null ? (
                                    <Text
                                        tone="danger"
                                        variant="caption"
                                        testID="checkout-address-error"
                                    >
                                        {t('commerce:validation.required')}
                                    </Text>
                                ) : null}
                            </QueryStates>
                        </Stack>

                        <Stack space="sm" testID="checkout-slot">
                            <Text variant="label">{t('commerce:checkout.slotTitle')}</Text>
                            <SegmentedControl
                                testID="checkout-slot-picker"
                                label={t('commerce:checkout.slotTitle')}
                                block
                                value={slotCode}
                                onChange={(next) => {
                                    setSlotCode(next);
                                    setCommitted(null);
                                }}
                                items={deliverySlots.map((slot) => ({
                                    value: slot.code,
                                    label:
                                        slot.label ??
                                        t(`commerce:slots.${slot.code}`, {
                                            defaultValue: slot.code,
                                        }),
                                    testID: `checkout-slot-${slot.code}`,
                                }))}
                            />
                            <Text tone="secondary" variant="caption" testID="checkout-slot-window">
                                {t('commerce:checkout.slotWindow', {
                                    from: deliverySlotByCode(slotCode, kitchen.data)?.startsAt,
                                    to: deliverySlotByCode(slotCode, kitchen.data)?.endsAt,
                                })}
                            </Text>
                        </Stack>

                        <Stack space="sm" testID="checkout-date">
                            <DateField
                                testID="checkout-date-field"
                                label={t('commerce:checkout.dateLabel')}
                                hint={t('commerce:checkout.dateHint')}
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
                        </Stack>

                        <Card testID="checkout-summary" padding="md" tone="sunken">
                            <Stack space="md">
                                <Text variant="label">{t('commerce:checkout.summaryTitle')}</Text>
                                <QueryStates
                                    query={preview}
                                    isEmpty={quotation === undefined}
                                    emptyTitle={t('commerce:cart.summaryEmpty')}
                                    skeletonCount={1}
                                    testID="checkout-preview"
                                >
                                    <Stack space="md">
                                        <PriceSummary
                                            rows={rows}
                                            testID="checkout-price"
                                            caption={
                                                committed === null
                                                    ? t('commerce:checkout.priceBeforeReview')
                                                    : t('commerce:checkout.priceAfterReview')
                                            }
                                        />

                                        {displayableWarnings(quotation?.warnings ?? []).map(
                                            (code) => (
                                                <Callout
                                                    key={code}
                                                    testID={`checkout-warning-${code.replace(/\./g, '-')}`}
                                                    role={
                                                        isCriticalWarning(code) ? 'alert' : 'note'
                                                    }
                                                    tone={
                                                        isCriticalWarning(code)
                                                            ? 'danger'
                                                            : 'warning'
                                                    }
                                                    icon="warning"
                                                    title={t('commerce:warnings.title')}
                                                    body={t(warningMessageKey(code), { code })}
                                                />
                                            ),
                                        )}

                                        <Callout
                                            testID="checkout-payment-notice"
                                            role="note"
                                            tone="info"
                                            icon="info"
                                            title={t('commerce:checkout.paymentNoticeTitle')}
                                            body={t('commerce:checkout.paymentNoticeBody')}
                                        />

                                        {placeFailure === null ? null : (
                                            <Callout
                                                testID="checkout-place-error"
                                                role="alert"
                                                tone="danger"
                                                icon="warning"
                                                title={t('commerce:checkout.placeFailedTitle')}
                                                body={t(
                                                    FAILURE_MESSAGE_KEYS[placeFailure.code],
                                                    // The server's own sentence only when this
                                                    // build has no copy for the code — never in
                                                    // preference to it.
                                                    { defaultValue: placeFailure.message },
                                                )}
                                            >
                                                {refusalReasons.length === 0 ? null : (
                                                    <Stack
                                                        space="xs"
                                                        testID="checkout-place-error-reasons"
                                                    >
                                                        {refusalReasons.map((entry) => (
                                                            <Text
                                                                key={entry.reason}
                                                                variant="caption"
                                                                testID={`checkout-place-error-reason-${entry.reason}`}
                                                            >
                                                                {`• ${t(
                                                                    `errors:orderRefusal.${entry.reason}`,
                                                                    { defaultValue: entry.reason },
                                                                )}`}
                                                            </Text>
                                                        ))}
                                                    </Stack>
                                                )}
                                            </Callout>
                                        )}

                                        {committed === null ? (
                                            <Button
                                                testID="checkout-review"
                                                block
                                                label={t('commerce:checkout.review')}
                                                onPress={onReview}
                                            />
                                        ) : (
                                            <Stack space="sm">
                                                <Text testID="checkout-committed-address">
                                                    {committed.addressLabel}
                                                </Text>
                                                <Text
                                                    tone="secondary"
                                                    variant="caption"
                                                    testID="checkout-committed-slot"
                                                >
                                                    {t('commerce:checkout.committedSlot', {
                                                        slot: t(
                                                            `commerce:slots.${committed.slotCode}`,
                                                            // Same treatment the picker gives: a
                                                            // kitchen may publish a window code
                                                            // this catalogue has never heard of,
                                                            // and the code itself reads better
                                                            // than `commerce:slots.late_evening`.
                                                            { defaultValue: committed.slotCode },
                                                        ),
                                                        date: formatter.formatDate(
                                                            committed.deliveryDate,
                                                            { dateStyle: 'full' },
                                                        ),
                                                    })}
                                                </Text>
                                                <Inline space="sm" wrap>
                                                    <Button
                                                        testID="checkout-edit"
                                                        variant="secondary"
                                                        label={t('commerce:checkout.edit')}
                                                        onPress={() => {
                                                            setCommitted(null);
                                                        }}
                                                    />
                                                    <Button
                                                        testID="checkout-place-order"
                                                        label={t('commerce:checkout.placeOrder')}
                                                        accessibilityHint={t(
                                                            'commerce:checkout.placeOrderHint',
                                                        )}
                                                        loading={placeOrder.isPending}
                                                        onPress={onPlace}
                                                    />
                                                </Inline>
                                            </Stack>
                                        )}
                                    </Stack>
                                </QueryStates>
                            </Stack>
                        </Card>
                    </Stack>
                )}
            </QueryStates>
        </Stack>
    );
}

interface OrderPlacedProps {
    readonly order: PlacedOrder;
    readonly delivery: CommittedDelivery;
    readonly onBrowse: () => void;
    readonly onCart: () => void;
    readonly onSubscriptions: () => void;
}

/** Catalogue copy for the price-line codes the order repository emits; unknown codes keep the
 * server's own label rather than disappearing. */
const PRICE_LINE_LABEL_KEYS: Record<string, string> = {
    subtotal: 'commerce:cart.subtotal',
    delivery: 'commerce:cart.delivery',
};

function OrderPlaced({ order, delivery, onBrowse, onCart, onSubscriptions }: OrderPlacedProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    /*
     * Priced from the order, not from the checkout preview. Placement empties the basket, which
     * disables the preview query — a confirmation that read its figures from there rendered an
     * empty price block. The placed order carries the figures the platform actually charged for.
     */
    const rows: readonly PriceRow[] = [
        ...order.priceLines.map((line) => {
            const labelKey = PRICE_LINE_LABEL_KEYS[line.code];
            return {
                key: line.code,
                label: labelKey === undefined ? line.label : t(labelKey),
                amount: line.amount,
            };
        }),
        {
            key: 'total',
            label: t('commerce:cart.total'),
            amount: order.total,
            emphasis: true,
        },
    ];

    return (
        <Stack space="lg" testID="checkout-success-screen">
            <Callout
                testID="checkout-success-notice"
                role="status"
                tone="success"
                icon="success"
                title={t('commerce:checkout.successTitle')}
                body={t('commerce:checkout.successBody', { reference: order.reference })}
            />

            <Callout
                testID="checkout-success-cod"
                role="note"
                tone="info"
                icon="info"
                title={t('commerce:checkout.successCodTitle')}
                body={t('commerce:checkout.successCodBody')}
            />

            <Card testID="checkout-success-summary" padding="md" tone="sunken">
                <Stack space="md">
                    <Text variant="label">{t('commerce:checkout.successSummaryTitle')}</Text>
                    <Text testID="checkout-success-reference">{order.reference}</Text>
                    <Text testID="checkout-success-address">{delivery.addressLabel}</Text>
                    <Text tone="secondary" testID="checkout-success-slot">
                        {t('commerce:checkout.committedSlot', {
                            slot: t(`commerce:slots.${delivery.slotCode}`, {
                                defaultValue: delivery.slotCode,
                            }),
                            date: formatter.formatDate(delivery.deliveryDate, {
                                dateStyle: 'full',
                            }),
                        })}
                    </Text>
                    <PriceSummary
                        rows={rows}
                        testID="checkout-success-price"
                        caption={t('commerce:checkout.successPriceCaption')}
                    />
                </Stack>
            </Card>

            <Inline space="sm" wrap testID="checkout-success-actions">
                <Button
                    testID="checkout-success-cart"
                    variant="secondary"
                    label={t('commerce:checkout.successCart')}
                    onPress={onCart}
                />
                <Button
                    testID="checkout-success-browse"
                    variant="secondary"
                    label={t('commerce:cart.browse')}
                    onPress={onBrowse}
                />
                <Button
                    testID="checkout-success-subscriptions"
                    label={t('commerce:checkout.successSubscriptions')}
                    onPress={onSubscriptions}
                />
            </Inline>
        </Stack>
    );
}
