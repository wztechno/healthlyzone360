import { Button, Icon, cx, useMotion } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { CustomerAddress, Kitchen } from '@healthy360/api-client/contracts';
import type { KitchenId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useFormatter } from '@healthy360/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Platform, Pressable, Text as RNText, View } from 'react-native';

import { useAddressesQuery, useUpdateAddressMutation } from '../../../data/account-hooks.ts';
import { useKitchenQuery, useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { withReturnTo } from '../../../navigation/return-to.ts';
import { useCurrentHref, useGoToAuth } from '../../../navigation/use-return-to.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { useOutsideDismiss } from '../../../ui/use-outside-dismiss.ts';
import { addDays, earliestStartDate, isoWeekday, todayIso } from '../../commerce/dates.ts';
import { defaultSlotCode, deliverySlotsForKitchen } from '../../commerce/delivery.ts';
import type { DeliverySlotOption } from '../../commerce/delivery.ts';
import { CURRENT_DELIVERY_CHOICE, deliveryChoices } from '../../commerce/delivery-choice.ts';

/** Where one saved address is added or amended; `new` adds one. */
const ADDRESS_PATH = '/customer/account/addresses';

/** The glyph a saved address wears, read from the name the person gave it. */
function addressIcon(label: string): IconName {
    const name = label.trim().toLowerCase();
    if (name === 'home' || name === 'المنزل' || name === 'البيت') return 'home';
    if (name === 'work' || name === 'office' || name === 'العمل' || name === 'المكتب') {
        return 'building';
    }
    return 'mapPin';
}

/** How many days the When row offers, from the earliest the checkout takes. */
const DAYS_OFFERED = 3;

/**
 * **Deliver to** — the accepted design's address dropdown: the saved addresses as a radio list, each
 * with its edit button, "Add a new address", then **When** — a day and one of the kitchens' delivery
 * windows — and "Deliver here".
 *
 * A session knows one address, the default, so choosing another and pressing Deliver here makes
 * that one the default (the same change the account page makes). The day and window are kept for
 * the visit (`delivery-choice.ts`) and the checkout starts from them. The days begin where the
 * checkout's do — tomorrow, since a kitchen cannot take an order for today — so the row never offers
 * a day the checkout would refuse. Signed out, the trigger asks the person to sign in instead.
 *
 * `framed` is the Menu's own slot: a bordered control on the page, whose dropdown opens towards
 * the end. `bar` is the meal page's order-bar slot — the address's name over the day and window.
 * Neither, it sits inside Discover's search bar and opens towards the start.
 */
export function DeliverToMenu({
    testID,
    framed = false,
    bar = false,
    kitchenId = null,
}: {
    readonly testID: string;
    readonly framed?: boolean | undefined;
    readonly bar?: boolean | undefined;
    /** The kitchen of the food on screen, whose own delivery windows the When row offers. */
    readonly kitchenId?: KitchenId | null | undefined;
}) {
    const { t } = useTranslation();
    const router = useRouter();
    const goToAuth = useGoToAuth();
    const here = useCurrentHref();
    const { me } = useSession();
    const signedIn = me !== null;
    const addresses = useAddressesQuery(signedIn);
    const update = useUpdateAddressMutation();
    const saved = addresses.data ?? [];
    const home = saved.find((address) => address.isDefault) ?? saved[0];

    const [open, setOpen] = useState(false);
    const [picked, setPicked] = useState<string | null>(null);
    const chosen = saved.find((address) => address.id === picked) ?? home;

    const formatter = useFormatter();
    const kitchens = useKitchensQuery({ channels: ['marketplace'], limit: 20 });
    // Every marketplace kitchen's windows, once each, in the order of the day.
    const onScreen = useKitchenQuery(kitchenId);
    /*
     * The windows of the kitchen whose food is on screen, then any other marketplace kitchen's, once
     * each, in the order of the day — with the weekdays each runs on (empty is every day).
     */
    const { slots, weekdays } = useMemo(() => {
        const sources: readonly Kitchen[] = [
            ...(onScreen.data === undefined ? [] : [onScreen.data]),
            ...(kitchens.data?.items ?? []),
        ];
        const byCode = new Map<string, DeliverySlotOption>();
        const days = new Map<string, Set<number> | 'every'>();
        for (const kitchen of sources) {
            for (const slot of deliverySlotsForKitchen(kitchen)) {
                if (!byCode.has(slot.code)) byCode.set(slot.code, slot);
            }
            for (const window of kitchen.deliveryWindows) {
                const known = days.get(window.code);
                if (window.weekdays.length === 0 || known === 'every') {
                    days.set(window.code, 'every');
                } else {
                    days.set(window.code, new Set([...(known ?? []), ...window.weekdays]));
                }
            }
        }
        const all = byCode.size === 0 ? deliverySlotsForKitchen(null) : [...byCode.values()];
        return {
            slots: [...all].sort((a, b) =>
                a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0,
            ),
            weekdays: days,
        };
    }, [kitchens.data, onScreen.data]);
    /** Whether a window runs on a day — a kitchen may keep breakfast to weekdays. */
    const runsOn = (code: string, date: string) => {
        const days = weekdays.get(code);
        if (days === undefined || days === 'every') return true;
        const weekday = isoWeekday(date);
        return weekday !== null && days.has(weekday);
    };
    const [days] = useState(() => {
        const first = earliestStartDate();
        return Array.from({ length: DAYS_OFFERED }, (_, index) => addDays(first, index)).filter(
            (day): day is string => day !== null,
        );
    });
    const tomorrow = addDays(todayIso(), 1);
    const stored = deliveryChoices.useDraft(CURRENT_DELIVERY_CHOICE);
    const when =
        stored !== null &&
        days.includes(stored.date) &&
        slots.some((slot) => slot.code === stored.slot)
            ? stored
            : { date: days[0] ?? '', slot: defaultSlotCode(slots) ?? '' };
    const [pickedDay, setPickedDay] = useState<string | null>(null);
    const [pickedSlot, setPickedSlot] = useState<string | null>(null);
    const day = pickedDay ?? when.date;
    // A window that does not run on the day picked gives way to the first one that does.
    const wantedSlot = pickedSlot ?? when.slot;
    const slotCode = runsOn(wantedSlot, day)
        ? wantedSlot
        : (slots.find((slot) => runsOn(slot.code, day))?.code ?? wantedSlot);

    const dayName = (date: string) =>
        date === tomorrow
            ? t('marketplace:discover.tomorrow')
            : formatter.formatDate(date, { weekday: 'short' });
    const dayDetail = (date: string) =>
        date === tomorrow
            ? formatter.formatDate(date, { weekday: 'short', day: 'numeric', month: 'short' })
            : formatter.formatDate(date, { day: 'numeric', month: 'short' });
    const slotName = (slot: DeliverySlotOption) =>
        slot.label ?? t(`commerce:slots.${slot.code}`, { defaultValue: slot.code });
    const slotTime = (slot: DeliverySlotOption) =>
        t('marketplace:discover.slotTime', { start: slot.startsAt, end: slot.endsAt });
    const whenShort = (date: string, code: string) => {
        const slot = slots.find((candidate) => candidate.code === code);
        return slot === undefined
            ? dayName(date)
            : t('marketplace:discover.slotShort', { day: dayName(date), slot: slotName(slot) });
    };
    const whenText = (date: string, code: string) => {
        const slot = slots.find((candidate) => candidate.code === code);
        return slot === undefined
            ? dayName(date)
            : t('marketplace:discover.slotSummary', {
                  day: dayName(date),
                  slot: slotName(slot),
                  time: slotTime(slot),
              });
    };
    const close = useCallback(() => {
        setOpen(false);
    }, []);
    // Escape and a press outside close it, as the design's popovers do.
    const root = useOutsideDismiss(open, close);

    // The address editor, which comes back here when it is done.
    const openEditor = (address: string) => {
        setOpen(false);
        router.push(withReturnTo(`${ADDRESS_PATH}/${address}`, here) as never);
    };

    const deliverHere = () => {
        if (day !== '' && slotCode !== '') {
            deliveryChoices.write(CURRENT_DELIVERY_CHOICE, { date: day, slot: slotCode });
        }
        if (chosen !== undefined && !chosen.isDefault) {
            update.mutate({
                addressId: chosen.id,
                request: {
                    label: chosen.label,
                    areaId: chosen.areaId,
                    line1: chosen.line1,
                    line2: chosen.line2 ?? undefined,
                    building: chosen.building ?? undefined,
                    floor: chosen.floor ?? undefined,
                    notes: chosen.notes ?? undefined,
                    makeDefault: true,
                },
            });
        }
        setOpen(false);
    };

    return (
        <View ref={root} className="relative z-raised shrink-0">
            <Pressable
                testID={`${testID}-deliver-to`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={
                    home === undefined
                        ? t('marketplace:discover.chooseArea')
                        : t('marketplace:discover.deliverToLabel', { area: home.areaName })
                }
                aria-haspopup="dialog"
                aria-expanded={open}
                accessibilityState={{ expanded: open }}
                onPress={() => {
                    if (!signedIn) {
                        goToAuth('/sign-in');
                        return;
                    }
                    setPicked(null);
                    setPickedDay(null);
                    setPickedSlot(null);
                    setOpen((current) => !current);
                }}
                className={
                    bar
                        ? cx(
                              'h-14 flex-row items-center gap-2.5 rounded-2xl px-3.5 transition duration-normal ease-standard hover:bg-surface-brand-subtle',
                              open ? 'bg-surface-brand-subtle' : 'bg-surface-base',
                          )
                        : framed
                          ? [
                                'h-[52px] flex-row items-center gap-2.5 rounded-2xl border bg-surface-raised pe-3.5 ps-3 transition duration-normal ease-standard hover:border-surface-brand',
                                open ? 'border-surface-brand' : 'border-stroke',
                            ].join(' ')
                          : [
                                'h-12 flex-row items-center gap-2.5 rounded-full pe-4 ps-3 transition duration-normal ease-standard hover:bg-surface-brand-subtle',
                                open ? 'bg-surface-brand-subtle' : '',
                            ].join(' ')
                }
            >
                <Icon name="mapPin" className="text-content-on-brand-subtle" />
                {bar ? (
                    <View className="flex-col items-start">
                        <RNText
                            testID={`${testID}-area`}
                            numberOfLines={1}
                            className="max-w-[160px] text-sm font-semibold text-content-primary"
                        >
                            {home === undefined ? t('marketplace:discover.chooseArea') : home.label}
                        </RNText>
                        {home === undefined ? null : (
                            <RNText
                                numberOfLines={1}
                                className="max-w-[160px] text-xs font-medium text-content-secondary"
                            >
                                {whenShort(when.date, when.slot)}
                            </RNText>
                        )}
                    </View>
                ) : (
                    <View className="flex-col items-start">
                        <RNText className="hidden text-xs font-medium text-content-secondary md:flex">
                            {framed && home !== undefined
                                ? t('marketplace:discover.deliverToNamed', { label: home.label })
                                : t('marketplace:discover.deliverTo')}
                        </RNText>
                        <RNText
                            testID={`${testID}-area`}
                            numberOfLines={1}
                            className={cx(
                                'text-sm font-semibold text-content-primary',
                                framed ? 'max-w-[260px]' : 'max-w-[180px]',
                            )}
                        >
                            {home === undefined
                                ? t('marketplace:discover.chooseArea')
                                : framed
                                  ? whenText(when.date, when.slot)
                                  : t('marketplace:discover.areaDay', {
                                        area: home.areaName,
                                        day: dayName(when.date),
                                    })}
                        </RNText>
                    </View>
                )}
                {bar ? null : (
                    <View className={open ? 'hidden rotate-180 md:flex' : 'hidden md:flex'}>
                        <Icon name="chevronDown" size="sm" className="text-content-secondary" />
                    </View>
                )}
            </Pressable>

            {open ? (
                <View
                    testID={`${testID}-addresses`}
                    role="dialog"
                    aria-label={t('marketplace:discover.deliverTo')}
                    className={`absolute ${framed || bar ? 'end-0' : 'start-0'} top-full z-tooltip mt-3 w-[380px] rounded-3xl border border-stroke-subtle bg-surface-raised p-4 shadow-elevation-3 web:max-w-[calc(100vw-32px)]`}
                >
                    <View className="flex-row items-center gap-2">
                        <View className="h-6 w-6 items-center justify-center rounded-lg bg-surface-brand-subtle">
                            <Icon
                                name="mapPin"
                                size="sm"
                                className="text-content-on-brand-subtle"
                            />
                        </View>
                        <RNText
                            role="heading"
                            aria-level={2}
                            className="font-display text-base font-bold text-content-primary"
                        >
                            {t('marketplace:discover.deliverTo')}
                        </RNText>
                    </View>

                    <View
                        role="radiogroup"
                        aria-label={t('marketplace:discover.savedAddresses')}
                        className="mt-3 flex-col gap-2"
                    >
                        {saved.map((address) => (
                            <AddressRow
                                key={address.id}
                                testID={`${testID}-address-${address.id}`}
                                address={address}
                                selected={address.id === chosen?.id}
                                onPick={() => {
                                    setPicked(address.id);
                                }}
                                onEdit={() => {
                                    openEditor(address.id);
                                }}
                            />
                        ))}
                        <Pressable
                            testID={`${testID}-add-address`}
                            role="button"
                            accessibilityRole="button"
                            onPress={() => {
                                openEditor('new');
                            }}
                            className="h-11 flex-row items-center justify-center gap-1.5 rounded-2xl border border-dashed border-stroke-strong transition duration-normal ease-standard hover:border-surface-brand hover:bg-surface-base"
                        >
                            <Icon name="plus" size="sm" className="text-content-brand" />
                            <RNText className="text-sm font-semibold text-content-brand">
                                {t('marketplace:discover.addAddress')}
                            </RNText>
                        </Pressable>
                    </View>

                    {chosen === undefined ? null : (
                        <View className="mt-4 flex-col gap-2.5 border-t border-stroke-subtle pt-3">
                            <View className="flex-row items-center justify-between gap-2">
                                <RNText className="text-sm font-bold text-content-primary">
                                    {t('marketplace:discover.when')}
                                </RNText>
                                <RNText
                                    numberOfLines={1}
                                    className="min-w-0 shrink text-xs text-content-secondary"
                                >
                                    {t('marketplace:discover.deliveringTo', {
                                        area: chosen.areaName,
                                    })}
                                </RNText>
                            </View>
                            <View
                                role="tablist"
                                aria-label={t('marketplace:discover.day')}
                                className="flex-row gap-1 rounded-2xl bg-surface-base p-1"
                            >
                                {days.map((date) => {
                                    const on = date === day;
                                    return (
                                        <Pressable
                                            key={date}
                                            testID={`${testID}-day-${date}`}
                                            role="tab"
                                            aria-selected={on}
                                            accessibilityState={{ selected: on }}
                                            onPress={() => {
                                                setPickedDay(date);
                                            }}
                                            className={cx(
                                                'flex-1 items-center rounded-xl py-1.5 transition duration-normal ease-standard',
                                                on
                                                    ? 'bg-surface-raised shadow-elevation-1'
                                                    : 'hover:bg-surface-raised',
                                            )}
                                        >
                                            <RNText
                                                className={cx(
                                                    'text-sm font-semibold',
                                                    on
                                                        ? 'text-content-primary'
                                                        : 'text-content-secondary',
                                                )}
                                            >
                                                {dayName(date)}
                                            </RNText>
                                            <RNText className="text-xs text-content-secondary">
                                                {dayDetail(date)}
                                            </RNText>
                                        </Pressable>
                                    );
                                })}
                            </View>
                            <View
                                role="radiogroup"
                                aria-label={t('marketplace:discover.window')}
                                className="flex-col gap-2"
                            >
                                {pairs(slots).map((row) => (
                                    <View key={row[0].code} className="flex-row gap-2">
                                        {row.map((slot) => {
                                            const on = slot.code === slotCode;
                                            const off = !runsOn(slot.code, day);
                                            return (
                                                <Pressable
                                                    key={slot.code}
                                                    testID={`${testID}-window-${slot.code}`}
                                                    role="radio"
                                                    aria-checked={on}
                                                    disabled={off}
                                                    accessibilityState={{
                                                        checked: on,
                                                        disabled: off,
                                                    }}
                                                    onPress={() => {
                                                        setPickedSlot(slot.code);
                                                    }}
                                                    className={cx(
                                                        'flex-1 flex-col rounded-xl border px-3 py-2 transition duration-normal ease-standard',
                                                        on
                                                            ? 'border-surface-brand bg-surface-brand-subtle'
                                                            : off
                                                              ? 'border-stroke-subtle bg-surface-raised'
                                                              : 'border-stroke-subtle bg-surface-raised hover:border-stroke',
                                                    )}
                                                >
                                                    <RNText
                                                        numberOfLines={1}
                                                        className={cx(
                                                            'text-sm font-bold text-start',
                                                            on
                                                                ? 'text-content-on-brand-subtle'
                                                                : off
                                                                  ? 'text-content-disabled line-through'
                                                                  : 'text-content-primary',
                                                        )}
                                                    >
                                                        {slotName(slot)}
                                                    </RNText>
                                                    <RNText
                                                        className={cx(
                                                            'text-sm tabular-nums text-start',
                                                            on
                                                                ? 'text-content-on-brand-subtle'
                                                                : off
                                                                  ? 'text-content-disabled line-through'
                                                                  : 'text-content-secondary',
                                                        )}
                                                    >
                                                        {slotTime(slot)}
                                                    </RNText>
                                                </Pressable>
                                            );
                                        })}
                                        {row.length === 1 ? <View className="flex-1" /> : null}
                                    </View>
                                ))}
                            </View>
                        </View>
                    )}

                    {chosen === undefined ? null : (
                        <View className="mt-4 flex-row items-center gap-3 border-t border-stroke-subtle pt-3">
                            <RNText
                                testID={`${testID}-when`}
                                numberOfLines={1}
                                className="me-auto min-w-0 shrink text-xs text-content-secondary text-start"
                            >
                                {whenText(day, slotCode)}
                            </RNText>
                            <Button
                                testID={`${testID}-deliver-here`}
                                size="sm"
                                label={t('marketplace:discover.deliverHere')}
                                loading={update.isPending}
                                onPress={deliverHere}
                            />
                        </View>
                    )}
                </View>
            ) : null}
        </View>
    );
}

/** The windows two to a row, as the design lays them out. */
function pairs<T>(items: readonly T[]): readonly (readonly [T, ...T[]])[] {
    const rows: [T, ...T[]][] = [];
    items.forEach((item, index) => {
        if (index % 2 === 0) rows.push([item]);
        else rows[rows.length - 1]?.push(item);
    });
    return rows;
}

/** One saved address: the pick (a radio) and, beside it, its edit button. */
function AddressRow({
    testID,
    address,
    selected,
    onPick,
    onEdit,
}: {
    readonly testID: string;
    readonly address: CustomerAddress;
    readonly selected: boolean;
    readonly onPick: () => void;
    readonly onEdit: () => void;
}) {
    const { t } = useTranslation();
    const { enabled } = useMotion();
    const [dot] = useState(() => new Animated.Value(selected ? 1 : 0));

    useEffect(() => {
        const to = selected ? 1 : 0;
        if (!enabled) {
            dot.setValue(to);
            return;
        }
        Animated.timing(dot, {
            toValue: to,
            duration: 250,
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            useNativeDriver: Platform.OS !== 'web',
        }).start();
    }, [dot, enabled, selected]);

    return (
        <View
            className={[
                'flex-row items-center rounded-2xl border transition duration-normal ease-standard',
                selected
                    ? 'border-surface-brand bg-surface-brand-subtle'
                    : 'border-stroke bg-surface-raised hover:border-stroke-strong',
            ].join(' ')}
        >
            <Pressable
                testID={testID}
                role="radio"
                accessibilityRole="radio"
                aria-checked={selected}
                accessibilityState={{ checked: selected }}
                onPress={onPick}
                className="min-w-0 flex-1 flex-row items-center gap-2.5 py-2.5 pe-1.5 ps-2.5"
            >
                <View
                    className={
                        selected
                            ? 'h-9 w-9 items-center justify-center rounded-xl bg-surface-brand'
                            : 'h-9 w-9 items-center justify-center rounded-xl bg-surface-base'
                    }
                >
                    <Icon
                        name={addressIcon(address.label)}
                        size="sm"
                        className={selected ? 'text-content-on-brand' : 'text-content-primary'}
                    />
                </View>
                <View className="min-w-0 flex-1 flex-col items-start">
                    <View className="flex-row items-center gap-1.5">
                        <RNText
                            numberOfLines={1}
                            className="text-sm font-bold text-content-primary text-start"
                        >
                            {address.label}
                        </RNText>
                        {address.isDefault ? (
                            <RNText className="rounded-md bg-surface-base px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-content-secondary">
                                {t('marketplace:discover.defaultAddress')}
                            </RNText>
                        ) : null}
                    </View>
                    <RNText
                        numberOfLines={1}
                        className={[
                            'max-w-[220px] text-xs text-start',
                            selected ? 'text-content-on-brand-subtle' : 'text-content-secondary',
                        ].join(' ')}
                    >
                        {t('marketplace:discover.addressLine', {
                            area: address.areaName,
                            line: address.line1,
                        })}
                    </RNText>
                </View>
                <View
                    className={
                        selected
                            ? 'h-5 w-5 items-center justify-center rounded-full border-2 border-surface-brand'
                            : 'h-5 w-5 items-center justify-center rounded-full border-2 border-stroke-strong'
                    }
                >
                    <Animated.View
                        className="h-2.5 w-2.5 rounded-full bg-surface-brand"
                        style={{ transform: [{ scale: dot }] }}
                    />
                </View>
            </Pressable>
            <Pressable
                testID={`${testID}-edit`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('marketplace:discover.editAddress', { label: address.label })}
                onPress={onEdit}
                className="me-1.5 h-9 w-9 items-center justify-center rounded-xl hover:bg-surface-raised"
            >
                <Icon name="pen" size="sm" className="text-content-secondary" />
            </Pressable>
        </View>
    );
}
