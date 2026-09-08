import type { ProductAdmin } from '@healthy360/api-client/contracts';
import { Badge, Inline, Text } from '@healthy360/design-system';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';

import {
    availableChannels,
    channelKey,
    defaultPackVariant,
    displayName,
    productRowTestId,
    statusShortKey,
    statusTone,
    unitShortKey,
} from '../format.ts';
import { CATALOGUE_PRIORITY } from './catalogue-column-spec.ts';
import type { CatalogueColumn } from './catalogue-column-spec.ts';

/**
 * Products — and, unchanged, sauces and dressings — as an array.
 *
 * The third spec file after `ingredient-columns.tsx` and `recipe-columns.tsx`, and the first one
 * that proves §4.1's claim about the fourth entity: sauces and dressings reach this list through
 * `ProductAdminFilter.itemType` and share every track below. They are the same shape asked the same
 * questions, so they get the same array rather than a copy of it with three words changed.
 *
 * ## The tracks
 *
 * | column   | track | floor | priority | note                                          |
 * | -------- | ----: | ----: | -------: | --------------------------------------------- |
 * | Product  |   260 |   150 |      100 | the title; never dropped                      |
 * | Category |   140 |   112 |       40 | secondary; hosts the category filter          |
 * | Packs    |   160 |   118 |       85 | the metric — the lead pack and how many       |
 * | Channels |   150 |   110 |       50 | secondary, comma run                          |
 * | Flags    |   132 |    96 |       30 | badges; market-priced, assorted, import notes |
 * | Status   |   110 |    78 |       80 | badge                                         |
 * | Updated  |    96 |    72 |       20 | secondary, centred, relative                  |
 *
 * The tracks and floors are the ingredient spec's, moved across a position at a time rather than
 * re-derived — a kitchen that has learnt to read one Catalogue list should not relearn the geometry
 * on the next. Where a number differs the entity is talking: Packs takes 160 rather than the
 * ingredient Unit price's 104 because it holds a label and a count, not a figure.
 *
 * ## Packs is the metric, because a product carries no price
 *
 * The ladder reserves 85 for the entity's headline number, and on the ingredient list that is the
 * unit price. `ProductAdmin` has none: a product's money lives on a price list, keyed by *pack
 * code*, and is a separate read behind a separate permission. What a product row is actually
 * scanned for after its name is which pack leads and how many there are — which is precisely the
 * pair a price entry has to point at — so that is the 85 and it is what the narrow row keeps.
 *
 * The default pack is the first, because array position is the only ordering `ProductPackVariant`
 * publishes. A product with no packs at all says so rather than rendering an empty cell: "no pack
 * recorded" is a thing to go and fix, and a blank is indistinguishable from a column that failed to
 * load.
 *
 * ## Channels is a comma run, not a row of chips
 *
 * The call `ingredient-columns.tsx` records for allergens, for the same reason: a column of coloured
 * pills repeated down twenty-five rows becomes the loudest thing on a page whose subject is the
 * name beside it. The View drawer draws the channels as badges, where there is one record and room
 * to look at it.
 *
 * ## Flags is one column, not three
 *
 * Market-priced, assorted and unresolved import findings are all the same kind of statement — a
 * caveat on how to read the rest of the row — and each is true of a handful of products. Three
 * tracks that are empty on nine rows in ten would cost the tracks that are not, so they share one
 * and the column is simply empty where a product carries no caveat. Their ids are unchanged, so
 * every suite that asserted one still finds it.
 */

export interface ProductColumnDeps {
    readonly t: TFunction;
    /** The resolved locale, as `useLocale()` reports it. */
    readonly locale: string;
    readonly formatter: Formatter;
    /**
     * Code to the name the kitchen filed it under. Injected rather than resolved here because this
     * module builds columns synchronously and the vocabulary arrives from a query — the list state
     * owns the read, this owns the rendering.
     */
    readonly categoryName: (code: string) => string;
}

