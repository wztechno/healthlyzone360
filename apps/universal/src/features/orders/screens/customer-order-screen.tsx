import { Button, EmptyState, Inline } from '@healthy360/design-system';
import { OrderId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useMyOrderQuery } from '../../../data/commerce-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { OrderTracking } from '../order-tracking.tsx';

/**
 * `/customer/orders/{order}` — one of the signed-in customer's orders, tracked.
 *
 * The same HealthZone `track` body the guest page draws (`../order-tracking.tsx`), over
 * `GET /me/orders/{order}`. Two differences, both because the person is signed in: there is no
 * "keep this reference" reminder — the order lives in their account history, which is where the
 * "back to your orders" control under the cards goes — and no conversion prompt.
 *
 * The route parameter is the order's **identifier**, never its printed number: the endpoint refuses
 * the number on purpose (a receipt passes through a courier's hands). A malformed identifier is
 * answered as "not found" without a request, and so is another account's order — the server's
 * 404 does not distinguish the two, and neither does this page.
 */

const TEST_ID = 'customer-order';

export interface CustomerOrderScreenProps {
    readonly orderId: string | undefined;
}

export function CustomerOrderScreen({ orderId }: CustomerOrderScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();

    const parsed = orderId === undefined ? null : OrderId.safeParse(orderId);
    const order = useMyOrderQuery(parsed);

    const backToOrders = (
        <Button
            testID={`${TEST_ID}-history`}
            variant="secondary"
            label={t('account:orders.backToHistory')}
            onPress={() => {
                router.push('/customer/account?section=orders' as never);
            }}
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
                            <OrderTracking
                                testID={TEST_ID}
                                order={order.data}
                                paymentLabel={t('guest:review.cashOnDelivery')}
                                onRefresh={() => {
                                    void order.refetch();
                                }}
                                refreshing={order.isRefetching}
                            />
                            {/*
                             * Not in the design, which has no history to go back to. The order
                             * lives in the account's history, and this is the way back to it.
                             */}
                            <Inline space="sm">{backToOrders}</Inline>
                        </View>
                    )}
                </QueryStates>
            )}
        </View>
    );
}
