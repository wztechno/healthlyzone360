import type { PlacedOrder } from '@healthy360/api-client/contracts';
import { Button, Icon, Inline, cx, useBreakpoint } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { useMyOrdersQuery } from '../../data/commerce-hooks.ts';
import { TINT_FILL, TINT_INK, TINT_INK_FILL } from '../catalogue/shelf-tints.ts';
import type { ShelfTint } from '../catalogue/shelf-tints.ts';
import { formatMoney } from '../marketplace/format.ts';
import { QueryStates } from '../marketplace/query-states.tsx';
import { OrderLineThumb } from '../orders/order-line-thumb.tsx';
import { ACCOUNT_CARD, PanelHead } from './account-card.tsx';

/**
 * The account page's Orders section, as the accepted Account board draws it: the title with its
 * count and the All · Active · Delivered filter, the order on its way on the canopy with its five-step
 * progress and "Track order", and a row per order — the delivery day as a tile, the dishes' faces,
 * what was in it over "#reference", the state badge, the total and View. Over `GET /me/orders`, newest
 * first, as a cursor walk with "show older" rather than a pretence that the first page is everything.
 *
 * * **No Reorder**, though the board draws one: no endpoint turns an order back into a basket, and an
 *   order line carries no meal id to add to one. The row's button opens the order instead.
 * * **The counts are of what has loaded** — the history is a cursor walk, so "6" means six so far.
 */

const TEST_ID = 'account-orders';
const PAGE_SIZE = 20;

type Filter = 'all' | 'active' | 'delivered';
const FILTERS: readonly Filter[] = ['all', 'active', 'delivered'];

const isDone = (order: PlacedOrder) => order.state === 'delivered' || order.state === 'cancelled';
const matches = (order: PlacedOrder, filter: Filter) =>
    filter === 'all' ? true : filter === 'active' ? !isDone(order) : order.state === 'delivered';

/** The state badge's colour, as the board's placed · confirmed · delivered wear them. */
const STATE_TINT: Readonly<Record<PlacedOrder['state'], ShelfTint>> = {
    placed: 'yellow',
    confirmed: 'blue',
    preparing: 'orange',
    ready_for_pickup: 'teal',
    out_for_delivery: 'teal',
    delivered: 'green',
    cancelled: 'neutral',
};

/** The five steps of the live card, and where each state stands on them. */
const TRACK_STEPS = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'] as const;
const TRACK_POSITION: Readonly<Record<PlacedOrder['state'], number>> = {
    placed: 0,
    confirmed: 1,
    preparing: 2,
    ready_for_pickup: 3,
    out_for_delivery: 3,
    delivered: 4,
    cancelled: -1,
};

