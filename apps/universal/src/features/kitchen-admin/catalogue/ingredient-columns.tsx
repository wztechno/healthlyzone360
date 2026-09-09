import type { IngredientAdmin } from '@healthy360/api-client/contracts';
import { Badge, Inline, Text } from '@healthy360/design-system';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';

import {
    displayName,
    ingredientRowTestId,
    statusShortKey,
    statusTone,
    unitShortKey,
} from '../format.ts';
import { CATALOGUE_PRIORITY } from './catalogue-column-spec.ts';
import type { CatalogueColumn } from './catalogue-column-spec.ts';

/**
 * Ingredients, as an array — the eight tracks `Catalogue.dc.html` draws.
 *
 * This file *is* the ingredient list. The screen beside it holds the shell parts in order and knows
 * nothing about references, units, prices or Arabic names; everything entity-specific is here,
 * which is the claim §4.1 makes and the reason Sauces is expected to be a file like this one and no
 * screen at all. The ninth track — the `⋯` overflow — belongs to `CatalogueList` and is appended
 * there, so three specs cannot disagree about the one control that must always be reachable.
 *
 * ## The tracks, and where the numbers come from
 *
 * | column     | track | floor | priority | note                                  |
 * | ---------- | ----: | ----: | -------: | ------------------------------------- |
 * | Ref.       |   112 |    84 |       88 | mono                                  |
 * | Designation|   260 |   150 |      100 | the title; never dropped              |
 * | Category   |   140 |   120 |       40 | secondary                             |
 * | Unit       |    72 |    56 |       50 | secondary, abbreviated                |
 * | Unit price |   104 |    84 |       75 | mono, centred, 2 dp                   |
 * | Allergens  |   160 |   132 |       30 | secondary, comma run                  |
 * | Status     |   110 |    78 |       80 | badge                                 |
 * | Updated    |    96 |    72 |       20 | secondary, centred, relative          |
 *
 * `width` is the track a column gets when it is drawn; `min` is what it is charged while the fitter
 * decides. The design's own `min` values come across unchanged — they are the measured floors its
 * column-fitting logic runs on — while the tracks are a little wider than the mock's, because the
 * mock spends a CSS `1fr` on Designation and `DataList` resolves to fixed numbers on both
 * platforms. Widening the fixed tracks is how the same row fills a desk-width port without a
 * fractional track, and the floors are what keep the fitting decision identical to the design's.
 *
 * ## Why the reference leads
 *
 * A kitchen says "IG-044", not "the olive oil one" — the code is how a row is named out loud, on a
 * printed pick list and in a supplier's email, and putting it first is what lets the eye run down
 * one column instead of reading every name. It renders a dash rather than collapsing when a record
 * has none: an absent reference is a fact about that row, and a column that vanished when some rows
 * lacked a code would move every other column sideways depending on the page.
 *
 * ## The name column is where the bilingual rule shows up
 *
 * An admin record carries both languages. The row renders the reader's own language and marks the
 * ones that fell back, because a list that silently substituted English for a missing Arabic name
 * would hide exactly the rows somebody has to go and fix before anything can publish. The design's
 * sample data has no such rows so it draws no marker; the Missing Arabic stat card above the list
 * counts them, and a count with nothing to point at is a count nobody can act on.
 *
 * ## Unit price carries no currency mark, deliberately
 *
 * The design draws `3.50`, not `AED 3.50`, and an 84px floor is the reason: a currency-formatted
 * figure does not fit one, and a column of repeated currency marks says nothing a column header
 * cannot say once. The figure is the kitchen's own purchase currency, which is constant down the
 * page. The full amount is still what the row's editor shows.
 */

export interface IngredientColumnDeps {
    readonly t: TFunction;
    /** The resolved locale, as `useLocale()` reports it. */
    readonly locale: string;
    readonly formatter: Formatter;
    /**
     * Code to the catalogue's own name, both levels. Injected rather than resolved here because
     * this module builds columns synchronously and the tree arrives from a query — the screen owns
     * the read, this owns the rendering.
     */
    readonly categoryName: (code: string) => string;
}

/** Prices render at exactly two decimals, which is the design's `fmt: 2`. */
const PRICE_DIGITS: Intl.NumberFormatOptions = {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
};

