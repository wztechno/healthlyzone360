import type { IngredientAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import { Badge, Text } from '@healthy360/design-system';
import type { BadgeTone } from '@healthy360/design-system';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';

import { displayName, statusShortKey, statusTone, unitShortKey } from '../format.ts';
import { CATALOGUE_PRIORITY } from './catalogue-column-spec.ts';
import type { CatalogueColumn } from './catalogue-column-spec.ts';

/**
 * The columns of `/kitchen/packaging`.
 *
 * Written against `IngredientAdmin`, because packaging *is* an ingredient — one filed under the
 * `packaging-disposables` branch. The row shape is shared; the questions are not, which is why this
 * spec exists beside `ingredient-columns.tsx` rather than being folded into it. Three of these
 * columns — **pack price**, **capacity** and **waste** — are null on every food row, and the price
 * is denominated per *purchase pack* rather than per issued unit. A single spec would have had to
 * draw eight empty tracks on three hundred rows to carry them.
 */

/** The row's own test id, kept distinct so the two lists' rows never collide in a suite. */
export function packagingRowTestId(id: IngredientAdmin['id']): string {
    return `kitchen-packaging-row-${String(id)}`;
}

/*
 * Status is the ingredient vocabulary now, and these two are thin aliases over the shared helpers.
 *
 * `PackagingStatus` was active / inactive / archived and turned out to be the same three states the
 * ingredient table already stored — the column's CHECK constraint had carried exactly that set all
 * along. Two enums for one vocabulary is drift waiting to happen, so the enum went and the names
 * stayed: every call site here reads the same way, and the mapping is stated once.
 */
export function packagingStatusTone(status: PublishableStatus): BadgeTone {
    return statusTone(status);
}

export function packagingStatusKey(status: PublishableStatus): string {
    return statusShortKey(status);
}

export interface PackagingColumnDeps {
    readonly t: TFunction;
    readonly locale: string;
    readonly formatter: Formatter;
    /**
     * Code → the taxonomy's own name for it.
     *
     * Injected rather than resolved here, exactly as `ingredientColumns` does it: this module
     * builds columns synchronously and the tree arrives from a query, so the screen owns the read
     * and this owns the rendering. The wire carries the pair of ids, never a resolved name.
     */
    readonly categoryName: (code: string) => string;
}

/** Prices render at two decimals, matching the ingredient list's `fmt: 2`. */
const PRICE_DIGITS: Intl.NumberFormatOptions = {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
};

export function packagingColumns({
    t,
    locale,
    formatter,
    categoryName,
}: PackagingColumnDeps): readonly CatalogueColumn<IngredientAdmin>[] {
    const dash = t('kitchen:list.noValue');

    return [
        {
            key: 'reference',
            label: t('kitchen:list.columnReference'),
            width: 96,
            min: 84,
            priority: CATALOGUE_PRIORITY.reference,
            role: 'meta',
            mono: true,
            sortable: true,
            sortType: 'text',
            value: (row) => row.reference ?? dash,
            render: (row) => (
                <Text
                    testID={`${packagingRowTestId(row.id)}-reference`}
                    variant="mono"
                    tone={row.reference === null ? 'secondary' : 'primary'}
                >
                    {row.reference ?? dash}
                </Text>
            ),
        },
        {
            key: 'name',
            // The same `columnItem` the ingredient list takes. `list.columnName` still reads
            // "Designation" and still names the recipe line table's title column, which is a
            // different surface with a different word for it.
            label: t('kitchen:list.columnItem'),
            width: 200,
            min: 150,
            priority: CATALOGUE_PRIORITY.designation,
            role: 'title',
            sortable: true,
            sortType: 'text',
            value: (row) => displayName(row.name, locale).value,
            /*
             * The `label` step, which is what the other five Catalogue lists give the column that
             * names the row — ingredients, products, recipes, meals and allergen classes all draw
             * it this way.
             *
             * This column had no `render` at all, so `DataList` fell back to its default cell
             * class and the item set at `role-body`'s 400 while every neighbouring list set its
             * own at 500. Same size, one weight lighter, on the one column a reader scans down.
             */
            render: (row) => (
                <Text variant="label" testID={`${packagingRowTestId(row.id)}-name`}>
                    {displayName(row.name, locale).value}
                </Text>
            ),
        },
        {
            // The branch, not the leaf. This track used to carry the sub-category — bags, lids,
            // cutlery — on the argument that every row here shares one top-level category, so the
            // parent reads the same on all thirty-three. That is still true of the seeded data; the
            // column is the parent by request. The leaf has not gone anywhere: the View panel
            // carries both, and this column's own menu still filters by sub-category, which is the
            // only value on the branch that narrows anything.
            key: 'category',
            label: t('kitchen:list.columnCategory'),
            width: 160,
            min: 112,
            priority: CATALOGUE_PRIORITY.category,
            role: 'meta',
            sortable: true,
            sortType: 'text',
            // `categoryCode` is a plain string on the wire, not nullable — the empty string is how
            // an unfiled row arrives, which is the same test the View panel makes.
            value: (row) => (row.categoryCode === '' ? dash : categoryName(row.categoryCode)),
            render: (row) => (
                <Text
                    testID={`${packagingRowTestId(row.id)}-category`}
                    tone={row.categoryCode === '' ? 'secondary' : 'primary'}
                >
                    {row.categoryCode === '' ? dash : categoryName(row.categoryCode)}
                </Text>
            ),
        },
        {
            // The pack, not the issued unit: this is the denominator of the price beside it, and a
            // price whose unit is not on the row is a number nobody can check.
            //
            // 108 is the *header's* width, not the value's. `pack` and `btl` need 44px; `PURCHASE
            // UNIT` sets at 88 and with the cell's insets needs 104, and at 96 it wrapped to
            // `PURCHASE / UNIT` over a column of three-letter values. Where a label is longer than
            // anything under it, the label is what the track has to hold — the same reading applies
            // to `itemsPerUnit` below, which is why the two share a number.
            key: 'purchaseUnit',
            label: t('kitchen:fields.purchaseUnit'),
            width: 108,
            min: 64,
            priority: CATALOGUE_PRIORITY.unit,
            align: 'center',
            value: (row) => (row.purchaseUnit === null ? dash : t(unitShortKey(row.purchaseUnit))),
        },
        {
            // `ITEMS PER PACK` sets at 89 — see `purchaseUnit` above.
            key: 'itemsPerUnit',
            label: t('kitchen:fields.itemsPerUnit'),
            width: 108,
            min: 68,
            priority: CATALOGUE_PRIORITY.unit,
            align: 'center',
            mono: true,
            value: (row) =>
                row.itemsPerUnit === null ? dash : formatter.formatNumber(row.itemsPerUnit),
        },
        {
            key: 'purchasePrice',
            label: t('kitchen:packaging.columnPackPrice'),
            width: 96,
            min: 88,
            priority: CATALOGUE_PRIORITY.unitPrice,
            align: 'center',
            // The page's headline number. Packaging exists as records so a recipe can cost what it
            // ships in, and this is that cost.
            role: 'metric',
            mono: true,
            sortable: true,
            sortType: 'number',
            value: (row) =>
                row.purchasePrice === null
                    ? dash
                    : formatter.formatNumber(row.purchasePrice.amount, PRICE_DIGITS),
            render: (row) => (
                <Text
                    testID={`${packagingRowTestId(row.id)}-purchase-price`}
                    variant="mono"
                    tone={row.purchasePrice === null ? 'secondary' : 'primary'}
                >
                    {row.purchasePrice === null
                        ? dash
                        : formatter.formatNumber(row.purchasePrice.amount, PRICE_DIGITS)}
                </Text>
            ),
        },
        {
            // How much product one item holds, in the recipe's own unit — 0.3 kg in a 300 cc
            // bottle. It is on the row rather than in the panel because it is the other half of the
            // costing question: the price says what the container costs, this says how many of them
            // a batch needs.
            //
            // 88 rather than 104: `HOLDS` is a five-letter label and `0.35 kg` the widest figure
            // under it at 51px, so the old track carried 37px of nothing. The three trimmed here —
            // this, `purchasePrice` and `waste` — are what pay for the two headers above, and the
            // equal share hands the rest of the difference back across the whole row.
            key: 'capacity',
            label: t('kitchen:packaging.columnCapacity'),
            width: 88,
            min: 80,
            priority: CATALOGUE_PRIORITY.metric,
            align: 'center',
            mono: true,
            value: (row) =>
                row.capacity === null
                    ? dash
                    : `${formatter.formatNumber(row.capacity.quantity)} ${t(unitShortKey(row.capacity.unit))}`,
        },
        {
            key: 'waste',
            label: t('kitchen:packaging.columnWaste'),
            width: 80,
            min: 68,
            priority: CATALOGUE_PRIORITY.updated,
            align: 'center',
            mono: true,
            // `0` and `null` are different answers — "none is thrown away" against "nobody has
            // measured" — so the dash is reserved for the second.
            value: (row) =>
                row.wastePercent === null ? dash : `${formatter.formatNumber(row.wastePercent)}%`,
        },
        {
            key: 'status',
            label: t('kitchen:list.columnStatus'),
            width: 112,
            min: 88,
            priority: CATALOGUE_PRIORITY.status,
            role: 'status',
            badge: true,
            sortable: false,
            value: (row) => t(packagingStatusKey(row.meta.status)),
            render: (row) => (
                <Badge
                    testID={`${packagingRowTestId(row.id)}-status`}
                    tone={packagingStatusTone(row.meta.status)}
                    // No mark on Published. The tone's default `✓` is `Badge`'s way of keeping
                    // meaning off colour alone, and "Published" is a word that needs no help —
                    // §prop docs allow `null` for exactly that case. Draft and Review keep theirs,
                    // because those two are the states a reader is scanning *for*.
                    icon={row.meta.status === 'published' ? null : undefined}
                    label={t(packagingStatusKey(row.meta.status))}
                />
            ),
        },
    ];
}