function StateBadge({
    state,
    testID,
}: {
    readonly state: PlacedOrder['state'];
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const tint = STATE_TINT[state];
    return (
        <View
            className={cx(
                'h-7 flex-row items-center gap-1.5 self-start rounded-full px-2.5',
                TINT_FILL[tint],
            )}
        >
            <View className={cx('h-[7px] w-[7px] rounded-full', TINT_INK_FILL[tint])} />
            <RNText
                testID={testID}
                numberOfLines={1}
                className={cx('text-xs font-bold', TINT_INK[tint])}
            >
                {t(`guest:order.states.${state}`)}
            </RNText>
        </View>
    );
}

function OrderRow({ order }: { readonly order: PlacedOrder }) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();
    const testID = `${TEST_ID}-row-${order.id}`;
    const day = `${order.deliveryDate}T12:00:00Z`;
    const open = () => {
        router.push(`/customer/orders/${order.id}` as never);
    };

    const summary = order.lines
        .map((line) =>
            t('account:orders.lineLabel', {
                qty: formatter.formatNumber(line.quantity),
                name: line.name,
            }),
        )
        .join(t('account:profile.listSeparator'));

    return (
        <View
            testID={testID}
            className={cx(
                'border-t border-stroke-subtle px-1 py-3.5',
                atLeast('md')
                    ? 'flex-row items-center gap-4'
                    : 'flex-row flex-wrap items-center gap-x-4 gap-y-3',
            )}
        >
            <View className="h-16 w-16 items-center justify-center rounded-[18px] bg-surface-base">
                <RNText className="text-xs font-semibold uppercase text-content-secondary">
                    {formatter.formatDate(day, { weekday: 'short' })}
                </RNText>
                <RNText className="font-display text-xl font-bold leading-[26px] tabular-nums text-content-primary">
                    {formatter.formatDate(day, { day: 'numeric' })}
                </RNText>
                <RNText className="text-xs font-semibold uppercase text-content-secondary">
                    {formatter.formatDate(day, { month: 'short' })}
                </RNText>
            </View>

            <View className="min-w-[200px] flex-1 flex-row items-center gap-3.5">
                <View className="flex-row">
                    {order.lines.slice(0, 3).map((line, index) => (
                        <View
                            key={line.id}
                            className={cx(
                                'h-11 w-11 overflow-hidden rounded-full border-[3px] border-surface-raised bg-surface-base',
                                index === 0 ? '' : '-ms-3',
                            )}
                        >
                            <OrderLineThumb
                                testID={index === 0 ? `${testID}-thumb` : undefined}
                                name={line.name}
                                className="h-full w-full"
                            />
                        </View>
                    ))}
                </View>
                <Pressable
                    testID={`${testID}-open`}
                    role="link"
                    accessibilityRole="link"
                    accessibilityHint={t('account:orders.openHint', { reference: order.reference })}
                    onPress={open}
                    className="min-h-touch min-w-0 flex-1 justify-center"
                >
                    <RNText
                        testID={`${testID}-items`}
                        numberOfLines={1}
                        className="text-base font-bold text-content-primary hover:underline text-start"
                    >
                        {summary}
                    </RNText>
                    <RNText
                        testID={`${testID}-meta`}
                        numberOfLines={1}
                        className="mt-0.5 text-xs text-content-secondary text-start"
                    >
                        {t('account:orders.meta', {
                            date: formatter.formatDate(order.placedAt, { dateStyle: 'medium' }),
                            reference: order.reference,
                        })}
                    </RNText>
                </Pressable>
            </View>

            <View className="w-44">
                <StateBadge state={order.state} testID={`${testID}-state`} />
            </View>

            <RNText
                testID={`${testID}-total`}
                className="w-20 font-display text-lg font-bold tabular-nums text-content-primary text-end"
            >
                {formatMoney(formatter, order.total)}
            </RNText>

            <Pressable
                testID={`${testID}-view`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('account:orders.openHint', { reference: order.reference })}
                onPress={open}
                className="h-10 flex-row items-center gap-1.5 rounded-xl border border-stroke bg-surface-raised px-3.5 hover:bg-surface-brand-subtle"
            >
                <RNText className="text-sm font-semibold text-content-primary">
                    {t('account:orders.view')}
                </RNText>
            </Pressable>
        </View>
    );
}

/** The order on its way, on the canopy, with its progress and "Track order". */
function LiveOrder({ order }: { readonly order: PlacedOrder }) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const position = TRACK_POSITION[order.state];
    const names = order.lines.map((line) => line.name).join(t('account:profile.listSeparator'));

    return (
        <View
            testID={`${TEST_ID}-live`}
            className="relative mb-2 flex-row flex-wrap items-center gap-[18px] overflow-hidden rounded-[22px] bg-surface-canopy px-5 py-[18px]"
        >
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute -end-16 -top-24 h-56 w-56 rounded-full bg-stage-green opacity-15"
            />
            <View className="h-14 w-14 items-center justify-center rounded-[18px] bg-surface-brand-subtle">
                <Icon name="shoppingBag" size="lg" className="text-content-on-brand-subtle" />
            </View>
            <View className="min-w-[220px] flex-1">
                <RNText className="text-xs font-semibold uppercase tracking-wider text-content-on-canopy-muted text-start">
                    {`${t(`guest:order.states.${order.state}`)} · ${order.reference}`}
                </RNText>
                <RNText
                    numberOfLines={1}
                    className="mt-0.5 font-display text-xl font-bold text-content-on-canopy text-start"
                >
                    {names}
                </RNText>
                <RNText className="mt-0.5 text-sm text-content-on-canopy-muted text-start">
                    {formatter.formatDate(`${order.deliveryDate}T12:00:00Z`, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                    })}
                </RNText>
                <View aria-label={t('account:orders.progress')} className="mt-3 flex-row gap-1.5">
                    {TRACK_STEPS.map((step, index) => {
                        const done = index < position;
                        const now = index === position;
                        return (
                            <View key={step} className="min-w-0 flex-1 gap-1.5">
                                <View
                                    className={cx(
                                        'h-1.5 rounded-full',
                                        done || now
                                            ? 'bg-surface-brand-subtle'
                                            : 'bg-content-on-canopy/20',
                                    )}
                                />
                                <RNText
                                    numberOfLines={1}
                                    className={cx(
                                        'text-xs',
                                        now
                                            ? 'font-bold text-content-on-canopy'
                                            : done
                                              ? 'font-medium text-content-on-canopy'
                                              : 'font-medium text-content-on-canopy-muted',
                                    )}
                                >
                                    {t(`guest:order.states.${step}`)}
                                </RNText>
                            </View>
                        );
                    })}
                </View>
            </View>
            <Pressable
                testID={`${TEST_ID}-live-track`}
                role="button"
                accessibilityRole="button"
                onPress={() => {
                    router.push(`/customer/orders/${order.id}` as never);
                }}
                className="h-11 flex-row items-center gap-2 rounded-[14px] bg-surface-raised px-[18px]"
            >
                <RNText className="text-sm font-bold text-content-primary">
                    {t('account:orders.track')}
                </RNText>
                <Icon name="chevronForward" size="sm" className="text-content-primary" />
            </Pressable>
        </View>
    );
}

