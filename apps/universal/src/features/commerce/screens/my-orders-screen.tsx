import { Badge, Button, Card, EmptyState, Inline, Stack, Text } from '@healthy360/design-system';
import type { BadgeTone } from '@healthy360/design-system';
import type { OrderState, PlacedOrder } from '@healthy360/api-client/contracts';
import { OrderId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useMyOrderQuery, useMyOrdersQuery } from '../../../data/commerce-hooks.ts';
import { ListingHeader } from '../../../ui/listing-header.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { formatAddress } from '../address.ts';
import { PriceSummary } from '../price-summary.tsx';
import type { PriceRow } from '../price-summary.tsx';
import { PRICE_LINE_LABEL_KEYS } from './checkout-screen.tsx';

/**
 * `/customer/orders` and `/customer/orders/{order}` — the signed-in person's order history.
 *
 * Both read `PlacedOrder`, the shape the checkout confirmation already renders, so a row here and the
 * confirmation that preceded it can never disagree. The status words are the guest tracker's
 * (`guest:order.states`): the same order lifecycle, told the same way, whether or not the person had
 * an account when they placed it.
 */

/** Tone per state, with the word always beside it — never colour alone. */
const STATE_TONES: Readonly<Record<OrderState, BadgeTone>> = {
    placed: 'info',
    confirmed: 'info',
    preparing: 'info',
    delivered: 'success',
    cancelled: 'danger',
};

function OrderStateBadge({
    state,
    testID,
}: {
    readonly state: OrderState;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    return (
        <Badge testID={testID} tone={STATE_TONES[state]} label={t(`guest:order.states.${state}`)} />
    );
}

export function MyOrdersScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const orders = useMyOrdersQuery();
    const items: readonly PlacedOrder[] = orders.data?.pages.flatMap((page) => page.items) ?? [];

    return (
        <Stack space="lg" testID="my-orders-screen">
            <ListingHeader
                testID="my-orders-header"
                title={t('commerce:orders.title')}
                meta={t('commerce:orders.body')}
            />

            <QueryStates
                query={orders}
                isEmpty={items.length === 0}
                emptyTitle={t('commerce:orders.emptyTitle')}
                emptyBody={t('commerce:orders.emptyBody')}
                emptyActions={
                    <Button
                        testID="my-orders-browse"
                        label={t('commerce:orders.browse')}
                        onPress={() => {
                            router.push('/meals');
                        }}
                    />
                }
                skeletonCount={3}
                testID="my-orders"
            >
                <Stack space="sm" testID="my-orders-list">
                    {items.map((order) => {
                        const id = String(order.id);
                        const total = formatMoney(formatter, order.total);
                        return (
                            <Card
                                key={id}
                                testID={`my-order-row-${id}`}
                                padding="md"
                                interactive
                                accessibilityLabel={t('commerce:orders.rowLabel', {
                                    reference: order.reference,
                                    state: t(`guest:order.states.${order.state}`),
                                    total,
                                })}
                                onPress={() => {
                                    router.push(`/customer/orders/${id}` as never);
                                }}
                            >
                                <Stack space="xs">
                                    <Inline space="sm" align="center" justify="between">
                                        <Text variant="bodyStrong">{order.reference}</Text>
                                        <OrderStateBadge
                                            state={order.state}
                                            testID={`my-order-row-${id}-state`}
                                        />
                                    </Inline>
                                    <Text tone="secondary">
                                        {t('commerce:orders.placedOn', {
                                            date: formatter.formatDate(order.placedAt, {
                                                dateStyle: 'medium',
                                            }),
                                        })}
                                    </Text>
                                    <Inline space="sm" align="center" justify="between">
                                        <Text tone="secondary">
                                            {t('guest:order.lines', { count: order.lines.length })}
                                        </Text>
                                        <Text
                                            variant="bodyStrong"
                                            testID={`my-order-row-${id}-total`}
                                        >
                                            {total}
                                        </Text>
                                    </Inline>
                                </Stack>
                            </Card>
                        );
                    })}

                    {orders.hasNextPage ? (
                        <Inline space="sm">
                            <Button
                                testID="my-orders-more"
                                variant="secondary"
                                label={t('commerce:orders.loadMore')}
                                loading={orders.isFetchingNextPage}
                                onPress={() => {
                                    void orders.fetchNextPage();
                                }}
                            />
                        </Inline>
                    ) : null}
                </Stack>
            </QueryStates>
        </Stack>
    );
}

