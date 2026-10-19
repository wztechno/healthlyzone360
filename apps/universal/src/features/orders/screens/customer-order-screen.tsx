import { Button, EmptyState } from '@healthy360/design-system';
import { OrderId } from '@healthy360/domain-types';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useMyOrderQuery } from '../../../data/commerce-hooks.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { useOnlineStatus } from '../../../online/online-status.tsx';
import { SubpageTrail } from '../../../ui/subpage-trail.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { OrderTracking } from '../order-tracking.tsx';

/**
 * `/customer/orders/{order}` — one of the signed-in customer's orders, tracked.
 *
 * The same HealthZone `track` body the guest page draws (`../order-tracking.tsx`), over
 * `GET /me/orders/{order}`. Two differences, both because the person is signed in: there is no
 * "keep this reference" reminder — the order lives in their account history, which the trail above
 * the tracking leads back to — and no conversion prompt.
 *
 * **The way back is at the top.** The customer area is a `<Slot/>` with no header of its own, and
 * on iOS there is no swipe back inside it, so the history used to be reachable only from a button
 * under every tracking card. The trail ("Order history › H360-1042") is where every other sub-page
 * keeps its way up, and it goes there by name (`dismissTo`) — never a second copy of the account
 * stacked on top of the order.
 *
 * **It keeps itself current (HA-23).** While the order is still on its way the page re-reads it
 * every {@link ORDER_TRACKING_POLL_MS}, so a kitchen's confirm or a driver's pick-up shows up without
 * anybody pressing Refresh; it stops once the order is delivered or cancelled, and while offline —
 * an interval firing into a dead network is retries nobody asked for.
 *
 * The route parameter is the order's **identifier**, never its printed number: the endpoint refuses
 * the number on purpose (a receipt passes through a courier's hands). A malformed identifier is
 * answered as "not found" without a request, and so is another account's order — the server's
 * 404 does not distinguish the two, and neither does this page.
 */

const TEST_ID = 'customer-order';

/** The kitchen display's and the driver sheet's fifteen seconds, for the same reasons. */
export const ORDER_TRACKING_POLL_MS = 15_000;

/** The account's order history — where this page goes up to. */
export const ORDER_HISTORY_HREF = '/customer/account?section=orders';

export interface CustomerOrderScreenProps {
    readonly orderId: string | undefined;
}

export function CustomerOrderScreen({ orderId }: CustomerOrderScreenProps) {
    const { t } = useTranslation();
    // Never a detour, so never a return of its own: up is always the history.
    const history = useReturnTo(undefined, ORDER_HISTORY_HREF);

    const parsed = orderId === undefined ? null : OrderId.safeParse(orderId);
    const { online } = useOnlineStatus();
    const order = useMyOrderQuery(parsed, { pollMs: online ? ORDER_TRACKING_POLL_MS : false });

    // The empty states' one action: there is no order to show, and the history is where they are.
    const backToOrders = (
        <Button
            testID={`${TEST_ID}-history`}
            variant="secondary"
            label={t('account:orders.backToHistory')}
            onPress={history.up}
        />
    );

    return (
        // The design's measure: a 1000px section less its 28px gutters, centred in the shell.
        <View testID={TEST_ID} className="w-full max-w-[944px] flex-col gap-6 self-center">
            {parsed === null ? (
                <EmptyState
                    testID={`${TEST_ID}-states-empty`}
                    title={t('account:orders.notFoundTitle')}
                    body={t('account:orders.notFoundBody')}
                    actions={backToOrders}
                />
            ) : (
                <QueryStates
                    query={order}
                    isEmpty={false}
                    treatFailuresAsEmpty={['resource.not_found']}
                    emptyTitle={t('account:orders.notFoundTitle')}
                    emptyBody={t('account:orders.notFoundBody')}
                    emptyActions={backToOrders}
                    skeletonCount={2}
                    testID={`${TEST_ID}-states`}
                >
                    {order.data === undefined ? null : (
                        <View className="flex-col gap-6">
                            {/*
                             * Not in the design, which has no history to go back to. The order
                             * lives in the account's history, and this is the way up to it.
                             */}
                            <SubpageTrail
                                testID={`${TEST_ID}-trail`}
                                back={history}
                                parentLabel={t('account:orders.title')}
                                current={order.data.reference}
                            />
                            <OrderTracking
                                testID={TEST_ID}
                                order={order.data}
                                paymentLabel={t('guest:review.cashOnDelivery')}
                                onRefresh={() => {
                                    void order.refetch();
                                }}
                                refreshing={order.isRefetching}
                            />
                        </View>
                    )}
                </QueryStates>
            )}
        </View>
    );
}