export function AccountOrdersPanel() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const orders = useMyOrdersQuery({ limit: PAGE_SIZE });
    const items = (orders.data?.pages ?? []).flatMap((page) => page.items);
    const [filter, setFilter] = useState<Filter>('all');
    const shown = items.filter((order) => matches(order, filter));
    const live = items.find((order) => !isDone(order));

    return (
        <View testID={TEST_ID} className={`${ACCOUNT_CARD} p-6`}>
            <PanelHead
                testID={`${TEST_ID}-title`}
                title={t('account:nav.orders')}
                {...(items.length === 0 ? {} : { count: formatter.formatNumber(items.length) })}
                end={
                    items.length === 0 ? undefined : (
                        <View
                            role="tablist"
                            aria-label={t('account:orders.showLabel')}
                            className="flex-row gap-1.5"
                        >
                            {FILTERS.map((each) => {
                                const on = each === filter;
                                return (
                                    <Pressable
                                        key={each}
                                        testID={`${TEST_ID}-filter-${each}`}
                                        role="tab"
                                        aria-selected={on}
                                        accessibilityState={{ selected: on }}
                                        onPress={() => {
                                            setFilter(each);
                                        }}
                                        className={cx(
                                            'h-9 flex-row items-center gap-1.5 rounded-full border px-3.5',
                                            on
                                                ? 'border-content-primary bg-content-primary'
                                                : 'border-stroke-subtle bg-surface-raised hover:bg-surface-sunken',
                                        )}
                                    >
                                        <RNText
                                            className={cx(
                                                'text-sm font-semibold',
                                                on ? 'text-surface-base' : 'text-content-secondary',
                                            )}
                                        >
                                            {t(`account:orders.filter.${each}`)}
                                        </RNText>
                                        <RNText
                                            className={cx(
                                                'text-xs tabular-nums opacity-75',
                                                on ? 'text-surface-base' : 'text-content-secondary',
                                            )}
                                        >
                                            {formatter.formatNumber(
                                                items.filter((order) => matches(order, each))
                                                    .length,
                                            )}
                                        </RNText>
                                    </Pressable>
                                );
                            })}
                        </View>
                    )
                }
            />

            <QueryStates
                query={orders}
                isEmpty={items.length === 0}
                emptyTitle={t('account:orders.empty')}
                emptyBody={t('account:orders.emptyBody')}
                emptyActions={
                    <Button
                        testID={`${TEST_ID}-browse`}
                        label={t('account:orders.browse')}
                        onPress={() => {
                            router.push('/meals');
                        }}
                    />
                }
                skeletonCount={3}
                testID={`${TEST_ID}-states`}
            >
                {live === undefined || filter === 'delivered' ? null : <LiveOrder order={live} />}
                <View className="flex-col" testID={`${TEST_ID}-list`}>
                    {shown.map((order) => (
                        <OrderRow key={order.id} order={order} />
                    ))}
                </View>
                {orders.hasNextPage ? (
                    <View className="border-t border-stroke-subtle pt-4">
                        <Inline space="sm" justify="center">
                            <Button
                                testID={`${TEST_ID}-more`}
                                variant="secondary"
                                label={t('account:orders.more')}
                                loading={orders.isFetchingNextPage}
                                onPress={() => {
                                    void orders.fetchNextPage();
                                }}
                            />
                        </Inline>
                    </View>
                ) : null}
            </QueryStates>
        </View>
    );
}
