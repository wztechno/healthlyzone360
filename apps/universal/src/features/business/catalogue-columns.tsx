import { Badge, Text } from '@healthy360/design-system';
import type { CatalogueItem } from '@healthy360/api-client/contracts';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';

import type { CatalogueColumn } from '../kitchen-admin/catalogue/catalogue-column-spec.ts';
import { CATALOGUE_PRIORITY } from '../kitchen-admin/catalogue/catalogue-column-spec.ts';
import { compareNumber, compareText } from '../kitchen-admin/catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../kitchen-admin/catalogue/use-column-controls.tsx';
import { formatMoney, formatPackSize, weekdayKey } from '../marketplace/format.ts';
import { catalogueKindKey, contractPriceTestId, salesChannelKey } from './format.ts';

/**
 * The negotiated catalogue as an admin table — the column spec `CatalogueList` draws, in the shape
 * the kitchen's entity specs take (`kitchen-admin/catalogue/catalogue-column-spec.ts`).
 *
 * ## The price cell is where the privacy marker lives
 *
 * `contractPriceTestId(item.id)` is rendered by the price column, so the marker is on every row the
 * table draws. A row whose price column the reader has hidden carries no marker — correctly, since
 * it shows no price.
 */
export function catalogueColumns(
    t: TFunction,
    formatter: Formatter,
): readonly ControlledColumn<CatalogueItem, CatalogueColumn<CatalogueItem>>[] {
    const separator = t('business:common.listSeparator');
    const priceText = (item: CatalogueItem): string => {
        if (item.contractPrice === null) return t('business:catalogue.unpricedShort');
        const price = formatMoney(formatter, item.contractPrice);
        return item.pack === null
            ? price
            : t('business:catalogue.pricePerPack', {
                  price,
                  size: formatPackSize(t, formatter, item.pack),
              });
    };
    const weekdaysText = (item: CatalogueItem): string =>
        item.deliveryWeekdays.length === 0
            ? t('business:catalogue.noWeekdaysShort')
            : item.deliveryWeekdays.map((weekday) => t(weekdayKey(weekday))).join(separator);

    return [
        {
            key: 'name',
            role: 'title',
            label: t('business:catalogue.columnItem'),
            width: 240,
            min: 160,
            grow: true,
            priority: CATALOGUE_PRIORITY.designation,
            value: (item) => item.name,
            sort: (left, right, direction) => compareText(left.name, right.name, direction),
            render: (item) => (
                <Text
                    variant="bodyStrong"
                    numberOfLines={1}
                    testID={`catalogue-item-${item.id}-name`}
                >
                    {item.name}
                </Text>
            ),
        },
        {
            key: 'kind',
            role: 'status',
            label: t('business:catalogue.kindLabel'),
            width: 120,
            priority: CATALOGUE_PRIORITY.status,
            value: (item) => t(catalogueKindKey(item.kind)),
            render: (item) => (
                <Badge
                    testID={`catalogue-item-${item.id}-kind`}
                    tone="info"
                    icon={null}
                    label={t(catalogueKindKey(item.kind))}
                />
            ),
        },
        {
            key: 'price',
            role: 'metric',
            label: t('business:catalogue.columnPrice'),
            width: 170,
            align: 'end',
            priority: CATALOGUE_PRIORITY.metric,
            value: priceText,
            // Unpriced last both ways. Across currencies the order is by minor units within each
            // currency's code, never by a converted figure — there is no rate to convert with.
            sort: (left, right, direction) => {
                const a = left.contractPrice;
                const b = right.contractPrice;
                if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
                if (a.currency !== b.currency)
                    return compareText(a.currency, b.currency, direction);
                return compareNumber(a.amount, b.amount, direction);
            },
            render: (item) =>
                item.contractPrice === null ? (
                    <Text tone="secondary" testID={`catalogue-item-${item.id}-unpriced`}>
                        {priceText(item)}
                    </Text>
                ) : (
                    <Text variant="mono" testID={contractPriceTestId(item.id)}>
                        {priceText(item)}
                    </Text>
                ),
        },
        {
            key: 'minimum',
            role: 'meta',
            label: t('business:catalogue.columnMinimum'),
            width: 90,
            align: 'end',
            priority: CATALOGUE_PRIORITY.unitPrice,
            value: (item) => formatter.formatNumber(item.minimumOrderQuantity),
            sort: (left, right, direction) =>
                compareNumber(left.minimumOrderQuantity, right.minimumOrderQuantity, direction),
            render: (item) => (
                <Text variant="mono" testID={`catalogue-item-${item.id}-minimum`}>
                    {formatter.formatNumber(item.minimumOrderQuantity)}
                </Text>
            ),
        },
        {
            key: 'lead-time',
            role: 'meta',
            label: t('business:catalogue.columnLeadTime'),
            width: 100,
            align: 'end',
            priority: CATALOGUE_PRIORITY.unit,
            value: (item) => t('business:catalogue.days', { count: item.leadTimeDays }),
            sort: (left, right, direction) =>
                compareNumber(left.leadTimeDays, right.leadTimeDays, direction),
            render: (item) => (
                <Text variant="mono" testID={`catalogue-item-${item.id}-lead-time`}>
                    {t('business:catalogue.days', { count: item.leadTimeDays })}
                </Text>
            ),
        },
        {
            key: 'weekdays',
            role: 'meta',
            label: t('business:catalogue.columnWeekdays'),
            width: 180,
            priority: CATALOGUE_PRIORITY.category,
            value: weekdaysText,
            sort: false,
            render: (item) => (
                <Text
                    tone="secondary"
                    numberOfLines={1}
                    testID={`catalogue-item-${item.id}-weekdays`}
                >
                    {weekdaysText(item)}
                </Text>
            ),
        },
        {
            key: 'channels',
            role: 'meta',
            label: t('business:catalogue.columnChannels'),
            width: 180,
            priority: CATALOGUE_PRIORITY.allergens,
            value: (item) =>
                item.channels.map((channel) => t(salesChannelKey(channel))).join(separator),
            sort: false,
            // The channels the loaded lines actually carry: offering one no line is sold through
            // would be a choice that can only ever empty the table.
            filter: {
                values: (rows) =>
                    [...new Set(rows.flatMap((item) => item.channels))].map((channel) => ({
                        key: channel,
                        label: t(salesChannelKey(channel)),
                    })),
                match: (item, value) => item.channels.some((channel) => channel === value),
            },
            render: (item) => (
                <Text
                    tone="secondary"
                    numberOfLines={1}
                    testID={`catalogue-item-${item.id}-channels`}
                >
                    {item.channels.map((channel) => t(salesChannelKey(channel))).join(separator)}
                </Text>
            ),
        },
        {
            key: 'recurring',
            role: 'meta',
            label: t('business:catalogue.columnRecurring'),
            width: 110,
            priority: CATALOGUE_PRIORITY.updated,
            value: (item) =>
                item.supportsRecurringOrder
                    ? t('business:catalogue.recurringShort')
                    : t('business:catalogue.oneOffShort'),
            filter: {
                values: () => [
                    { key: 'yes', label: t('business:catalogue.recurringShort') },
                    { key: 'no', label: t('business:catalogue.oneOffShort') },
                ],
                match: (item, value) => item.supportsRecurringOrder === (value === 'yes'),
            },
            render: (item) =>
                item.supportsRecurringOrder ? (
                    <Badge
                        testID={`catalogue-item-${item.id}-recurring`}
                        tone="success"
                        icon="check"
                        label={t('business:catalogue.recurringShort')}
                    />
                ) : (
                    <Text tone="secondary">{t('business:catalogue.oneOffShort')}</Text>
                ),
        },
    ];
}
