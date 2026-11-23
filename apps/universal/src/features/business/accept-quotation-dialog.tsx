import { Callout, Dialog, Select, Text, TextInputField } from '@healthy360/design-system';
import type { Kitchen, Quotation } from '@healthy360/api-client/contracts';
import type { KitchenId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useAddressesQuery } from '../../data/account-hooks.ts';
import {
    toFailure,
    useAcceptQuotationMutation,
    useDeclineQuotationMutation,
} from '../../data/business-hooks.ts';
import { useKitchenQuery } from '../../data/marketplace-hooks.ts';
import { addDays, earliestStartDate, isoWeekday } from '../commerce/dates.ts';
import { defaultSlotCode, deliverySlotsForKitchen } from '../commerce/delivery.ts';
import type { DeliverySlotOption } from '../commerce/delivery.ts';
import { DeskButton } from '../kitchen-admin/desk-kit/desk-button.tsx';
import { DeskChoiceChips } from '../kitchen-admin/desk-kit/desk-choice-chips.tsx';
import { formatMoney } from '../marketplace/format.ts';
import { contractPriceTestId } from './format.ts';

/**
 * Accept a quoted price and schedule the delivery — one step, because accepting places the order.
 * From the corporate canvas's Accept and schedule board (2026-11-10):
 *
 * ```
 *  Accept QUO-2026-FED6E6F4 and schedule the delivery
 *  Quoted total                                   $42.00
 *  Delivery day *     ( Wed 11 ) ( Thu 12 ) [( Fri 13 )] …
 *  Delivery window *  ( Breakfast ) [( Lunch )] ( Snack ) …
 *  Deliver to *       [ Head office · street, area     ⌄ ]
 *  Fri 13 Nov · Lunch            Cancel  [ Accept and place the order ]
 * ```
 *
 * The days are the next seven on which the kitchen runs a window, from the earliest bookable — the
 * day the buyer asked for first when it is still ahead. The windows are the kitchen's for that day.
 * Whether the address's zone offers the window and whether the day is past the kitchen's cut-off
 * are the placement's answers, not this dialog's: a refusal comes back listing every reason, and the
 * quotation stays `quoted` so the buyer can change a choice and try again.
 *
 * A repeating quotation also asks how many weeks to place — not drawn on the board, but the API
 * places one order a week and needs the count.
 */

/** A repeating quotation's run, to begin with, and at most — the server's own limit. */
const DEFAULT_WEEKS = 4;
const MAX_WEEKS = 12;
/** How many delivery days the chips offer. */
const DAYS_OFFERED = 7;
/** How far ahead to look for them — two weeks covers a kitchen that delivers every other day. */
const DAYS_SEARCHED = 21;

/** The kitchen's windows, each with the ISO weekdays it runs on (empty: every day). */
function windowsByDay(kitchen: Kitchen | undefined): readonly {
    readonly slot: DeliverySlotOption;
    readonly weekdays: readonly number[];
}[] {
    const published = kitchen?.deliveryWindows ?? [];
    return deliverySlotsForKitchen(kitchen).map((slot) => ({
        slot,
        weekdays: published.find((window) => window.code === slot.code)?.weekdays ?? [],
    }));
}

function runsOn(weekdays: readonly number[], date: string): boolean {
    const weekday = isoWeekday(date);
    return weekdays.length === 0 || (weekday !== null && weekdays.includes(weekday));
}

/** The next days the kitchen delivers on, starting at `from`. */
export function deliveryDays(
    from: string,
    windows: ReturnType<typeof windowsByDay>,
    count = DAYS_OFFERED,
): readonly string[] {
    const days: string[] = [];
    for (let offset = 0; offset < DAYS_SEARCHED && days.length < count; offset += 1) {
        const date = addDays(from, offset);
        if (date === null) break;
        if (windows.some((entry) => runsOn(entry.weekdays, date))) days.push(date);
    }
    return days;
}

/** "Wed 11" — the weekday first, as the board's chips read. */
function dayChipLabel(formatter: Formatter, date: string): string {
    const at = `${date}T12:00:00Z`;
    return `${formatter.formatDate(at, { weekday: 'short' })} ${formatter.formatDate(at, { day: 'numeric' })}`;
}

function dayLongLabel(formatter: Formatter, date: string): string {
    return formatter.formatDate(`${date}T12:00:00Z`, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    });
}

