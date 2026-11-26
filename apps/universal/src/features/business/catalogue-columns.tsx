import { Badge, DATA_TABLE_PRIORITY, Text } from '@healthy360/design-system';
import type { BadgeTone, DataTableColumn } from '@healthy360/design-system';
import type { CatalogueItem, CatalogueItemKind } from '@healthy360/api-client/contracts';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { View } from 'react-native';

import { compareNumber, compareText } from '../kitchen-admin/catalogue/use-column-controls.tsx';
import type { ControlledColumn } from '../kitchen-admin/catalogue/use-column-controls.tsx';
import { EntityImage } from '../../media/entity-image.tsx';
import { formatMoney, formatPackSize } from '../marketplace/format.ts';
import { catalogueKindKey, contractPriceTestId } from './format.ts';

/**
 * The negotiated catalogue as an admin table, from the corporate canvas's Catalogue board
 * (2026-11-10): Item (its photo and name), Kind, Pack and Contract price, with the description
 * behind Show columns. Every column is left-aligned, as every kitchen table is.
 *
 * The board draws a shelf under each name and a minimum order; the API sends neither, so neither
 * is drawn.
 *
 * ## The price cell is where the privacy marker lives
 *
 * `contractPriceTestId(item.id)` is rendered by the price column, so the marker is on every row the
 * table draws. A row whose price column the reader has hidden carries no marker — correctly, since
 * it shows no price.
 */

/** The canvas's tones for a line's kind: meals green, bulk packages blue, plans grey. */
export const KIND_TONE: Readonly<Record<CatalogueItemKind, BadgeTone>> = {
    meal: 'success',
    bulk_package: 'info',
    meal_plan: 'neutral',
};

/** The pack a contract price buys — "1 Kg" — or `null` when the price is for the item itself. */
export function packText(t: TFunction, formatter: Formatter, item: CatalogueItem): string | null {
    return item.pack === null ? null : formatPackSize(t, formatter, item.pack);
}

export function catalogueColumns(
    t: TFunction,
    formatter: Formatter,
): readonly ControlledColumn<CatalogueItem, DataTableColumn<CatalogueItem>>[] {
    const priceText = (item: CatalogueItem): string => {
        if (item.contractPrice === null) return t('business:catalogue.unpricedShort');
        const price = formatMoney(formatter, item.contractPrice);
        const pack = packText(t, formatter, item);
        return pack === null ? price : t('business:catalogue.pricePerPack', { price, size: pack });
    };

    return [
        {
            key: 'name',
            role: 'title',
            label: t('business:catalogue.columnItem'),
            width: 260,
            min: 180,
            grow: true,
            priority: DATA_TABLE_PRIORITY.designation,
            value: (item) => item.name,
            sort: (left, right, direction) => compareText(left.name, right.name, direction),
            // The board's 30px rounded-square photo (`.lth`), not the list's 20px avatar.
            render: (item) => (
                <View className="min-w-0 flex-row items-center gap-2">
                    <View className="h-[30px] w-[30px] shrink-0 overflow-hidden rounded-[9px]">
                        <EntityImage
                            assetId={
                                item.imagePlaceholderId === '' ? undefined : item.imagePlaceholderId
                            }
                            seed={item.id}
                            label={item.name}
                            aspect="square"
                            decorative
                            flush
                        />
                    </View>
                    <Text
                        variant="bodyStrong"
                        numberOfLines={1}
                        className="min-w-0 shrink"
                        testID={`catalogue-item-${item.id}-name`}
                    >
                        {item.name}
                    </Text>
                </View>
            ),
        },
        {
            key: 'kind',
            role: 'status',
            label: t('business:catalogue.kindLabel'),
            width: 150,
            priority: DATA_TABLE_PRIORITY.status,
            value: (item) => t(catalogueKindKey(item.kind)),
            sort: (left, right, direction) =>
                compareText(
                    t(catalogueKindKey(left.kind)),
                    t(catalogueKindKey(right.kind)),
                    direction,
                ),
            render: (item) => (
                <Badge
                    testID={`catalogue-item-${item.id}-kind`}
                    tone={KIND_TONE[item.kind]}
                    label={t(catalogueKindKey(item.kind))}
                />
            ),
        },
        {
            key: 'pack',
            role: 'meta',
            label: t('business:catalogue.columnPack'),
            width: 90,
            priority: DATA_TABLE_PRIORITY.unit,
            sort: false,
            value: (item) => packText(t, formatter, item) ?? '—',
            render: (item) => (
                <Text tone="secondary" testID={`catalogue-item-${item.id}-pack`}>
                    {packText(t, formatter, item) ?? '—'}
                </Text>
            ),
        },
        {
            key: 'price',
            role: 'metric',
            label: t('business:catalogue.columnPrice'),
            width: 170,
            priority: DATA_TABLE_PRIORITY.metric,
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
            render: (item) => {
                if (item.contractPrice === null) {
                    return (
                        <Text tone="secondary" testID={`catalogue-item-${item.id}-unpriced`}>
                            {priceText(item)}
                        </Text>
                    );
                }
                const pack = packText(t, formatter, item);
                return (
                    <View className="flex-row items-baseline gap-1">
                        <Text
                            variant="bodyStrong"
                            className="tabular-nums"
                            testID={contractPriceTestId(item.id)}
                        >
                            {formatMoney(formatter, item.contractPrice)}
                        </Text>
                        {pack === null ? null : (
                            <Text tone="secondary">
                                {t('business:catalogue.perPack', { size: pack })}
                            </Text>
                        )}
                    </View>
                );
            },
        },
        {
            key: 'description',
            role: 'meta',
            label: t('business:item.fieldDescription'),
            width: 260,
            priority: DATA_TABLE_PRIORITY.category,
            sort: false,
            value: (item) => item.description,
            render: (item) => (
                <Text tone="secondary" numberOfLines={1}>
                    {item.description === '' ? '—' : item.description}
                </Text>
            ),
        },
    ];
}
