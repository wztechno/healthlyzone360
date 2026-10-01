import type { PlacedOrder } from '@healthy360/api-client/contracts';
import { Badge, Button, Inline, useBreakpoint } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { useMyOrdersQuery } from '../../data/commerce-hooks.ts';
import { usePrototypeAction } from '../../prototype/index.ts';
import { Eyebrow } from '../../ui/eyebrow.tsx';
import { formatMoney } from '../marketplace/format.ts';
import { QueryStates } from '../marketplace/query-states.tsx';
import { OrderLineThumb } from '../orders/order-line-thumb.tsx';
import { ORDER_STATE_TONE } from '../orders/order-progress.ts';
import { ACCOUNT_CARD, PanelTitle } from './account-card.tsx';

/**
 * The account page's Orders section — the HealthZone `account` screen's "Order history" card.
 *
 * One card: a head row (the title, and an eyebrow at the end), then a row per order in the design's
 * four columns — a 52px thumbnail, what was in it over "date · #reference", the status badge in the
 * tracking page's tones, and the total beside "Reorder". Over `GET /me/orders`, newest first, as a
 * cursor walk with a "show older" control rather than a pretence that the first page is everything.
 * The design's eyebrow reads "LAST 90 DAYS"; the history is not windowed, so it says what the list
 * actually is — newest first.
 *
 * * **The thumbnail** is the first line's photograph, looked up by its slug — an order line carries
 *   no meal id (see `../orders/order-line-thumb.tsx`).
 * * **The items line opens the order** at `/customer/orders/{order}` — the row's real destination,
 *   on the element that names the order.
 * * **Reorder** has nothing behind it: no endpoint turns an order back into a basket, and an order
 *   line carries no meal id to add to one. So it is the prototype mechanism's control, drawn as the
 *   design draws it.
 */

const TEST_ID = 'account-orders';
const PAGE_SIZE = 20;

function OrderRow({ order }: { readonly order: PlacedOrder }) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const prototype = usePrototypeAction();
    const { atLeast } = useBreakpoint();
    const testID = `${TEST_ID}-row-${order.id}`;
    const first = order.lines[0];

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
            className={
                atLeast('md')
                    ? 'flex-row items-center gap-4 border-t border-stroke-subtle px-5 py-4'
                    : 'flex-row flex-wrap items-center gap-x-4 gap-y-3 border-t border-stroke-subtle px-5 py-4'
            }
        >
            <OrderLineThumb
                testID={`${testID}-thumb`}
                name={first?.name ?? order.reference}
                className="h-[52px] w-[52px] rounded-lg"
            />

            <Pressable
                testID={`${testID}-open`}
                role="link"
                accessibilityRole="link"
                accessibilityHint={t('account:orders.openHint', { reference: order.reference })}
                onPress={() => {
                    router.push(`/customer/orders/${order.id}` as never);
                }}
                className="min-h-touch min-w-[180px] flex-1 flex-col justify-center"
            >
                <RNText
                    testID={`${testID}-items`}
                    numberOfLines={2}
                    className="text-base font-semibold text-content-primary hover:underline text-start"
                >
                    {summary}
                </RNText>
                <RNText
                    testID={`${testID}-meta`}
                    className="mt-0.5 text-sm text-content-secondary text-start"
                >
                    {t('account:orders.meta', {
                        date: formatter.formatDate(order.placedAt, { dateStyle: 'medium' }),
                        reference: order.reference,
                    })}
                </RNText>
            </Pressable>

            <Badge
                testID={`${testID}-state`}
                tone={ORDER_STATE_TONE[order.state]}
                label={t(`guest:order.states.${order.state}`)}
            />

            <View className="flex-row items-center gap-2.5">
                <RNText
                    testID={`${testID}-total`}
                    className="font-display text-lg font-bold tabular-nums text-content-primary text-end"
                >
                    {formatMoney(formatter, order.total)}
                </RNText>
                <Pressable
                    testID={`${testID}-reorder`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityHint={t('marketplace:prototype.hint')}
                    onPress={() => {
                        prototype({ contract: 'POST /api/v1/me/orders/{order}/reorder' });
                    }}
                    className="min-h-touch items-center justify-center rounded bg-surface-sunken px-3 hover:bg-stroke-subtle"
                >
                    <RNText className="text-sm font-semibold text-content-primary">
                        {t('account:orders.reorder')}
                    </RNText>
                </Pressable>
            </View>
        </View>
    );
}

export function AccountOrdersPanel() {
    const { t } = useTranslation();
    const router = useRouter();
    const orders = useMyOrdersQuery({ limit: PAGE_SIZE });
    const items = (orders.data?.pages ?? []).flatMap((page) => page.items);

    return (
        <View testID={TEST_ID} className={`${ACCOUNT_CARD} overflow-hidden`}>
            <View className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
                <PanelTitle testID={`${TEST_ID}-title`}>{t('account:orders.title')}</PanelTitle>
                <Eyebrow>{t('account:orders.newestFirst')}</Eyebrow>
            </View>

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
                <View className="flex-col" testID={`${TEST_ID}-list`}>
                    {items.map((order) => (
                        <OrderRow key={order.id} order={order} />
                    ))}
                </View>
                {orders.hasNextPage ? (
                    <View className="border-t border-stroke-subtle px-5 py-4">
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
