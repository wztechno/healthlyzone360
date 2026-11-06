import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useGuestOrderQuery } from '../../../data/guest-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { OrderTracking } from '../../orders/order-tracking.tsx';

/**
 * `/orders/{order}` — the guest order page: where the order is, what is in it, where it is going.
 *
 * The body is the HealthZone `track` screen, shared with the signed-in order page — see
 * `../../orders/order-tracking.tsx` for how each of the design's slots is bound and which are
 * absent for want of an endpoint. What is the guest's own is around it.
 *
 * ## The reference is still the point of the page
 *
 * There is no account to find this order from later, and the URL is the only bookmark a guest
 * will have. Shop · Orders, pin 3: the number sits under the lede as a bold chip with Copy and the
 * reason to keep it, in place of three caption runs at the foot of the timeline card. The retention
 * window is said on the not-found path for the same reason — an old reference stops working, and
 * "we deleted it on schedule" is a better answer than a blank page.
 *
 * The guest sign-up card the page used to offer is left out on the board: guests must sign in to
 * order now, so there is nobody new to convert here.
 *
 * ## Public route, and that is deliberate
 *
 * The page sits in the marketplace group with no session behind it, because the person reading it
 * has no account by definition. What protects it is the reference itself, which the real generator
 * makes unguessable — the mock's sequential one is a fixture convenience and says so in `ids.ts`.
 */

const TEST_ID = 'guest-order';

export interface GuestOrderScreenProps {
    readonly reference: string | undefined;
}

export function GuestOrderScreen({ reference }: GuestOrderScreenProps) {
    const { t } = useTranslation();

    const order = useGuestOrderQuery(reference ?? null);

    return (
        // The design's measure: a 1000px section less its 28px gutters, centred in the shell.
        <View testID={TEST_ID} className="w-full max-w-[944px] flex-col gap-6 self-center">
            <QueryStates
                query={order}
                isEmpty={reference === undefined}
                treatFailuresAsEmpty={['resource.not_found']}
                emptyTitle={t('guest:order.notFoundTitle')}
                emptyBody={t('guest:order.notFoundBody')}
                emptyIcon="receipt"
                skeleton="rows"
                skeletonCount={2}
                testID={`${TEST_ID}-states`}
            >
                {order.data === undefined ? null : (
                    <OrderTracking
                        testID={TEST_ID}
                        order={order.data}
                        paymentLabel={t('guest:review.cashOnDelivery')}
                        onRefresh={() => {
                            void order.refetch();
                        }}
                        refreshing={order.isRefetching}
                        showReference
                    />
                )}
            </QueryStates>
        </View>
    );
}