function slotLabel(t: TFunction, slot: DeliverySlotOption): string {
    return slot.label ?? t(`commerce:slots.${slot.code}`, { defaultValue: slot.code });
}

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
    const asked = quotation.requestedDeliveryDate;
    const windows = windowsByDay(kitchen.data);
    const days = deliveryDays(asked !== null && asked >= earliest ? asked : earliest, windows);

    const [chosenDay, setDay] = useState<string | null>(null);
    const day = chosenDay !== null && days.includes(chosenDay) ? chosenDay : (days[0] ?? null);
    const slots = day === null ? [] : windows.filter((entry) => runsOn(entry.weekdays, day));
    const [chosenSlot, setSlot] = useState<string | null>(null);
    const slotCode =
        chosenSlot !== null && slots.some((entry) => entry.slot.code === chosenSlot)
            ? chosenSlot
            : defaultSlotCode(slots.map((entry) => entry.slot));
    const slot = slots.find((entry) => entry.slot.code === slotCode)?.slot;

    const addressList = addresses.data ?? [];
    const [chosenAddressId, setAddressId] = useState<string | null>(null);
    const addressId =
        chosenAddressId ??
        (addressList.find((entry) => entry.isDefault) ?? addressList[0])?.id ??
        null;

    /*
     * A repeating quotation places one order a week, starting on the day above, for as many weeks
     * as are chosen here — four to begin with, a month of deliveries. A one-off places one.
     */
    const [weeks, setWeeks] = useState<number>(quotation.recurring ? DEFAULT_WEEKS : 1);
    const weekday =
        day === null ? '' : formatter.formatDate(`${day}T12:00:00Z`, { weekday: 'long' });

    const failure = toFailure(accept.error);
    const reasons = failure?.code === 'order.placement_refused' ? failure.reasons : [];
    const ready = addressId !== null && slotCode !== null && day !== null;

    const submit = () => {
        if (addressId === null || slotCode === null || day === null) return;
        accept.mutate(
            {
                quotationId: quotation.id,
                lockVersion: quotation.lockVersion,
                delivery: {
                    customerAddressId: addressId,
                    requestedDate: day,
                    deliveryWindowCode: slotCode,
                },
                ...(quotation.recurring && weeks > 1 ? { repeatWeeks: weeks } : {}),
            },
            { onSuccess: onAccepted },
        );
    };

    return (
        <Dialog
            open
            look="card"
            size="md"
            onClose={onClose}
            testID="quotation-accept-dialog"
            title={t('business:accept.title', { reference: quotation.reference })}
            actions={
                <>
                    <Text
                        testID="quotation-accept-summary"
                        tone="secondary"
                        variant="caption"
                        className="me-auto self-center tabular-nums"
                    >
                        {day === null
                            ? ''
                            : slot === undefined
                              ? dayLongLabel(formatter, day)
                              : t('business:accept.summary', {
                                    day: dayLongLabel(formatter, day),
                                    window: slotLabel(t, slot),
                                })}
                    </Text>
                    <DeskButton
                        testID="quotation-accept-cancel"
                        variant="quiet"
                        label={t('business:builder.cancel')}
                        onPress={onClose}
                    />
                    <DeskButton
                        testID="quotation-accept-confirm"
                        label={t('business:accept.confirm')}
                        loading={accept.isPending}
                        disabled={!ready}
                        onPress={submit}
                    />
                </>
            }
        >
            <View className="z-auto flex-col gap-3.5">
                {quotation.requestedTotal === null ? null : (
                    <View className="flex-row items-baseline justify-between gap-3">
                        <Text variant="bodyStrong">
                            {quotation.recurring && weeks > 1
                                ? t('business:accept.totalPerDelivery')
                                : t('business:accept.total')}
                        </Text>
                        <View testID={contractPriceTestId(`accept-${quotation.reference}`)}>
                            <RNText
                                testID="quotation-accept-total"
                                className="font-display text-2xl font-bold tabular-nums text-content-on-brand-subtle"
                            >
                                {formatMoney(formatter, quotation.requestedTotal)}
                            </RNText>
                        </View>
                    </View>
                )}

                <Field label={t('business:accept.date')}>
                    {days.length === 0 ? (
                        <Text tone="secondary">{t('business:accept.noDays')}</Text>
                    ) : (
                        <DeskChoiceChips
                            testID="quotation-accept-date"
                            label={t('business:accept.date')}
                            items={days.map((date) => ({
                                key: date,
                                label: dayChipLabel(formatter, date),
                            }))}
                            value={day}
                            onChange={setDay}
                        />
                    )}
                </Field>

                <Field label={t('business:accept.window')}>
                    <DeskChoiceChips
                        testID="quotation-accept-window"
                        label={t('business:accept.window')}
                        items={slots.map((entry) => ({
                            key: entry.slot.code,
                            label: slotLabel(t, entry.slot),
                        }))}
                        value={slotCode}
                        onChange={setSlot}
                    />
                </Field>

                <Select
                    testID="quotation-accept-address"
                    label={t('business:accept.address')}
                    required
                    placeholder={t('business:accept.addressPlaceholder')}
                    loading={addresses.isPending}
                    options={addressList.map((entry) => ({
                        value: entry.id,
                        label: [
                            entry.label,
                            [entry.line1, entry.areaName].filter(Boolean).join(', '),
                        ]
                            .filter(Boolean)
                            .join(' · '),
                    }))}
                    value={addressId}
                    onChange={setAddressId}
                    {...(!addresses.isPending && addressList.length === 0
                        ? { error: t('business:accept.noAddress') }
                        : {})}
                />

                {quotation.recurring ? (
                    <Select
                        testID="quotation-accept-weeks"
                        label={t('business:accept.repeat')}
                        hint={
                            weeks > 1
                                ? t('business:accept.repeatHint', { count: weeks, weekday })
                                : undefined
                        }
                        options={Array.from({ length: MAX_WEEKS }, (_, index) => index + 1).map(
                            (count) => ({
                                value: String(count),
                                label: t('business:accept.weeks', { count }),
                            }),
                        )}
                        value={String(weeks)}
                        onChange={(next) => {
                            setWeeks(Number(next));
                        }}
                    />
                ) : null}

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

/** A required field's label over its chips — `.f` on the board. */
function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
    return (
        <View className="z-auto flex-col gap-1.5">
            <Text variant="caption" tone="secondary" className="font-semibold">
                {label}
                <Text className="text-danger-strong"> *</Text>
            </Text>
            {children}
        </View>
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
            look="card"
            onClose={onClose}
            testID="quotation-decline-dialog"
            title={t('business:decline.title', { reference: quotation.reference })}
            actions={
                <>
                    <DeskButton
                        testID="quotation-decline-cancel"
                        variant="quiet"
                        label={t('business:builder.cancel')}
                        onPress={onClose}
                    />
                    <DeskButton
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
            <View className="flex-col gap-3.5">
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
