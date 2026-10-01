import { Stack, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
    useGuestConversionPrefillQuery,
    useGuestOrderQuery,
    useGuestToken,
} from '../../../data/guest-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { OrderTracking } from '../../orders/order-tracking.tsx';
import { ConversionPrompt } from '../conversion-prompt.tsx';

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
 * will have. The design puts the number in the eyebrow; it is kept there, as its own selectable
 * text, and stated again in one caption line at the foot of the timeline card, under the design's
 * three buttons, with the reason to keep it — the one line this page adds to the design. The retention
 * window is said on the not-found path for the same reason — an old reference stops working, and
 * "we deleted it on schedule" is a better answer than a blank page.
 *
 * ## The conversion prompt lives here and not in the checkout
 *
 * Offered before the order exists it becomes a condition of placing it. Offered after, it is what
 * it claims to be: an option, pre-filled from what we already know, with a visible way past it.
 * See `../conversion-prompt.tsx`.
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
    const token = useGuestToken();
    // Only offered to the person who still holds the session that placed it. Somebody opening a
    // shared link is reading a receipt, not being sold an account.
    const prefill = useGuestConversionPrefillQuery(token !== null);

    return (
        // The design's measure: a 1000px section less its 28px gutters, centred in the shell.
        <View testID={TEST_ID} className="w-full max-w-[944px] flex-col gap-6 self-center">
            <QueryStates
                query={order}
                isEmpty={reference === undefined}
                emptyTitle={t('guest:order.notFoundTitle')}
                emptyBody={t('guest:order.notFoundBody')}
                skeletonCount={2}
                testID={`${TEST_ID}-states`}
            >
                {order.data === undefined ? null : (
                    <Stack space="lg">
                        <OrderTracking
                            testID={TEST_ID}
                            order={order.data}
                            paymentLabel={t('guest:review.cashOnDelivery')}
                            onRefresh={() => {
                                void order.refetch();
                            }}
                            refreshing={order.isRefetching}
                            footer={
                                <View className="flex-row flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <Text variant="caption" tone="secondary">
                                        {t('guest:order.reference')}
                                    </Text>
                                    <Text
                                        testID={`${TEST_ID}-reference-keep`}
                                        variant="caption"
                                        className="font-semibold tabular-nums"
                                        selectable
                                    >
                                        {order.data.reference}
                                    </Text>
                                    <Text variant="caption" tone="secondary">
                                        {t('guest:order.keepReference')}
                                    </Text>
                                </View>
                            }
                        />

                        {prefill.data === undefined ? null : (
                            <ConversionPrompt
                                testID={`${TEST_ID}-conversion`}
                                prefill={prefill.data}
                                onConverted={() => {
                                    // Nothing to navigate away to: the receipt is still the thing
                                    // the person came for, and the prompt reports its own success.
                                }}
                            />
                        )}
                    </Stack>
                )}
            </QueryStates>
        </View>
    );
}
