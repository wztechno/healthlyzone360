import { Button } from '@healthy360/design-system';
import type { Kitchen } from '@healthy360/api-client/contracts';
import type { Money } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { PillChip } from '../../../ui/pill-chip.tsx';
import { formatMoney } from '../format.ts';
import { deliveryTerms, pickupBranches } from '../storefront-facts.ts';

import type { KitchenClock } from './storefront-today.ts';
import { deliveryMinutesRange, minutesUntil } from './storefront-today.ts';

/** Which way an order leaves the kitchen. Drives the figures the panel states. */
type StorefrontMode = 'delivery' | 'pickup';
const MODES: readonly StorefrontMode[] = ['delivery', 'pickup'];

/**
 * The storefront's order panel — HealthZone `§isStorefront`'s `<aside>`: the eyebrow, the
 * Delivery / Pickup switch, three terms for that mode, today's cut-off with its pill, then "Start
 * an order" and "See plans from this kitchen".
 *
 * ## Every row the design draws, with "—" where the contract is silent
 *
 * * **Delivery** — the estimate range across the kitchen's zones, the lowest minimum order and the
 *   lowest fee, each "from" when zones differ.
 * * **Pickup** — where to collect from. No field records a collection lead time or a collection
 *   charge, so "Ready in" and "Fee" read "—" rather than the design's "15 min" and "Free".
 * * **The switch** always shows both modes, as designed; a mode the kitchen does not offer is drawn
 *   disabled rather than removed, so the panel says "no pickup here" instead of hiding the question.
 *
 * ## The cut-off pill
 *
 * The design's "18 MIN LEFT" is the minutes between the kitchen's clock and its published same-day
 * cut-off (`storefront-today.ts`). Where the kitchen's clock cannot be read on this device the pill
 * states the cut-off time instead, and once it has passed it says so; with no cut-off published
 * for today it reads "—".
 */
export interface StorefrontOrderPanelProps {
    readonly kitchen: Kitchen;
    /** Today's same-day cut-off, `HH:mm`. */
    readonly cutOff: string | null;
    readonly clock: KitchenClock | null;
    readonly onStartOrder: () => void;
    readonly onSeePlans: () => void;
}

export function StorefrontOrderPanel({
    kitchen,
    cutOff,
    clock,
    onStartOrder,
    onSeePlans,
}: StorefrontOrderPanelProps) {
    const { t } = useTranslation();
    const formatter: Formatter = useFormatter();

    const pickup = pickupBranches(kitchen);
    const terms = deliveryTerms(kitchen);
    const range = deliveryMinutesRange(kitchen);
    const none = t('marketplace:storefront.facts.none');

    const offered: Readonly<Record<StorefrontMode, boolean>> = {
        delivery: kitchen.channels.delivery,
        pickup: pickup.length > 0,
    };
    const [mode, setMode] = useState<StorefrontMode>(() =>
        !offered.delivery && offered.pickup ? 'pickup' : 'delivery',
    );

    /** One label/value line. */
    const term = (key: string, label: string, value: string) => (
        <View
            key={key}
            testID={`kitchen-order-${key}`}
            className="flex-row items-baseline justify-between gap-3"
        >
            <RNText className="text-sm text-content-secondary text-start">{label}</RNText>
            <RNText className="shrink text-sm font-semibold tabular-nums text-content-primary text-end">
                {value}
            </RNText>
        </View>
    );

    const amount = (value: Money | null) =>
        value === null
            ? none
            : terms.varies
              ? t('marketplace:storefront.order.fromAmount', {
                    amount: formatMoney(formatter, value),
                })
              : formatMoney(formatter, value);

    const eta =
        range === null
            ? none
            : range.min === range.max
              ? t('marketplace:storefront.facts.minutes', {
                    minutes: formatter.formatNumber(range.min),
                })
              : t('marketplace:storefront.facts.minutesRange', {
                    min: formatter.formatNumber(range.min),
                    max: formatter.formatNumber(range.max),
                });

    const rows =
        mode === 'pickup'
            ? [
                  term(
                      'collect',
                      t('marketplace:storefront.order.collectFrom'),
                      pickup.length === 0
                          ? none
                          : [...new Set(pickup.map((branch) => branch.area))].join(
                                t('marketplace:common.listSeparator'),
                            ),
                  ),
                  term('ready', t('marketplace:storefront.order.readyIn'), none),
                  term('pickup-fee', t('marketplace:storefront.order.fee'), none),
              ]
            : [
                  term('eta', t('marketplace:storefront.order.delivery'), eta),
                  term(
                      'minimum',
                      t('marketplace:storefront.order.minimum'),
                      amount(terms.minimumOrder),
                  ),
                  term('fee', t('marketplace:storefront.order.fee'), amount(terms.deliveryFee)),
              ];

    const left = cutOff === null || clock === null ? null : minutesUntil(cutOff, clock);
    const pill =
        cutOff === null
            ? none
            : left === null
              ? cutOff
              : left <= 0
                ? t('marketplace:storefront.order.passed', { time: cutOff })
                : left < 60
                  ? t('marketplace:storefront.order.minutesLeft', {
                        minutes: formatter.formatNumber(left),
                    })
                  : t('marketplace:storefront.order.hoursLeft', {
                        hours: formatter.formatNumber(Math.floor(left / 60)),
                        minutes: formatter.formatNumber(left % 60),
                    });

    return (
        <View
            testID="kitchen-order-panel"
            className="flex-col gap-3 rounded-xl border border-stroke bg-surface-raised p-5"
        >
            <Eyebrow>{t('marketplace:storefront.order.eyebrow')}</Eyebrow>

            <View
                className="flex-row gap-2"
                testID="kitchen-order-modes"
                role="group"
                aria-label={t('marketplace:storefront.order.modesLabel')}
            >
                {MODES.map((option) => (
                    <PillChip
                        key={option}
                        size="sm"
                        floor="coarse"
                        shape="tab"
                        testID={`kitchen-order-mode-${option}`}
                        label={t(`marketplace:storefront.order.${option}`)}
                        selected={option === mode}
                        disabled={!offered[option]}
                        onPress={() => {
                            setMode(option);
                        }}
                    />
                ))}
            </View>

            {rows}

            <View
                testID="kitchen-order-cutoff"
                className="flex-row items-center justify-between gap-2.5 border-t border-stroke-subtle pt-3"
            >
                <RNText className="text-sm text-content-secondary text-start">
                    {t('marketplace:storefront.order.cutOff')}
                </RNText>
                <View className="rounded-full bg-warning-subtle px-2.5 py-0.5">
                    <RNText
                        testID="kitchen-order-cutoff-pill"
                        numberOfLines={1}
                        className="text-sm font-semibold uppercase tabular-nums text-warning-on-subtle text-end"
                    >
                        {pill}
                    </RNText>
                </View>
            </View>

            <View className="mt-1 flex-col gap-3">
                <Button
                    testID="kitchen-view-menu"
                    block
                    size="lg"
                    label={t('marketplace:storefront.order.start')}
                    onPress={onStartOrder}
                />
                <Button
                    testID="kitchen-see-plans"
                    block
                    size="lg"
                    variant="secondary"
                    label={t('marketplace:storefront.order.seePlans')}
                    onPress={onSeePlans}
                />
            </View>
        </View>
    );
}