export function productColumns({
    t,
    locale,
    formatter,
    categoryName,
}: ProductColumnDeps): readonly CatalogueColumn<ProductAdmin>[] {
    const dash = t('kitchen:list.noValue');

    const packLabel = (row: ProductAdmin): string => {
        const lead = defaultPackVariant(row.packVariants);
        if (lead === null) return t('kitchen:products.noPacks');
        return t('kitchen:products.packSummary', {
            pack: displayName(lead.label, locale).value,
            quantity: formatter.formatNumber(lead.netQuantity),
            unit: t(unitShortKey(lead.netUnit)),
        });
    };

    const channelLabel = (row: ProductAdmin): string => {
        const channels = availableChannels(row.channelAvailability);
        return channels.length === 0
            ? t('kitchen:products.noChannels')
            : channels.map((channel) => t(channelKey(channel))).join(', ');
    };

    return [
        {
            /*
             * The handle before the name, as the ingredient list draws it.
             *
             * `SAC-001`, `DRS-019`, `RSL-055` — the v6 sheets number every row they publish, and
             * the number is what a kitchen quotes down a phone. It leads the row because that is
             * how the column is read: a reference is looked *up*, and a reader scanning for one
             * should not have to cross a name to reach it. `null` on a row that predates the
             * series, drawn as the same dash the ingredient list uses.
             */
            key: 'reference',
            label: t('kitchen:list.columnReference'),
            width: 112,
            min: 84,
            priority: CATALOGUE_PRIORITY.reference,
            role: 'meta',
            mono: true,
            sortable: true,
            sortType: 'text',
            value: (row) => row.reference ?? dash,
            render: (row) => (
                <Text
                    testID={`${productRowTestId(String(row.id))}-reference`}
                    variant="mono"
                    tone={row.reference === null ? 'secondary' : 'primary'}
                    numberOfLines={1}
                >
                    {row.reference ?? dash}
                </Text>
            ),
        },
        {
            key: 'name',
            label: t('kitchen:products.columnName'),
            width: 260,
            min: 150,
            priority: CATALOGUE_PRIORITY.designation,
            role: 'title',
            sortable: true,
            sortType: 'text',
            value: (row) => displayName(row.name, locale).value,
            render: (row) => {
                const name = displayName(row.name, locale);
                return (
                    <Inline space="xs" align="center">
                        <Text
                            variant="label"
                            numberOfLines={1}
                            testID={`${productRowTestId(String(row.id))}-name`}
                        >
                            {name.value}
                        </Text>
                        {/*
                         * An admin record carries both languages, and the row marks the ones that
                         * fell back — a list that silently substituted English for a missing Arabic
                         * name would hide exactly the rows somebody has to fix before anything can
                         * publish. The Missing Arabic stat card counts them.
                         */}
                        {name.isFallback ? (
                            <Badge
                                testID={`${productRowTestId(String(row.id))}-missing-arabic`}
                                tone="warning"
                                icon="warning"
                                label={t('kitchen:list.missingArabic')}
                            />
                        ) : null}
                    </Inline>
                );
            },
        },
        {
            key: 'category',
            label: t('kitchen:products.columnCategory'),
            width: 140,
            min: 112,
            priority: CATALOGUE_PRIORITY.category,
            role: 'meta',
            sortable: true,
            sortType: 'text',
            value: (row) =>
                row.categoryCode.trim() === ''
                    ? t('kitchen:list.noCategory')
                    : categoryName(row.categoryCode),
            render: (row) => (
                <Text
                    testID={`${productRowTestId(String(row.id))}-category`}
                    tone="secondary"
                    numberOfLines={1}
                >
                    {row.categoryCode.trim() === ''
                        ? t('kitchen:list.noCategory')
                        : categoryName(row.categoryCode)}
                </Text>
            ),
        },
        {
            key: 'packs',
            label: t('kitchen:products.columnPacks'),
            width: 160,
            min: 118,
            priority: CATALOGUE_PRIORITY.metric,
            role: 'metric',
            value: packLabel,
            render: (row) => {
                const testID = productRowTestId(String(row.id));
                const lead = defaultPackVariant(row.packVariants);

                if (lead === null) {
                    return (
                        <Text testID={`${testID}-packs-none`} tone="secondary" numberOfLines={1}>
                            {t('kitchen:products.noPacks')}
                        </Text>
                    );
                }

                return (
                    <Inline space="xs" align="center" testID={`${testID}-packs`}>
                        <Text variant="mono" numberOfLines={1}>
                            {packLabel(row)}
                        </Text>
                        {/*
                         * The count is its own element rather than part of the sentence above: it
                         * is the half a reader is counting down the column, and it is what a price
                         * list has to have an entry for. Drawn only when there is more than one,
                         * because "1 pack in all" beside the pack itself says nothing.
                         */}
                        {row.packVariants.length > 1 ? (
                            <Text variant="caption" tone="secondary" testID={`${testID}-packs-count`}>
                                {t('kitchen:products.packCount', {
                                    count: row.packVariants.length,
                                })}
                            </Text>
                        ) : null}
                    </Inline>
                );
            },
        },
        {
            key: 'channels',
            label: t('kitchen:products.columnChannels'),
            width: 150,
            min: 110,
            priority: CATALOGUE_PRIORITY.unit,
            role: 'meta',
            value: channelLabel,
            render: (row) => {
                const testID = productRowTestId(String(row.id));
                const channels = availableChannels(row.channelAvailability);

                return channels.length === 0 ? (
                    <Text testID={`${testID}-channels-none`} tone="secondary" numberOfLines={1}>
                        {t('kitchen:products.noChannels')}
                    </Text>
                ) : (
                    <Text testID={`${testID}-channels`} tone="secondary" numberOfLines={1}>
                        {channelLabel(row)}
                    </Text>
                );
            },
        },
        {
            key: 'flags',
            label: t('kitchen:products.columnFlags'),
            width: 132,
            min: 96,
            priority: CATALOGUE_PRIORITY.allergens,
            value: (row) => {
                const notes = [
                    ...(row.isMarketPriced ? [t('kitchen:products.marketPricedShort')] : []),
                    ...(row.isAssorted ? [t('kitchen:products.assortedShort')] : []),
                    ...(row.dataQualityFlags.length === 0
                        ? []
                        : [
                              t('kitchen:products.dataQualityCount', {
                                  count: row.dataQualityFlags.length,
                              }),
                          ]),
                ];
                return notes.length === 0 ? dash : notes.join(', ');
            },
            render: (row) => {
                const testID = productRowTestId(String(row.id));
                const empty =
                    !row.isMarketPriced && !row.isAssorted && row.dataQualityFlags.length === 0;

                if (empty) {
                    return (
                        <Text tone="secondary" numberOfLines={1}>
                            {dash}
                        </Text>
                    );
                }

                return (
                    <Inline space="xs" align="center">
                        {row.isMarketPriced ? (
                            <Badge
                                testID={`${testID}-market-priced`}
                                tone="warning"
                                label={t('kitchen:products.marketPricedShort')}
                            />
                        ) : null}
                        {row.isAssorted ? (
                            <Badge
                                testID={`${testID}-assorted`}
                                tone="neutral"
                                label={t('kitchen:products.assortedShort')}
                            />
                        ) : null}
                        {row.dataQualityFlags.length === 0 ? null : (
                            <Badge
                                testID={`${testID}-data-quality`}
                                tone="warning"
                                icon="warning"
                                label={String(row.dataQualityFlags.length)}
                            />
                        )}
                    </Inline>
                );
            },
        },
        {
            key: 'status',
            label: t('kitchen:list.columnStatus'),
            width: 110,
            min: 78,
            priority: CATALOGUE_PRIORITY.status,
            role: 'status',
            badge: true,
            sortable: true,
            sortType: 'text',
            value: (row) => t(statusShortKey(row.meta.status)),
            render: (row) => (
                <Badge
                    testID={`${productRowTestId(String(row.id))}-status`}
                    tone={statusTone(row.meta.status)}
                    label={t(statusShortKey(row.meta.status))}
                />
            ),
        },
        {
            key: 'updatedAt',
            label: t('kitchen:catalogue.columnUpdated'),
            width: 96,
            min: 72,
            priority: CATALOGUE_PRIORITY.updated,
            align: 'center',
            sortable: true,
            sortType: 'text',
            value: (row) => formatter.formatRelativeTime(row.meta.updatedAt),
            render: (row) => (
                <Text
                    testID={`${productRowTestId(String(row.id))}-updated`}
                    variant="caption"
                    tone="secondary"
                    align="center"
                    numberOfLines={1}
                >
                    {formatter.formatRelativeTime(row.meta.updatedAt)}
                </Text>
            ),
        },
    ];
}
