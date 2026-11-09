import { Button, FormSection, Text } from '@healthy360/design-system';
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

/** The rows' tracks, so the orders line up as a table. */
const ORDER_TRACK = 120;
const FACT_TRACK = 150;

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
        <FormSection
            first
            variant="panel"
            testID="kitchen-procurement-awaiting"
            title={t('kitchen:ops.procurement.awaitingTitle')}
            {...(rows.length > SHOWN_ORDERS
                ? {
                      actions: (
                          <Button
                              testID="kitchen-procurement-awaiting-all"
                              size="sm"
                              variant="ghost"
                              label={t('kitchen:ops.procurement.awaitingAll', {
                                  count: rows.length,
                              })}
                              onPress={() => {
                                  router.push(RECEIVE_ROUTE as never);
                              }}
                          />
                      ),
                  }
                : {})}
        >
            <View className="flex-col rounded-lg border border-stroke-subtle">
                {rows.slice(0, SHOWN_ORDERS).map((order, index) => {
                    const id = String(order.id);
                    return (
                        <View
                            key={id}
                            testID={`kitchen-procurement-awaiting-${id}`}
                            className={`min-h-12 flex-row flex-wrap items-center gap-x-snug px-snug py-tight ${
                                index === 0 ? '' : 'border-t border-stroke-subtle'
                            }`}
                        >
                            <View style={{ width: ORDER_TRACK }}>
                                <Text variant="mono" numberOfLines={1}>
                                    {order.number}
                                </Text>
                            </View>
                            <View className="min-w-0 flex-1">
                                <Text numberOfLines={1}>
                                    {order.supplier?.nameEn ??
                                        t('kitchen:ops.procurement.noSupplier')}
                                </Text>
                            </View>
                            <View style={{ width: FACT_TRACK }}>
                                {order.issuedAt === null ? null : (
                                    <Text tone="secondary" numberOfLines={1}>
                                        {t('kitchen:ops.procurement.awaitingIssued', {
                                            date: formatter.formatDate(order.issuedAt, {
                                                dateStyle: 'medium',
                                            }),
                                        })}
                                    </Text>
                                )}
                            </View>
                            <View style={{ width: FACT_TRACK }}>
                                <Text tone="secondary" numberOfLines={1}>
                                    {t('kitchen:ops.procurement.awaitingLines', {
                                        count: order.outstandingLineCount,
                                    })}
                                </Text>
                            </View>
                            <View className="ms-auto">
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
        </FormSection>
    );
}
