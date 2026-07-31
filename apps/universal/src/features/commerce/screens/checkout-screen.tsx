import {
    Button,
    Callout,
    Card,
    DateField,
    Heading,
    Inline,
    SegmentedControl,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { Cart, CheckoutPreview, DeliveryAddress } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCartQuery, useCheckoutPreviewQuery } from '../../../data/commerce-hooks.ts';
import { PrototypeNotice } from '../../../prototype/index.ts';
import { useValidationTranslate } from '../../../screens/form-helpers.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { EMPTY_ADDRESS, formatAddress, toDeliveryAddress, validateAddress } from '../address.ts';
import type { AddressField, AddressValues } from '../address.ts';
import { AddressForm } from '../address-form.tsx';
import { earliestStartDate } from '../dates.ts';
import { DEFAULT_SLOT_CODE, DELIVERY_SLOTS } from '../delivery.ts';
import { PriceSummary } from '../price-summary.tsx';
import type { PriceRow } from '../price-summary.tsx';
import { displayableWarnings, isCriticalWarning, warningMessageKey } from '../warnings.ts';

/**
 * `/customer/checkout` — the one-off order checkout, as a prototype.
 *
 * ## No payment fields, anywhere, ever
 *
 * There is no card number here, no expiry, no CVC, no wallet button and no saved-instrument list —
 * and there is nowhere for one to be added later without a contract change, because
 * `CommerceRepository` has no method that takes a payment and no `confirmCheckout` at all. That is
 * deliberate on both sides: a contract that *could* take a payment is a contract somebody
 * eventually wires to a live gateway by accident (`contracts/commerce.ts` says so itself).
 *
 * ## Placing the order is the one prototype action on this screen
 *
 * Everything else — the basket, the pricing, the slot — is real. "Place order" is not, because
 * there is no order to place: no `POST /api/v1/orders` exists, no kitchen is notified and no money
 * moves. So it does not show a toast and disappear. It renders a **success screen** that says, in
 * the person's own language, that nothing was ordered and no payment was taken, and it leaves the
 * basket exactly as it was — because an emptied basket would be the interface asserting that
 * something happened.
 *
 * ## Why the summary is priced twice
 *
 * The first preview prices the basket alone, so a total is on screen before any typing. Pressing
 * *Review order* commits the address, the slot and the date and asks for a second, complete
 * quotation. Re-pricing on every keystroke would be a request per character typed into a street
 * name, which is not something to teach a backend to expect.
 */

type Phase = 'collecting' | 'placed';

interface CommittedDelivery {
    readonly address: DeliveryAddress;
    readonly slotCode: string;
    readonly deliveryDate: string;
}

