import type { OrderDeskQueueRow } from '@healthy360/api-client/contracts';
import { Badge, Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { formatMoney } from '../../marketplace/format.ts';
import {
    kitchenOrderFulfilmentTypeKey,
    kitchenOrderPaymentMethodKey,
    orderDeskDeliveryState,
    orderDeskDeliveryStateKey,
    orderDeskDeliveryStateTone,
    orderDeskDueTone,
    orderDeskRowTestId,
} from '../ops-format.ts';

/**
 * The queue's three cells that say more than one value: how late, where the run stands, and where
 * the money stands. Each keeps the test ids the queue suite has always read, so the row's shape can
 * change without the contract under it moving.
 */

const EM_DASH = '—';

/**
 * How late an order is, as the interval itself.
 *
 * The tone is the kitchen display's ageing scale (`orderDeskDueTone`: amber at fifteen minutes
 * past due, red at thirty, neutral while early). The label *is* the interval, spelled by the
 * locale's relative-time formatter, so the badge reads the same in greyscale as in colour.
 */
export function DueBadge({ row, now }: { readonly row: OrderDeskQueueRow; readonly now: Date }) {
    const formatter = useFormatter();
    return (
        <Badge
            testID={`${orderDeskRowTestId(String(row.id))}-due-age`}
            tone={orderDeskDueTone(row.dueAt, now)}
            label={formatter.formatRelativeTime(row.dueAt, now)}
        />
    );
}

/**
 * Where the run stands, and what the customer has been told.
 *
 * A pickup or a counter sale is never driven anywhere, so its cell is the workspace's em dash — with
 * an accessible sentence naming the kind of sale, because a dash is silent and the kind is what
 * makes it mean something. A delivery gets the dispatch state as a badge and, once there is a job,
 * the tracking status beside it: the second is what an agent quotes on the telephone.
 */
export function DeliveryStateCell({ row }: { readonly row: OrderDeskQueueRow }) {
    const { t } = useTranslation();
    const state = orderDeskDeliveryState(row);
    const testID = `${orderDeskRowTestId(String(row.id))}-delivery`;

    if (state === 'not_delivered') {
        return (
            <Text
                tone="secondary"
                testID={testID}
                accessibilityLabel={t('kitchen:desk.a11y.noDeliveryRun', {
                    type: t(kitchenOrderFulfilmentTypeKey(row.fulfilmentType)),
                })}
            >
                {EM_DASH}
            </Text>
        );
    }

    return (
        <View testID={testID} className="flex-row items-center">
            <Badge
                testID={`${testID}-state`}
                tone={orderDeskDeliveryStateTone(state)}
                label={t(orderDeskDeliveryStateKey(state))}
            />
        </View>
    );
}

/**
 * The intended method, and the position against it — on one line.
 *
 * "Settled", never "paid": the platform holds no proof that money exists, only that somebody wrote
 * down that it arrived. The unsettled case shows the *shortfall* rather than a bare "no", because
 * part payments are ordinary and the number is what the agent has to collect.
 */
export function PaymentCell({ row }: { readonly row: OrderDeskQueueRow }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const testID = `${orderDeskRowTestId(String(row.id))}-payment`;

    return (
        <View testID={testID} className="flex-row flex-wrap items-baseline gap-hair">
            <Text testID={`${testID}-method`}>
                {t(kitchenOrderPaymentMethodKey(row.payment.method))}
            </Text>
            <Text variant="caption" tone="disabled" aria-hidden>
                ·
            </Text>
            {row.payment.receipted ? (
                <Text variant="caption" tone="success" testID={`${testID}-state`}>
                    {t('kitchen:desk.payment.receipted')}
                </Text>
            ) : (
                <Text variant="caption" tone="warning" testID={`${testID}-outstanding`}>
                    {t('kitchen:desk.payment.outstanding', {
                        amount: formatMoney(formatter, {
                            amount: row.totalMinor - row.payment.receivedMinor,
                            currency: row.currencyCode,
                        }),
                    })}
                </Text>
            )}
        </View>
    );
}
