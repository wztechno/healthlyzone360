import { Badge, Button, Icon, Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useReceivableOrdersQuery } from '../../data/kitchen-ops-hooks.ts';
import { withQuery } from '../../navigation/return-to.ts';
import { useAccessState } from '../../session/session-provider.tsx';

/** The list is the way in, not the backlog: the rest are on the receive page's own picker. */
const SHOWN_ORDERS = 5;

const RECEIVE_ROUTE = '/kitchen/procurement/receive';

/**
 * What the Procurement book is expecting: the branch's open orders, oldest first, each one press from
 * being received. The receipts book is the page's job, so this draws nothing at all while it loads,
 * when nothing is out, and when it fails.
 *
 * Mount it for `inventory.manage_organisation` holders only. That is the code the endpoint sits on,
 * and deliberately not the order-supplies one: whoever unloads the van rarely placed the order.
 */
export function AwaitingDeliveries() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const access = useAccessState();
    const orders = useReceivableOrdersQuery(access.branch?.id ?? null);
    const rows = orders.data ?? [];

    if (rows.length === 0) return null;

    return (
        <View
            testID="kitchen-procurement-awaiting"
            className="rounded-[22px] border border-stroke-subtle bg-surface-raised p-4"
        >
            <View className="mb-3 min-h-[34px] flex-row flex-wrap items-center gap-2.5">
                <Text
                    role="heading"
                    aria-level={2}
                    className="font-display !text-base font-bold text-content-primary"
                >
                    {t('kitchen:ops.procurement.awaitingTitle')}
                </Text>
                <Badge
                    tone="warning"
                    testID="kitchen-procurement-awaiting-count"
                    label={formatter.formatNumber(rows.length)}
                />
                {rows.length > SHOWN_ORDERS ? (
                    <View className="ms-auto">
                        <Button
                            testID="kitchen-procurement-awaiting-all"
                            size="sm"
                            variant="ghost"
                            label={t('kitchen:ops.procurement.awaitingAll', {
                                count: rows.length,
                            })}
                            iconEnd={<Icon name="chevronEnd" size="sm" />}
                            onPress={() => {
                                router.push(RECEIVE_ROUTE as never);
                            }}
                        />
                    </View>
                ) : null}
            </View>
            {/* One card per order, five across — the board's tiles. */}
            <View className="flex-row flex-wrap gap-2">
                {rows.slice(0, SHOWN_ORDERS).map((order) => {
                    const id = String(order.id);
                    return (
                        <View
                            key={id}
                            testID={`kitchen-procurement-awaiting-${id}`}
                            className="w-[19%] min-w-[180px] gap-[3px] rounded-2xl bg-surface-sunken py-3 pe-3 ps-3.5"
                        >
                            <Text className="!text-sm font-bold tabular-nums text-content-primary">
                                {order.number}
                            </Text>
                            <Text
                                numberOfLines={1}
                                className="text-[13px] font-semibold text-content-primary"
                            >
                                {order.supplier?.nameEn ?? t('kitchen:ops.procurement.noSupplier')}
                            </Text>
                            <Text
                                numberOfLines={1}
                                className="text-xs font-medium tabular-nums text-content-secondary"
                            >
                                {order.issuedAt === null
                                    ? ' '
                                    : t('kitchen:ops.procurement.awaitingIssued', {
                                          date: formatter.formatDate(order.issuedAt, {
                                              dateStyle: 'medium',
                                          }),
                                      })}
                            </Text>
                            <View className="mt-2 flex-row items-center justify-between gap-2">
                                <Text className="text-xs font-bold tabular-nums text-warning-on-subtle">
                                    {t('kitchen:ops.procurement.awaitingLines', {
                                        count: order.outstandingLineCount,
                                    })}
                                </Text>
                                <Button
                                    testID={`kitchen-procurement-awaiting-${id}-receive`}
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:ops.procurement.awaitingReceive')}
                                    onPress={() => {
                                        router.push(
                                            withQuery(RECEIVE_ROUTE, { order: id }) as never,
                                        );
                                    }}
                                />
                            </View>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}
