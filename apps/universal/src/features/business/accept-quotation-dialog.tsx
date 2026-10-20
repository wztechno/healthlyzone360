import {
    Button,
    Callout,
    DatePickerButton,
    Dialog,
    Select,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { Quotation } from '@healthy360/api-client/contracts';
import type { KitchenId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useAddressesQuery } from '../../data/account-hooks.ts';
import {
    toFailure,
    useAcceptQuotationMutation,
    useDeclineQuotationMutation,
} from '../../data/business-hooks.ts';
import { useKitchenQuery } from '../../data/marketplace-hooks.ts';
import { earliestStartDate } from '../commerce/dates.ts';
import { defaultSlotCode, deliverySlotsForKitchen } from '../commerce/delivery.ts';
import { formatMoney } from '../marketplace/format.ts';

/**
 * Accept a quoted price and schedule the delivery — one step, because accepting places the order.
 *
 * The three things an order cannot be placed without: the day (starting at the day the buyer asked
 * for when it is still ahead, else the earliest bookable), one of the account's addresses (the
 * default first) and a window the kitchen publishes. Whether the address's zone offers that window
 * and whether the day is past the kitchen's cut-off are the placement's answers, not this dialog's:
 * a refusal comes back listing every reason, worded as checkout words them, and the quotation stays
 * `quoted` so the buyer can change a field and try again.
 */
export function AcceptQuotationDialog({
    quotation,
    kitchenId,
    onClose,
    onAccepted,
}: {
    readonly quotation: Quotation;
    readonly kitchenId: KitchenId | null;
    readonly onClose: () => void;
    readonly onAccepted: (accepted: Quotation) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const accept = useAcceptQuotationMutation();
    const addresses = useAddressesQuery();
    const kitchen = useKitchenQuery(kitchenId);

    const earliest = earliestStartDate();
    const [date, setDate] = useState<string>(
        quotation.requestedDeliveryDate !== null && quotation.requestedDeliveryDate >= earliest
            ? quotation.requestedDeliveryDate
            : earliest,
    );
    const addressList = addresses.data ?? [];
    const [chosenAddressId, setAddressId] = useState<string | null>(null);
    const addressId =
        chosenAddressId ??
        (addressList.find((entry) => entry.isDefault) ?? addressList[0])?.id ??
        null;

    const slots = deliverySlotsForKitchen(kitchen.data);
    const [chosenSlot, setSlot] = useState<string | null>(null);
    const slotCode = chosenSlot ?? defaultSlotCode(slots);

    const failure = toFailure(accept.error);
    const reasons = failure?.code === 'order.placement_refused' ? failure.reasons : [];
    const ready = addressId !== null && slotCode !== null && date !== '';

    const submit = () => {
        if (addressId === null || slotCode === null) return;
        accept.mutate(
            {
                quotationId: quotation.id,
                lockVersion: quotation.lockVersion,
                delivery: {
                    customerAddressId: addressId,
                    requestedDate: date,
                    deliveryWindowCode: slotCode,
                },
            },
            { onSuccess: onAccepted },
        );
    };

    return (
        <Dialog
            open
            onClose={onClose}
            testID="quotation-accept-dialog"
            title={t('business:accept.title', { reference: quotation.reference })}
            description={t('business:accept.body')}
            actions={
                <>
                    <Button
                        testID="quotation-accept-cancel"
                        variant="secondary"
                        label={t('business:builder.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="quotation-accept-confirm"
                        label={t('business:accept.confirm')}
                        loading={accept.isPending}
                        disabled={!ready}
                        onPress={submit}
                    />
                </>
            }
        >
            <View className="z-auto flex-col gap-base">
                {quotation.requestedTotal === null ? null : (
                    <View className="flex-row items-baseline justify-between gap-tight rounded bg-surface-sunken px-tight py-tight">
                        <Text variant="label">{t('business:accept.total')}</Text>
                        <Text variant="section" className="tabular-nums" testID="quotation-accept-total">
                            {formatMoney(formatter, quotation.requestedTotal)}
                        </Text>
                    </View>
                )}

                <DatePickerButton
                    testID="quotation-accept-date"
                    label={t('business:accept.date')}
                    labelVisible
                    value={date}
                    min={earliest}
                    onChange={(next) => {
                        if (next !== '') setDate(next);
                    }}
                />

                <Select
                    testID="quotation-accept-address"
                    label={t('business:accept.address')}
                    placeholder={t('business:accept.addressPlaceholder')}
                    loading={addresses.isPending}
                    options={addressList.map((entry) => ({
                        value: entry.id,
                        label: entry.label,
                        description: [entry.line1, entry.areaName].filter(Boolean).join(', '),
                    }))}
                    value={addressId}
                    onChange={setAddressId}
                    {...(!addresses.isPending && addressList.length === 0
                        ? { error: t('business:accept.noAddress') }
                        : {})}
                />

                <Select
                    testID="quotation-accept-window"
                    label={t('business:accept.window')}
                    options={slots.map((slot) => ({
                        value: slot.code,
                        label:
                            slot.label ??
                            t(`commerce:slots.${slot.code}`, { defaultValue: slot.code }),
                        description: `${slot.startsAt}–${slot.endsAt}`,
                    }))}
                    value={slotCode}
                    onChange={setSlot}
                />

                {failure === null ? null : (
                    <Callout
                        testID="quotation-accept-failure"
                        role="alert"
                        tone="danger"
                        icon="warning"
                        title={t('business:accept.refusedTitle')}
                        body={reasons.length === 0 ? failure.message : undefined}
                    >
                        {reasons.map((entry) => (
                            <Text
                                key={entry.reason}
                                variant="caption"
                                testID={`quotation-accept-reason-${entry.reason}`}
                            >
                                {`• ${t(`errors:orderRefusal.${entry.reason}`, {
                                    defaultValue: entry.reason,
                                })}`}
                            </Text>
                        ))}
                    </Callout>
                )}
            </View>
        </Dialog>
    );
}

/** Decline, with the reason the kitchen will read — optional, and stored on the quotation. */
export function DeclineQuotationDialog({
    quotation,
    onClose,
    onDeclined,
}: {
    readonly quotation: Quotation;
    readonly onClose: () => void;
    readonly onDeclined: (declined: Quotation) => void;
}) {
    const { t } = useTranslation();
    const decline = useDeclineQuotationMutation();
    const [reason, setReason] = useState('');
    const failure = toFailure(decline.error);

    return (
        <Dialog
            open
            onClose={onClose}
            testID="quotation-decline-dialog"
            title={t('business:decline.title', { reference: quotation.reference })}
            description={t('business:decline.body')}
            actions={
                <>
                    <Button
                        testID="quotation-decline-cancel"
                        variant="secondary"
                        label={t('business:builder.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="quotation-decline-confirm"
                        variant="danger"
                        label={t('business:decline.confirm')}
                        loading={decline.isPending}
                        onPress={() => {
                            decline.mutate(
                                {
                                    quotationId: quotation.id,
                                    lockVersion: quotation.lockVersion,
                                    ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
                                },
                                { onSuccess: onDeclined },
                            );
                        }}
                    />
                </>
            }
        >
            <View className="flex-col gap-base">
                <TextInputField
                    testID="quotation-decline-reason"
                    id="quotation-decline-reason"
                    label={t('business:decline.reason')}
                    placeholder={t('business:decline.reasonPlaceholder')}
                    value={reason}
                    multiline
                    onChangeText={setReason}
                />
                {failure === null ? null : (
                    <Callout
                        testID="quotation-decline-failure"
                        role="alert"
                        tone="danger"
                        icon="warning"
                        title={t('business:decline.failedTitle')}
                        body={failure.message}
                    />
                )}
            </View>
        </Dialog>
    );
}