export function CheckoutScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const validationTranslate = useValidationTranslate();

    const cart = useCartQuery();
    const basket: Cart | undefined = cart.data;

    const [values, setValues] = useState<AddressValues>(EMPTY_ADDRESS);
    const [slotCode, setSlotCode] = useState<string>(DEFAULT_SLOT_CODE);
    const [deliveryDate, setDeliveryDate] = useState<string | null>(() => earliestStartDate());
    const [showErrors, setShowErrors] = useState(false);
    const [committed, setCommitted] = useState<CommittedDelivery | null>(null);
    const [phase, setPhase] = useState<Phase>('collecting');

    const errors = useMemo(
        () => validateAddress(values, validationTranslate),
        [validationTranslate, values],
    );
    const addressComplete = Object.keys(errors).length === 0;

    const previewRequest = useMemo(() => {
        if (basket === undefined || basket.items.length === 0) return null;
        if (committed === null) return { cartId: basket.id };
        return {
            cartId: basket.id,
            address: committed.address,
            slotCode: committed.slotCode,
            deliveryDate: committed.deliveryDate,
        };
    }, [basket, committed]);

    const preview = useCheckoutPreviewQuery(previewRequest);
    const quotation: CheckoutPreview | undefined = preview.data;

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
                                note: t('commerce:cart.deliveryFree'),
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

    if (phase === 'placed' && committed !== null) {
        return (
            <PrototypeOrderPlaced
                delivery={committed}
                rows={rows}
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
        if (!addressComplete || deliveryDate === null) return;
        setCommitted({
            address: toDeliveryAddress(values),
            slotCode,
            deliveryDate,
        });
    };

    return (
        <Stack space="lg" testID="checkout-screen">
            <Stack space="xs">
                <Heading level={1} testID="checkout-title">
                    {t('commerce:checkout.title')}
                </Heading>
                <Text tone="secondary">{t('commerce:checkout.body')}</Text>
            </Stack>

            <PrototypeNotice
                testID="checkout-prototype-notice"
                body={t('commerce:checkout.prototypeNotice')}
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
                {basket === undefined ? null : (
                    <Stack space="lg">
                        <Stack space="sm" testID="checkout-address">
                            <Text variant="label">{t('commerce:checkout.addressTitle')}</Text>
                            <Text tone="secondary" variant="caption">
                                {t('commerce:checkout.addressBody')}
                            </Text>
                            <AddressForm
                                testID="checkout-address-form"
                                values={values}
                                errors={showErrors ? errors : {}}
                                onChange={(field: AddressField, next: string) => {
                                    setValues((current) => ({ ...current, [field]: next }));
                                    setCommitted(null);
                                }}
                            />
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
                                items={DELIVERY_SLOTS.map((slot) => ({
                                    value: slot.code,
                                    label: t(`commerce:slots.${slot.code}`),
                                    testID: `checkout-slot-${slot.code}`,
                                }))}
                            />
                            <Text tone="secondary" variant="caption" testID="checkout-slot-window">
                                {t('commerce:checkout.slotWindow', {
                                    from: DELIVERY_SLOTS.find((slot) => slot.code === slotCode)
                                        ?.startsAt,
                                    to: DELIVERY_SLOTS.find((slot) => slot.code === slotCode)
                                        ?.endsAt,
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
                            {quotation?.earliestDeliveryDate == null ? null : (
                                <Text tone="secondary" variant="caption" testID="checkout-earliest">
                                    {t('commerce:checkout.earliest', {
                                        date: formatter.formatDate(quotation.earliestDeliveryDate, {
                                            dateStyle: 'full',
                                        }),
                                    })}
                                </Text>
                            )}
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
                                                    {formatAddress(committed.address)}
                                                </Text>
                                                <Text
                                                    tone="secondary"
                                                    variant="caption"
                                                    testID="checkout-committed-slot"
                                                >
                                                    {t('commerce:checkout.committedSlot', {
                                                        slot: t(
                                                            `commerce:slots.${committed.slotCode}`,
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
                                                        onPress={() => {
                                                            setPhase('placed');
                                                        }}
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

interface PrototypeOrderPlacedProps {
    readonly delivery: CommittedDelivery;
    readonly rows: readonly PriceRow[];
    readonly onBrowse: () => void;
    readonly onCart: () => void;
    readonly onSubscriptions: () => void;
}

/**
 * The success state, stated honestly.
 *
 * It is a screen rather than a toast for two reasons. A toast disappears, and "no payment was taken"
 * is the single most important sentence in this flow — it must be readable for as long as somebody
 * wants to read it. And a toast over an unchanged checkout form is genuinely ambiguous: did it work?
 * A screen answers that before it is asked.
 */
function PrototypeOrderPlaced({
    delivery,
    rows,
    onBrowse,
    onCart,
    onSubscriptions,
}: PrototypeOrderPlacedProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Stack space="lg" testID="checkout-success-screen">
            <Callout
                testID="checkout-success-notice"
                role="status"
                tone="success"
                icon="success"
                title={t('commerce:checkout.successTitle')}
                body={t('commerce:checkout.successBody')}
            />

            <Callout
                testID="checkout-success-prototype"
                role="note"
                tone="info"
                icon="prototype"
                title={t('commerce:checkout.successPrototypeTitle')}
                body={t('commerce:checkout.successPrototypeBody')}
            />

            <Card testID="checkout-success-summary" padding="md" tone="sunken">
                <Stack space="md">
                    <Text variant="label">{t('commerce:checkout.successSummaryTitle')}</Text>
                    <Text testID="checkout-success-address">{formatAddress(delivery.address)}</Text>
                    <Text tone="secondary" testID="checkout-success-slot">
                        {t('commerce:checkout.committedSlot', {
                            slot: t(`commerce:slots.${delivery.slotCode}`),
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
