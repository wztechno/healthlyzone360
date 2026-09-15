import type { OrderDeskQueueRow } from '@healthy360/api-client/contracts';
import { Badge, Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
    kitchenOrderPaymentMethodKey,
    orderDeskDueTone,
    orderDeskRowTestId,
} from '../ops-format.ts';

/**
 * The queue's cells that are more than a plain value: how late, and how the order is being paid.
 * Each keeps the test ids the queue suite has always read.
 */

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
 * The intended method, and nothing else. What has arrived against it is read in the drawer.
 */
export function PaymentCell({ row }: { readonly row: OrderDeskQueueRow }) {
    const { t } = useTranslation();
    const testID = `${orderDeskRowTestId(String(row.id))}-payment`;

    return (
        <View testID={testID} className="flex-row items-baseline">
            <Text testID={`${testID}-method`}>
                {t(kitchenOrderPaymentMethodKey(row.payment.method))}
            </Text>
        </View>
    );
}
