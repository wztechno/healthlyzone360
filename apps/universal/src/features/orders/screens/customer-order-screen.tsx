import { Callout, useBreakpoint } from '@healthy360/design-system';
import { OrderId } from '@healthy360/domain-types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
    toFailure,
    useCancelMyOrderMutation,
    useMyOrderQuery,
} from '../../../data/commerce-hooks.ts';
import { DialogFailure } from '../../commerce/subscription-editors.tsx';
import { ShopDialog, ShopDialogButton } from '../../../ui/shop-dialog.tsx';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { useOnlineStatus } from '../../../online/online-status.tsx';
import { BackPill } from '../../../ui/back-pill.tsx';
import { ShopPhoneTopBar } from '../../../ui/shop-phone-bar.tsx';
import { ShopStateCard } from '../../../ui/shop-state.tsx';
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
 * under every tracking card. The back pill ("Order history") is where every other shop sub-page
 * keeps its way up, and it goes there by name (`dismissTo`) — never a second copy of the account
 * stacked on top of the order.
 *
 * **It keeps itself current (HA-23).** While the order is still on its way the page re-reads it
 * every {@link ORDER_TRACKING_POLL_MS}, so a kitchen's confirm or a driver's pick-up shows up within
 * seconds, and again the moment the tab is shown; it stops once the order is delivered or
 * cancelled, and while offline — an interval firing into a dead network is retries nobody asked
 * for. So there is no Refresh button here: it would only ever repeat what the page just did.
 *
 * **Cancel, only while placed.** Until the kitchen accepts the order the customer may call it off,
 * behind the same confirm dialog a subscription cancel uses (`subscription-editors.tsx`). Once
 * accepted the button is gone; a cancel that loses the race to the kitchen's accept is told so inside
 * the dialog, and the page re-reads the order.
 *
 * The route parameter is the order's **identifier**, never its printed number: the endpoint refuses
 * the number on purpose (a receipt passes through a courier's hands). A malformed identifier is
 * answered as "not found" without a request, and so is another account's order — the server's
 * 404 does not distinguish the two, and neither does this page.
 */

const TEST_ID = 'customer-order';

/**
 * Five seconds, not the kitchen display's fifteen: a customer watching their order is looking for
 * the step to move, and one small read of one order is cheap against the `api` limiter's sixty a
 * minute.
 */
export const ORDER_TRACKING_POLL_MS = 5_000;

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
    const cancel = useCancelMyOrderMutation();
    const [confirming, setConfirming] = useState(false);
    const failure = toFailure(cancel.error);
    const tooLate = failure?.code === 'resource.conflict';
    // The kitchen cancelled or rejected it first: not "accepted", and nothing left to ask for.
    const alreadyCancelled =
        failure?.code === 'resource.conflict' && failure.reason === 'order_already_cancelled';
    const closeDialog = () => {
        setConfirming(false);
    };

    // Shop · Orders, pin 6: the way back to the history is the page's Back pill, kept above the
    // card whether or not there is an order to show.
    // Shop · Orders, phone board: "‹ Your order" as the page's own bar.
    const phone = !useBreakpoint().atLeast('md');
    const trail = phone ? (
        <View testID={`${TEST_ID}-trail`}>
            <ShopPhoneTopBar
                backTestID={`${TEST_ID}-trail-up`}
                backLabel={t('account:orders.title')}
                onBack={history.up}
                titleTestID={`${TEST_ID}-bar-title`}
                title={t('guest:order.yourOrder')}
            />
        </View>
    ) : (
        <View testID={`${TEST_ID}-trail`} className="items-start pt-1">
            <BackPill
                testID={`${TEST_ID}-trail-up`}
                label={t('account:orders.title')}
                onPress={history.up}
            />
        </View>
    );

    return (
        // The design's measure: a 1000px section less its 28px gutters, centred in the shell.
        <View testID={TEST_ID} className="w-full max-w-[944px] flex-col gap-6 self-center">
            {trail}
            {parsed === null ? (
                <ShopStateCard
                    testID={`${TEST_ID}-states-empty`}
                    icon="receipt"
                    title={t('account:orders.notFoundTitle')}
                    body={t('account:orders.notFoundBody')}
                />
            ) : (
                <QueryStates
                    query={order}
                    isEmpty={false}
                    treatFailuresAsEmpty={['resource.not_found']}
                    emptyTitle={t('account:orders.notFoundTitle')}
                    emptyBody={t('account:orders.notFoundBody')}
                    emptyIcon="receipt"
                    skeleton="page"
                    skeletonCount={2}
                    testID={`${TEST_ID}-states`}
                >
                    {order.data === undefined ? null : (
                        <OrderTracking
                            testID={TEST_ID}
                            order={order.data}
                            paymentLabel={t('guest:review.cashOnDelivery')}
                            onCancel={() => {
                                cancel.reset();
                                setConfirming(true);
                            }}
                        />
                    )}
                </QueryStates>
            )}

            <ShopDialog
                testID={`${TEST_ID}-cancel-dialog`}
                open={confirming}
                onClose={closeDialog}
                tone={tooLate ? 'warning' : 'danger'}
                icon={tooLate ? 'warning' : 'circleX'}
                title={t('account:orders.cancelTitle')}
                description={t('account:orders.cancelBody')}
                actions={
                    tooLate ? (
                        <ShopDialogButton
                            testID={`${TEST_ID}-cancel-done`}
                            kind="brand"
                            label={t('commerce:common.close')}
                            onPress={closeDialog}
                        />
                    ) : (
                        <>
                            <ShopDialogButton
                                testID={`${TEST_ID}-cancel-keep`}
                                label={t('account:orders.cancelKeep')}
                                onPress={closeDialog}
                            />
                            <ShopDialogButton
                                testID={`${TEST_ID}-cancel-confirm`}
                                kind="danger"
                                label={t('account:orders.cancelConfirm')}
                                busy={cancel.isPending}
                                onPress={() => {
                                    if (order.data === undefined) return;
                                    cancel.mutate(order.data.id, { onSuccess: closeDialog });
                                }}
                            />
                        </>
                    )
                }
            >
                {tooLate ? (
                    <Callout
                        testID={`${TEST_ID}-cancel-too-late`}
                        role="alert"
                        tone="warning"
                        icon="warning"
                        title={t(
                            alreadyCancelled
                                ? 'account:orders.cancelAlreadyCancelledTitle'
                                : 'account:orders.cancelTooLateTitle',
                        )}
                        body={t(
                            alreadyCancelled
                                ? 'account:orders.cancelAlreadyCancelledBody'
                                : 'account:orders.cancelTooLateBody',
                        )}
                    />
                ) : (
                    <DialogFailure error={cancel.error} testID={`${TEST_ID}-cancel-failure`} />
                )}
            </ShopDialog>
        </View>
    );
}