export function ingredientColumns({
    t,
    locale,
    formatter,
    categoryName,
}: IngredientColumnDeps): readonly CatalogueColumn<IngredientAdmin>[] {
    const allergenLabel = (row: IngredientAdmin): string =>
        row.allergens.length === 0
            ? t('kitchen:list.noAllergens')
            : row.allergens.map((mapping) => mapping.allergenCode).join(', ');

    const unitPriceLabel = (row: IngredientAdmin): string =>
        row.unitPrice === null
            ? t('kitchen:list.noValue')
            : formatter.formatNumber(row.unitPrice.amount, PRICE_DIGITS);

    return [
        {
            key: 'reference',
            label: t('kitchen:list.columnReference'),
            width: 112,
            min: 84,
            priority: CATALOGUE_PRIORITY.reference,
            role: 'meta',
            mono: true,
            sortable: true,
            sortType: 'text',
            value: (row) => row.reference ?? t('kitchen:list.noValue'),
            render: (row) => (
                <Text
                    testID={`${ingredientRowTestId(row.id)}-reference`}
                    variant="mono"
                    tone={row.reference === null ? 'secondary' : 'primary'}
                    numberOfLines={1}
                >
                    {row.reference ?? t('kitchen:list.noValue')}
                </Text>
            ),
        },
        {
            key: 'name',
            label: t('kitchen:list.columnName'),
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
                            testID={`${ingredientRowTestId(row.id)}-name`}
                        >
                            {name.value}
                        </Text>
                        {name.isFallback ? (
                            <Badge
                                testID={`${ingredientRowTestId(row.id)}-missing-arabic`}
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
            label: t('kitchen:list.columnCategory'),
            width: 140,
            min: 120,
            priority: CATALOGUE_PRIORITY.category,
            role: 'meta',
            sortable: true,
            sortType: 'text',
            value: (row) =>
                row.categoryCode === ''
                    ? t('kitchen:list.noCategory')
                    : categoryName(row.categoryCode),
            render: (row) => (
                <Text
                    testID={`${ingredientRowTestId(row.id)}-category`}
                    tone="secondary"
                    numberOfLines={1}
                >
                    {row.categoryCode === ''
                        ? t('kitchen:list.noCategory')
                        : categoryName(row.categoryCode)}
                </Text>
            ),
        },
        {
            key: 'unit',
            label: t('kitchen:list.columnUnit'),
            width: 72,
            min: 56,
            priority: CATALOGUE_PRIORITY.unit,
            role: 'meta',
            sortable: true,
            sortType: 'text',
            // The abbreviation, not the picker's "Kilograms (kg)" — see `unitShortKey`.
            value: (row) => t(unitShortKey(row.measurementUnit)),
            render: (row) => (
                <Text
                    testID={`${ingredientRowTestId(row.id)}-unit`}
                    tone="secondary"
                    numberOfLines={1}
                >
                    {t(unitShortKey(row.measurementUnit))}
                </Text>
            ),
        },
        {
            key: 'unitPrice',
            label: t('kitchen:list.columnUnitPrice'),
            width: 104,
            min: 84,
            priority: CATALOGUE_PRIORITY.unitPrice,
            // The ingredient list's headline number: no cost per kg and no yield on this entity, so
            // the price a kitchen buys at is what a row is scanned for after its name.
            role: 'metric',
            align: 'center',
            mono: true,
            sortable: true,
            sortType: 'number',
            value: unitPriceLabel,
            render: (row) => (
                <Text
                    testID={`${ingredientRowTestId(row.id)}-unit-price`}
                    variant="mono"
                    tone={row.unitPrice === null ? 'secondary' : 'primary'}
                    numberOfLines={1}
                >
                    {unitPriceLabel(row)}
                </Text>
            ),
        },
        {
            key: 'allergens',
            label: t('kitchen:list.columnAllergens'),
            width: 160,
            min: 132,
            priority: CATALOGUE_PRIORITY.allergens,
            role: 'meta',
            // A comma run, not a row of chips. The design draws `Egg, Mustard` in secondary ink and
            // it is the right call at this density: eight rows of coloured pills turn the one
            // column that is usually empty into the loudest thing on the page, and the badge's
            // tone was carrying a distinction (contains versus may-contain) that no reader can
            // decode from colour alone anyway. The row's editor states it in words.
            value: allergenLabel,
            render: (row) => {
                const testID = ingredientRowTestId(row.id);
                return (
                    <Text
                        // Two ids, the same pair `recipe-columns.tsx` draws: "this ingredient
                        // declares none" and "this ingredient declares Egg, Mustard" are different
                        // answers, and a suite has to tell them apart without reading the copy. The
                        // distinction only became worth drawing once the list carried the mappings
                        // at all — while it did not, every row was the empty case and the marker
                        // would have been a lie on all of them.
                        testID={
                            row.allergens.length === 0
                                ? `${testID}-allergens-none`
                                : `${testID}-allergens`
                        }
                        tone="secondary"
                        numberOfLines={1}
                    >
                        {allergenLabel(row)}
                    </Text>
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
                // `Badge` with `statusTone`, not `StatusBadge`: the design system's `RecordStatus`
                // vocabulary (draft/review/live/archived/restricted) is not the API's
                // `PublishableStatus` (draft/review_required/published/retired), and mapping one
                // onto the other is a decision for `format.ts`, which already made it.
                <Badge
                    testID={`${ingredientRowTestId(row.id)}-status`}
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
            // One line, relative — "2 d". The author's name went with the second line: it is a
            // fact about a record, not about a list, and a 72px floor cannot hold "by Farah
            // Haddad" without either truncating a person's name or doubling the row's height.
            // The editor and the View drawer both still show it.
            value: (row) => formatter.formatRelativeTime(row.meta.updatedAt),
            render: (row) => (
                <Text
                    testID={`${ingredientRowTestId(row.id)}-updated`}
                    tone="secondary"
                    numberOfLines={1}
                >
                    {formatter.formatRelativeTime(row.meta.updatedAt)}
                </Text>
            ),
        },
    ];
}