export interface MyOrderDetailScreenProps {
    readonly orderId: string | undefined;
}

export function MyOrderDetailScreen({ orderId }: MyOrderDetailScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const parsed = orderId === undefined ? null : OrderId.safeParse(orderId);
    const query = useMyOrderQuery(parsed);
    const order = query.data;

    const toList = () => {
        router.push('/customer/orders' as never);
    };

    const listAction = (
        <Button
            testID="my-order-list"
            variant="quiet"
            label={t('commerce:orders.backToList')}
            onPress={toList}
        />
    );

    if (parsed === null) {
        return (
            <Stack space="lg" testID="my-order-screen">
                <EmptyState
                    testID="my-order-empty"
                    title={t('commerce:orders.notFoundTitle')}
                    body={t('commerce:orders.notFoundBody')}
                    actions={listAction}
                />
            </Stack>
        );
    }

    const lineRows: readonly PriceRow[] = (order?.lines ?? []).map((line) => ({
        key: line.id,
        label: t('commerce:orders.lineLabel', {
            quantity: formatter.formatNumber(line.quantity),
            name: line.name,
        }),
        amount: line.lineTotal,
    }));

    const totalRows: readonly PriceRow[] =
        order === undefined
            ? []
            : [
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

    const when = [
        order === undefined || order.deliveryDate === ''
            ? null
            : formatter.formatDate(order.deliveryDate, { dateStyle: 'full' }),
        order === undefined || order.slotCode === ''
            ? null
            : t(`commerce:slots.${order.slotCode}`, { defaultValue: order.slotCode }),
    ]
        .filter((part): part is string => part !== null)
        .join(' · ');

    return (
        <Stack space="lg" testID="my-order-screen">
            <QueryStates
                query={query}
                isEmpty={order === undefined}
                emptyTitle={t('commerce:orders.notFoundTitle')}
                emptyBody={t('commerce:orders.notFoundBody')}
                emptyActions={listAction}
                treatFailuresAsEmpty={['resource.not_found']}
                skeletonCount={2}
                testID="my-order"
            >
                {order === undefined ? null : (
                    <Stack space="lg">
                        <ListingHeader
                            testID="my-order-header"
                            breadcrumbs={[
                                {
                                    key: 'orders',
                                    label: t('commerce:orders.title'),
                                    onPress: toList,
                                    testID: 'my-order-crumb-orders',
                                },
                                { key: 'order', label: order.reference },
                            ]}
                            title={order.reference}
                            meta={t('commerce:orders.placedOn', {
                                date: formatter.formatDate(order.placedAt, { dateStyle: 'medium' }),
                            })}
                            trailing={
                                <OrderStateBadge state={order.state} testID="my-order-state" />
                            }
                        />

                        <Card padding="md" testID="my-order-lines">
                            <Stack space="md">
                                <Text variant="label">
                                    {t('commerce:checkout.successSummaryTitle')}
                                </Text>
                                <PriceSummary rows={lineRows} testID="my-order-line" />
                                <PriceSummary rows={totalRows} testID="my-order-price" />
                            </Stack>
                        </Card>

                        <Card padding="md" testID="my-order-delivery">
                            <Stack space="sm">
                                <Text variant="bodyStrong">{t('guest:order.deliveringTo')}</Text>
                                <Text tone="secondary" testID="my-order-address">
                                    {formatAddress(order.address)}
                                </Text>

                                {when === '' ? null : (
                                    <>
                                        <Text variant="bodyStrong">{t('guest:order.slot')}</Text>
                                        <Text tone="secondary" testID="my-order-slot">
                                            {when}
                                        </Text>
                                    </>
                                )}

                                <Text variant="bodyStrong">{t('guest:order.payment')}</Text>
                                <Text tone="secondary">{t('guest:review.cashOnDelivery')}</Text>
                            </Stack>
                        </Card>
                    </Stack>
                )}
            </QueryStates>
        </Stack>
    );
}
