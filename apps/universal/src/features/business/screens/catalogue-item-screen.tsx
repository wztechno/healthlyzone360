import {
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    Inline,
    RecordSkeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { CatalogueItem, VolumeTier } from '@healthy360/api-client/contracts';
import { MealId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useCatalogueItemQuery,
    useB2bAddCatalogueItemMutation,
    B2B_CART_CHANNEL_CODE,
} from '../../../data/business-hooks.ts';
import { CatalogueList } from '../../kitchen-admin/catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../../kitchen-admin/catalogue/catalogue-column-spec.ts';
import { RecordViewPage } from '../../kitchen-admin/catalogue/record-view-page.tsx';
import { formatMoney, formatPackSize, weekdayKey } from '../../marketplace/format.ts';
import { CORPORATE_HOME_HREF, corporateCatalogueHref } from '../corporate-chrome.tsx';
import { catalogueKindKey, contractPriceTestId, salesChannelKey } from '../format.ts';

/**
 * `/corporate/items/{item}` — one negotiated line, with its volume tiers, as an admin record page
 * (`RecordViewPage`): the facts in the field grid, the tier ladder as its own card, and the buying
 * actions in the status rail. The trail names the line and its middle crumb returns to the
 * programme's catalogue.
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
 * schedule request. `catalogueScheduleRequest` in `src/features/availability.ts` records that gap and
 * no control offers it. Requesting a quotation, by contrast, is a real mutation and is offered.
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
    const failure = toFailure(query.error);

    if (query.isPending && query.fetchStatus !== 'idle') {
        return <RecordSkeleton testID="catalogue-item-loading" />;
    }

    if (failure !== null && item === undefined) {
        return (
            <ErrorState
                testID="catalogue-item-detail-error"
                title={t('business:item.notFoundTitle')}
                failure={failure}
                onRetry={() => {
                    void query.refetch();
                }}
                retrying={query.isFetching}
            />
        );
    }

    if (item === undefined) {
        return (
            <Cascade space="md" testID="catalogue-item-screen">
                <EmptyState
                    testID="catalogue-item-detail-empty"
                    title={t('business:item.notFoundTitle')}
                    body={t('business:item.notFoundBody')}
                    actions={
                        <Button
                            testID="catalogue-item-back"
                            size="sm"
                            variant="secondary"
                            label={t('business:catalogue.back')}
                            onPress={() => {
                                router.push(CORPORATE_HOME_HREF as never);
                            }}
                        />
                    }
                />
            </Cascade>
        );
    }

    const onAddToCart = (onSuccess?: () => void) => {
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

    const orderable = item.mealId !== null || item.kind === 'meal';
    const separator = t('business:common.listSeparator');

    return (
        <RecordViewPage
            testID="catalogue-item-screen"
            title={item.name}
            kind={t(catalogueKindKey(item.kind))}
            reference={item.id}
            onBack={() => {
                router.push(corporateCatalogueHref(String(item.programmeId)) as never);
            }}
            fields={[
                {
                    key: 'description',
                    label: t('business:item.fieldDescription'),
                    value: item.description,
                },
                {
                    key: 'minimum',
                    label: t('business:catalogue.columnMinimum'),
                    value: formatter.formatNumber(item.minimumOrderQuantity),
                    mono: true,
                },
                {
                    key: 'lead-time',
                    label: t('business:catalogue.columnLeadTime'),
                    value: t('business:catalogue.days', { count: item.leadTimeDays }),
                    mono: true,
                },
                {
                    key: 'weekdays',
                    label: t('business:catalogue.columnWeekdays'),
                    value:
                        item.deliveryWeekdays.length === 0
                            ? t('business:catalogue.noWeekdaysShort')
                            : item.deliveryWeekdays
                                  .map((weekday) => t(weekdayKey(weekday)))
                                  .join(separator),
                },
                {
                    key: 'recurring',
                    label: t('business:catalogue.columnRecurring'),
                    value: item.supportsRecurringOrder
                        ? t('business:catalogue.recurringShort')
                        : t('business:catalogue.oneOffShort'),
                },
            ]}
            sections={[
                {
                    key: 'tiers',
                    title: t('business:item.tiersTitle'),
                    content: <VolumeTiers item={item} t={t} formatter={formatter} />,
                },
            ]}
            chipsLabel={t('business:catalogue.columnChannels')}
            chips={item.channels.map((channel) => ({
                key: channel,
                label: t(salesChannelKey(channel)),
            }))}
            statusContent={
                <Stack space="sm">
                    <HeadlinePrice item={item} t={t} formatter={formatter} />
                    {orderable ? (
                        <Inline space="xs" wrap>
                            <Button
                                testID="catalogue-item-cart"
                                size="sm"
                                variant="secondary"
                                label={t('business:item.addToCart')}
                                loading={addToCart.isPending}
                                // Wrapped rather than passed by reference: `onPress` hands the press
                                // event to its callback, and this one's first parameter is an
                                // `onSuccess` continuation it would then try to call.
                                onPress={() => {
                                    onAddToCart();
                                }}
                            />
                            <Button
                                testID="catalogue-item-order"
                                size="sm"
                                variant="secondary"
                                label={t('business:item.placeOrder')}
                                loading={addToCart.isPending}
                                onPress={() => {
                                    onAddToCart(() => {
                                        router.push(
                                            `/customer/checkout?channel=${encodeURIComponent(B2B_CART_CHANNEL_CODE)}` as never,
                                        );
                                    });
                                }}
                            />
                        </Inline>
                    ) : null}
                </Stack>
            }
            primaryAction={{
                testID: 'catalogue-item-quote',
                label: t('business:item.quote'),
                icon: 'fileText',
                onPress: () => {
                    router.push(
                        `/corporate/quotations/new?programme=${String(item.programmeId)}&item=${item.id}` as never,
                    );
                },
            }}
        />
    );
}

interface PartProps {
    readonly item: CatalogueItem;
    readonly t: TFunction;
    readonly formatter: Formatter;
}

/** The agreed rate, in the status card above the buying actions — the figure they act on. */
function HeadlinePrice({ item, t, formatter }: PartProps) {
    if (item.contractPrice === null) {
        return (
            <Text tone="secondary" testID="catalogue-item-detail-unpriced">
                {t('business:catalogue.unpriced')}
            </Text>
        );
    }
    const price = formatMoney(formatter, item.contractPrice);
    return (
        <Stack space="xs">
            <Text variant="caption" tone="secondary">
                {t('business:catalogue.columnPrice')}
            </Text>
            <Text variant="display" testID={contractPriceTestId(`headline-${item.id}`)}>
                {item.pack === null
                    ? price
                    : t('business:catalogue.pricePerPack', {
                          price,
                          size: formatPackSize(t, formatter, item.pack),
                      })}
            </Text>
        </Stack>
    );
}

function VolumeTiers({ item, t, formatter }: PartProps) {
    const columns: readonly CatalogueColumn<VolumeTier>[] = [
        {
            key: 'range',
            role: 'title',
            label: t('business:item.tierRange'),
            width: 160,
            grow: true,
            priority: 100,
            value: (tier) =>
                tier.maximumQuantity === null
                    ? t('business:item.tierFrom', { min: tier.minimumQuantity })
                    : t('business:item.tierBetween', {
                          min: tier.minimumQuantity,
                          max: tier.maximumQuantity,
                      }),
        },
        {
            key: 'price',
            role: 'metric',
            label: t('business:item.tierPrice'),
            width: 140,
            align: 'end',
            priority: 90,
            value: (tier) => formatMoney(formatter, tier.unitPrice),
            render: (tier) => (
                <Text variant="mono" testID={contractPriceTestId(`tier-${String(tier.id)}`)}>
                    {formatMoney(formatter, tier.unitPrice)}
                </Text>
            ),
        },
        {
            key: 'lead',
            role: 'meta',
            label: t('business:item.tierLeadTime'),
            width: 110,
            align: 'end',
            priority: 80,
            value: (tier) => t('business:catalogue.days', { count: tier.leadTimeDays }),
        },
    ];

    if (item.volumeTiers.length === 0) {
        return (
            <Text tone="secondary" testID="catalogue-item-tier-table-empty">
                {t('business:item.noTiers')}
            </Text>
        );
    }

    return (
        <CatalogueList<VolumeTier>
            testID="catalogue-item-tier-table"
            label={t('business:item.tiersCaption')}
            columns={columns}
            rows={item.volumeTiers}
            rowKey={(tier) => String(tier.id)}
            density="sm"
            rowActionsLabel={t('business:catalogue.rowActions')}
            rowEntrance={false}
        />
    );
}
