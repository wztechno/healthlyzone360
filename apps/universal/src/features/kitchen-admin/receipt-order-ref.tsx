import { Button, Text } from '@healthy360/design-system';
import type { PurchaseOrderId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';

import { useCan } from '../../access/gate.tsx';
import type { RecordAction } from './catalogue/record-popup.tsx';
import { INVENTORY_ORDER_SUPPLIES_PERMISSION } from './entity-registry.ts';

/**
 * The order a receipt row was delivered against: its number, or a dash for a market purchase.
 *
 * A link only for whoever can open the order. Everyone else reads the number as plain text, so
 * nobody is handed a link that ends in a refusal. The wrapper keeps a press off the row underneath,
 * which opens the receipt, the way the row's own action buttons do.
 */
export function ReceiptOrderRef({
    orderId,
    orderNumber,
    testID,
}: {
    readonly orderId: PurchaseOrderId | null;
    readonly orderNumber: string | null;
    readonly testID: string;
}) {
    const router = useRouter();
    const canOpenOrder = useCan(INVENTORY_ORDER_SUPPLIES_PERMISSION);

    if (orderId === null || orderNumber === null || !canOpenOrder) {
        return (
            <Text variant="mono" tone="secondary" numberOfLines={1} testID={testID}>
                {orderNumber ?? '—'}
            </Text>
        );
    }

    return (
        <View
            className="self-start"
            {...(Platform.OS === 'web'
                ? {
                      onClick: (event: { stopPropagation: () => void }) => {
                          event.stopPropagation();
                      },
                  }
                : {})}
        >
            <Pressable
                testID={testID}
                accessibilityRole="link"
                onPress={() => {
                    router.push(`/kitchen/supply-orders/${String(orderId)}` as never);
                }}
            >
                <Text variant="mono" tone="brand" numberOfLines={1}>
                    {orderNumber}
                </Text>
            </Pressable>
        </View>
    );
}

/** The same way to the order from a receipt's own page, or nothing where there is no way. */
export function ReceiptOpenOrder({
    orderId,
    testID,
}: {
    readonly orderId: PurchaseOrderId | null;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const router = useRouter();
    const canOpenOrder = useCan(INVENTORY_ORDER_SUPPLIES_PERMISSION);

    if (orderId === null || !canOpenOrder) return null;

    return (
        <Button
            testID={testID}
            size="sm"
            variant="secondary"
            label={t('kitchen:ops.procurement.openOrder')}
            onPress={() => {
                router.push(`/kitchen/supply-orders/${String(orderId)}` as never);
            }}
        />
    );
}

/**
 * The same way to the order, as an entry in a record pop-up's ⋯ menu — none where there is no
 * order or the reader may not open one.
 */
export function useReceiptOpenOrderActions(
    orderId: PurchaseOrderId | null,
    testID: string,
): RecordAction[] {
    const { t } = useTranslation();
    const router = useRouter();
    const canOpenOrder = useCan(INVENTORY_ORDER_SUPPLIES_PERMISSION);

    if (orderId === null || !canOpenOrder) return [];
    return [
        {
            key: 'open-order',
            label: t('kitchen:ops.procurement.openOrder'),
            icon: 'clipboardList',
            testID,
            onSelect: () => {
                router.push(`/kitchen/supply-orders/${String(orderId)}` as never);
            },
        },
    ];
}
