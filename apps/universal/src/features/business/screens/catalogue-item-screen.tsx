import {
    Badge,
    Button,
    Callout,
    Heading,
    Inline,
    Stack,
    Table,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import type { VolumeTier } from '@healthy360/api-client/contracts';
import { MealId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
    useCatalogueItemQuery,
    useB2bAddCatalogueItemMutation,
    B2B_CART_CHANNEL_CODE,
} from '../../../data/business-hooks.ts';
import { PrototypeButton } from '../../../prototype/index.ts';
import { formatMoney, weekdayKey } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { catalogueKindKey, contractPriceTestId, salesChannelKey } from '../format.ts';

/**
 * `/corporate/items/{item}` — one negotiated line, with its volume tiers.
 *
 * ## The tiers are the point of the screen
 *
 * A contract price on its own is a headline; what a buyer plans against is the *ladder* — how much
 * cheaper 250 units are than 40, and how many more days the cheaper rate takes to deliver. Both
 * facts are on `VolumeTier` and both are shown together, because a rate quoted without its lead time
 * is half an answer.
 *
 * Every price on this screen — the headline and every tier — carries the `contract-price-` marker
 * (`../format.ts`), which the privacy sweep asserts appears on no consumer route.
 *
 * ## Recurring ordering is a genuine gap
 *
 * `CatalogueItem.supportsRecurringOrder` says a line *may* be ordered on a standing schedule, and
 * `BusinessRepository` publishes nothing that would set one up — no recurring-order resource, no
 * schedule request. So that control is a `PrototypeButton` naming the endpoint it is waiting on,
 * which is what `usePrototypeAction` is actually for. Requesting a quotation, by contrast, is a real
 * mutation and is not routed through it.
 */

export interface CatalogueItemScreenProps {
    readonly itemId: string | undefined;
}

export function CatalogueItemScreen({ itemId }: CatalogueItemScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const toast = useToast();

    const query = useCatalogueItemQuery(itemId ?? null);
    const item = query.data;
    const addToCart = useB2bAddCatalogueItemMutation();

    const onAddToCart = (onSuccess?: () => void) => {
        if (item === undefined) return;
        const mealId = item.mealId ?? MealId.unsafe(item.id);
        addToCart.mutate(
            { mealId, quantity: item.minimumOrderQuantity },
            {
                onSuccess: (cart) => {
                    toast.show({
                        testID: 'catalogue-item-added',
                        tone: 'success',
                        message: t('business:item.addedToCart', { items: cart.itemCount }),
                    });
                    onSuccess?.();
                },
            },
        );
    };

    const onPlaceOrder = () => {
        onAddToCart(() => {
            router.push(
                `/customer/checkout?channel=${encodeURIComponent(B2B_CART_CHANNEL_CODE)}` as never,
            );
        });
    };

    const tierColumns: readonly TableColumn<VolumeTier>[] = [
        {
            key: 'range',
            header: t('business:item.tierRange'),
            rowHeader: true,
            render: (tier) => (
                <Text>
                    {tier.maximumQuantity === null
                        ? t('business:item.tierFrom', { min: tier.minimumQuantity })
                        : t('business:item.tierBetween', {
                              min: tier.minimumQuantity,
                              max: tier.maximumQuantity,
                          })}
                </Text>
            ),
        },
        {
            key: 'price',
            header: t('business:item.tierPrice'),
            render: (tier) => (
                <Text testID={contractPriceTestId(`tier-${String(tier.id)}`)}>
                    {formatMoney(formatter, tier.unitPrice)}
                </Text>
            ),
        },
        {
            key: 'lead',
            header: t('business:item.tierLeadTime'),
            render: (tier) => (
                <Text>{t('business:catalogue.leadTime', { count: tier.leadTimeDays })}</Text>
            ),
        },
    ];

    const backAction = (
        <Button
            testID="catalogue-item-back"
            variant="quiet"
            label={t('business:item.back')}
            onPress={() => {
                if (item === undefined) {
                    router.push('/corporate' as never);
                    return;
                }
                router.push(`/corporate/catalogue/${String(item.programmeId)}` as never);
            }}
        />
    );

    return (
        <Stack space="lg" testID="catalogue-item-screen">
            <QueryStates
                query={query}
                isEmpty={item === undefined}
                emptyTitle={t('business:item.notFoundTitle')}
                emptyBody={t('business:item.notFoundBody')}
                emptyActions={backAction}
                skeletonCount={2}
                testID="catalogue-item-detail"
            >
                {item === undefined ? null : (
                    <Stack space="lg">
                        <Stack space="xs">
                            <Inline space="sm" align="center" justify="between">
                                <Heading level={1} testID="catalogue-item-name">
                                    {item.name}
                                </Heading>
                                <Badge
                                    testID="catalogue-item-detail-kind"
                                    tone="info"
                                    icon="info"
                                    label={t(catalogueKindKey(item.kind))}
                                />
                            </Inline>
                            <Text tone="secondary">{item.description}</Text>
                        </Stack>

                        {item.contractPrice === null ? (
                            <Text testID="catalogue-item-detail-unpriced">
                                {t('business:catalogue.unpriced')}
                            </Text>
                        ) : (
                            <Text testID={contractPriceTestId(`headline-${item.id}`)}>
                                {t('business:catalogue.contractPrice', {
                                    price: formatMoney(formatter, item.contractPrice),
                                })}
                            </Text>
                        )}

                        <Stack space="xs">
                            <Text testID="catalogue-item-detail-minimum">
                                {t('business:catalogue.minimum', {
                                    count: item.minimumOrderQuantity,
                                })}
                            </Text>
                            <Text testID="catalogue-item-detail-lead-time">
                                {t('business:catalogue.leadTime', { count: item.leadTimeDays })}
                            </Text>
                            <Text testID="catalogue-item-detail-weekdays">
                                {item.deliveryWeekdays.length === 0
                                    ? t('business:catalogue.noWeekdays')
                                    : t('business:catalogue.weekdays', {
                                          days: item.deliveryWeekdays
                                              .map((weekday) => t(weekdayKey(weekday)))
                                              .join(t('business:common.listSeparator')),
                                      })}
                            </Text>
                        </Stack>

                        <Inline space="xs" wrap testID="catalogue-item-detail-channels">
                            {item.channels.map((channel) => (
                                <Badge
                                    key={channel}
                                    tone="neutral"
                                    icon="dot"
                                    label={t(salesChannelKey(channel))}
                                />
                            ))}
                        </Inline>

                        <Stack space="sm" testID="catalogue-item-tiers">
                            <Text variant="label">{t('business:item.tiersTitle')}</Text>
                            <Table
                                testID="catalogue-item-tier-table"
                                caption={t('business:item.tiersCaption')}
                                columns={tierColumns}
                                rows={[...item.volumeTiers]}
                                rowKey={(tier) => String(tier.id)}
                                emptyLabel={t('business:item.noTiers')}
                            />
                            <Text
                                tone="secondary"
                                variant="caption"
                                testID="catalogue-item-tier-note"
                            >
                                {t('business:item.tiersNote')}
                            </Text>
                        </Stack>

                        <Callout
                            testID="catalogue-item-eligibility"
                            role="note"
                            tone="info"
                            icon="info"
                            title={t('business:item.eligibilityTitle')}
                            body={t('business:item.eligibilityBody')}
                        />

                        <Inline space="sm" wrap>
                            {backAction}
                            {item.mealId !== null || item.kind === 'meal' ? (
                                <>
                                    <Button
                                        testID="catalogue-item-cart"
                                        label={t('business:item.addToCart')}
                                        loading={addToCart.isPending}
                                        // Wrapped rather than passed by reference: `onPress` hands
                                        // the press event to its callback, and this one's first
                                        // parameter is an `onSuccess` continuation it would then
                                        // try to call.
                                        onPress={() => {
                                            onAddToCart();
                                        }}
                                    />
                                    <Button
                                        testID="catalogue-item-order"
                                        variant="secondary"
                                        label={t('business:item.placeOrder')}
                                        loading={addToCart.isPending}
                                        onPress={onPlaceOrder}
                                    />
                                </>
                            ) : null}
                            <Button
                                testID="catalogue-item-quote"
                                label={t('business:item.quote')}
                                onPress={() => {
                                    router.push(
                                        `/corporate/quotations/new?programme=${String(item.programmeId)}&item=${item.id}` as never,
                                    );
                                }}
                            />
                            {item.supportsRecurringOrder ? (
                                <PrototypeButton
                                    label={t('business:item.recurringOrder')}
                                    contract="POST /api/v1/business/recurring-orders"
                                />
                            ) : null}
                        </Inline>
                    </Stack>
                )}
            </QueryStates>
        </Stack>
    );
}
