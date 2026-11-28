import { Icon, Text } from '@healthy360/design-system';
import type { StatusStep } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { BookRow } from './order-book.ts';

/**
 * The order pop-up's parts (layout B, chosen 2026-11-11): the stages that say where the order is
 * (drawn by the design system's `StatusSteps`, bars with times, since 2026-11-26) ending in its next
 * step, and the three cards — customer, delivery, money — each with its one action.
 *
 * ```
 * ████ Placed 10:41 ── ████ Confirmed 10:42 ── ▒▒▒▒ Ready ── ──── On the way    (( Mark ready ))
 * ┌ CUSTOMER ──────┐ ┌ DELIVERY ──────────┐ ┌ PAYMENT ───────────┐
 * │ …              │ │ …                   │ │ … (amber when owed) │
 * │ Call / Change  │ │ Choose a driver     │ │ Record a payment    │
 * └────────────────┘ └─────────────────────┘ └─────────────────────┘
 * ```
 */

export type OrderStage = StatusStep;

/**
 * The stages an order passes through, each done when its moment is stamped; the first that is not
 * is "now". A cancelled order has no track: its history says what happened.
 */
export function orderStages(
    order: BookRow,
    t: TFunction,
    formatAt: (at: string) => string,
): readonly OrderStage[] | null {
    if (order.status === 'cancelled') return null;
    const delivery = order.fulfilmentType === 'delivery';
    const stamped: readonly {
        readonly key: string;
        readonly label: string;
        readonly at: unknown;
    }[] = [
        { key: 'placed', label: t('kitchen:orders.stage.placed'), at: order.placedAt },
        {
            key: 'confirmed',
            label: t('kitchen:orders.history.confirmed'),
            at: order.confirmedAt,
        },
        { key: 'ready', label: t('kitchen:orders.history.ready'), at: order.readyAt ?? null },
        ...(delivery
            ? [
                  {
                      key: 'on-the-way',
                      label: t('kitchen:orders.history.onTheWay'),
                      at: order.deliveryRun?.pickedUpAt ?? null,
                  },
              ]
            : []),
        {
            key: 'fulfilled',
            label: t(
                delivery
                    ? 'kitchen:orders.status.delivered'
                    : order.fulfilmentType === 'pickup'
                      ? 'kitchen:orders.status.pickedUp'
                      : 'kitchen:orders.status.sold',
            ),
            at: order.fulfilledAt,
        },
    ];
    // A later stamp implies the earlier steps happened, even where one was never written.
    const lastDone = stamped.reduce(
        (last, stage, index) => (stage.at !== null && stage.at !== undefined ? index : last),
        -1,
    );
    return stamped.map((stage, index) => ({
        key: stage.key,
        label: stage.label,
        at: typeof stage.at === 'string' ? formatAt(stage.at) : null,
        state: index <= lastDone ? 'done' : index === lastDone + 1 ? 'current' : 'pending',
    }));
}

/** One of the three cards: an icon and a heading, its lines, and its one action at the foot. */
export function InfoCard({
    icon,
    title,
    action,
    warn = false,
    children,
    testID,
}: {
    readonly icon: IconName;
    /** Translated. */
    readonly title: string;
    readonly action?: ReactNode;
    /** Amber: money still to come in. */
    readonly warn?: boolean | undefined;
    readonly children: ReactNode;
    readonly testID?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            className={`min-w-[220px] flex-1 flex-col gap-1 rounded-2xl border p-3 ${
                warn
                    ? 'border-warning-border bg-warning-subtle'
                    : 'border-stroke-subtle bg-surface-raised'
            }`}
        >
            <View className="flex-row items-center gap-1.5">
                <Icon name={icon} size="sm" className="text-content-secondary" />
                <Text
                    variant="micro"
                    tone="secondary"
                    className="font-bold uppercase tracking-wider"
                    accessibilityRole="header"
                >
                    {title}
                </Text>
            </View>
            {children}
            {action === undefined || action === null ? null : (
                <View className="flex-row pt-1">{action}</View>
            )}
        </View>
    );
}

/** A line inside a card: a quiet label, then the value. */
export function CardLine({
    label,
    children,
    testID,
}: {
    readonly label: string;
    readonly children: ReactNode;
    readonly testID?: string | undefined;
}) {
    return (
        <View testID={testID} className="flex-row flex-wrap items-baseline gap-x-2">
            <Text variant="caption" tone="secondary">
                {label}
            </Text>
            <View className="min-w-0 flex-1">{children}</View>
        </View>
    );
}
