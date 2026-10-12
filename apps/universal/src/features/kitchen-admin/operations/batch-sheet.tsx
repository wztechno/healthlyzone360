import type {
    IngredientAdmin,
    PackagingBasis,
    RecipeLine,
    RecipePackagingLine,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import { Badge, Inline, Text } from '@healthy360/design-system';
import type { IngredientId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCan } from '../../../access/gate.tsx';
import { useIngredientsByIds } from '../../../data/kitchen-admin-hooks.ts';
import { useStockItemsQuery, useStockLevelsQuery } from '../../../data/kitchen-ops-hooks.ts';
import { displayQuantity, scaleLine, scalePackaging, withWaste } from '../batch-scaling.ts';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ColumnFilter, ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { compareAmount, compareNumber, compareText } from '../catalogue/use-column-controls.tsx';
import { INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, unitShortKey } from '../format.ts';
import { ProductionTable } from '../production-desk/production-table.tsx';

/**
 * The batch sheet (Operations handoff `edProduction`) — what one version, scaled, will consume, set
 * against this branch's shelves: the production editor's, for the batch being started. The batch
 * planner draws its own read-only sheet and shares the hooks and the quantity format from here.
 *
 * ## Available is stated only when it can be stated honestly
 *
 * A shelf is matched to a line by ingredient id, and its quantity is only compared with the line
 * when the shelf counts in the line's own unit. There is no conversion here — a shelf in `piece`
 * against a line in `kg` has no honest "short", so the row says nothing rather than guess. The same
 * goes for a reader without `inventory.view_organisation`: the shelves are not asked for at all.
 */

/** Scaled quantities to three decimals: 0.4 of an egg is an instruction, 0.4000 is noise. */
export const BATCH_QUANTITY_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 3 };

export const BASIS_KEYS: Readonly<Record<PackagingBasis, string>> = {
    fills_yield: 'kitchen:ops.batch.basis.fills_yield',
    per_container: 'kitchen:ops.batch.basis.per_container',
    per_batch: 'kitchen:ops.batch.basis.per_batch',
};

/** Below this a packaging figure was not rounded — it is floating-point noise, not a whole box. */
const ROUNDED_TOLERANCE = 1e-6;

/** On hand for an ingredient in a given unit, or `null` when that cannot be said. */
export type ShelfAvailability = (ingredientId: IngredientId, unit: MeasureUnit) => number | null;

export function useShelfAvailability(): ShelfAvailability {
    const canView = useCan(INVENTORY_VIEW_PERMISSION);
    const items = useStockItemsQuery(canView);
    const levels = useStockLevelsQuery(canView);
    const itemRows = items.data;
    const levelRows = levels.data;

    return useMemo<ShelfAvailability>(() => {
        const unitByItem = new Map<string, string>();
        for (const item of itemRows ?? []) unitByItem.set(String(item.id), item.unitCode);
        const byIngredient = new Map<string, { quantity: number; unit: string }>();
        for (const level of levelRows ?? []) {
            if (level.ingredientId === null) continue;
            const unit = unitByItem.get(String(level.stockItemId));
            const quantity = Number(level.quantity);
            if (unit === undefined || !Number.isFinite(quantity)) continue;
            const key = String(level.ingredientId);
            const existing = byIngredient.get(key);
            byIngredient.set(key, {
                unit,
                quantity: existing === undefined ? quantity : existing.quantity + quantity,
            });
        }
        return (ingredientId, unit) => {
            if (itemRows === undefined || levelRows === undefined) return null;
            const shelf = byIngredient.get(String(ingredientId));
            // Never bought onto a shelf is a known zero, not an unknown.
            if (shelf === undefined) return 0;
            return shelf.unit.toLowerCase() === unit.toLowerCase() ? shelf.quantity : null;
        };
    }, [itemRows, levelRows]);
}

/** Every ingredient the version names — lines and packaging — resolved by id from the catalogue. */
export function useBatchIngredients(
    version: RecipeVersionAdmin | null,
): Readonly<Record<string, IngredientAdmin>> {
    const ids = useMemo<readonly IngredientId[]>(() => {
        if (version === null) return [];
        const byId = new Map<string, IngredientId>();
        for (const line of version.lines) byId.set(String(line.ingredientId), line.ingredientId);
        for (const row of version.packaging) byId.set(String(row.ingredientId), row.ingredientId);
        return [...byId.values()];
    }, [version]);
    return useIngredientsByIds(ids);
}

export interface BatchSheetProps {
    readonly version: RecipeVersionAdmin;
    readonly factor: number;
    readonly ingredients: Readonly<Record<string, IngredientAdmin>>;
    /** This branch's shelves: Required / Available / Short / Position. */
    readonly availability: ShelfAvailability;
    readonly first?: boolean | undefined;
}

/**
 * What it will consume, then what it is packed in. Row test ids stay `kitchen-batch-row-<id>-*`.
 *
 * Both tables are {@link ProductionTable}s, as the planner's and the batch page's are. Their lists
 * are `kitchen-batch-sheet-*` rather than the planner's `kitchen-batch-*`: the column choice is
 * remembered under the list's id, and the two sheets do not carry the same columns.
 */
export function BatchSheet({ version, factor, ingredients, availability, first }: BatchSheetProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const dash = t('kitchen:list.noValue');
    const number = (value: number): string => formatter.formatNumber(value, BATCH_QUANTITY_FORMAT);

    // The batch planner's rule: each half carries its own waste rate (see `withWaste`).
    const ingredientFactor = withWaste(factor, version.wastePercent);
    const packagingFactor = withWaste(factor, version.packagingWastePercent);

    const nameOf = (ingredientId: IngredientId): string => {
        const found = ingredients[String(ingredientId)];
        return found === undefined ? dash : displayName(found.name, locale).value;
    };
    // Blank rather than the dash, so an unresolved name sorts last rather than among the dashes.
    const sortName = (ingredientId: IngredientId): string | null => {
        const found = ingredients[String(ingredientId)];
        return found === undefined ? null : displayName(found.name, locale).value;
    };

    const shortOf = (line: RecipeLine): { available: number | null; short: number | null } => {
        const available = availability(line.ingredientId, line.unit);
        if (available === null) return { available: null, short: null };
        const required = scaleLine(line.quantity, ingredientFactor);
        return { available, short: Math.max(0, required - available) };
    };

    /** A figure that may be unknown, unknowns last either way. */
    const byKnown = (left: number | null, right: number | null, direction: 'asc' | 'desc') =>
        compareAmount(
            left === null ? null : String(left),
            right === null ? null : String(right),
            direction,
        );

    const required = (line: RecipeLine) =>
        displayQuantity(scaleLine(line.quantity, ingredientFactor), line.unit);
    const packed = (row: RecipePackagingLine) =>
        displayQuantity(scalePackaging(row.quantity, packagingFactor, row.unit), row.unit);

    /** The unit a figure is read in — grams under a kilogram. See `displayQuantity`. */
    function unitFilter<Row>(unitOf: (row: Row) => MeasureUnit): ColumnFilter<Row> {
        return {
            values: (loaded) =>
                [...new Set(loaded.map(unitOf))].map((unit) => ({
                    key: unit,
                    label: t(unitShortKey(unit)),
                })),
            match: (row, value) => unitOf(row) === value,
        };
    }

    const available = (line: RecipeLine): string => {
        const figure = shortOf(line).available;
        return figure === null ? dash : `${number(figure)} ${t(unitShortKey(line.unit))}`;
    };
    const short = (line: RecipeLine): string => {
        const figure = shortOf(line).short;
        return figure === null || figure === 0
            ? dash
            : `${number(figure)} ${t(unitShortKey(line.unit))}`;
    };
    const position = (line: RecipeLine): string => {
        const figure = shortOf(line).short;
        if (figure === null) return dash;
        return t(
            figure > 0 ? 'kitchen:ops.batch.positionShort' : 'kitchen:ops.batch.positionCovered',
        );
    };

    const shelfLineColumns: readonly ControlledColumn<RecipeLine, CatalogueColumn<RecipeLine>>[] = [
        {
            key: 'item',
            role: 'title',
            label: t('kitchen:ops.batch.columnItem'),
            width: 200,
            priority: 100,
            sort: (left, right, direction) =>
                compareText(sortName(left.ingredientId), sortName(right.ingredientId), direction),
            value: (line) => nameOf(line.ingredientId),
            render: (line) => (
                <Inline space="xs" align="center">
                    <Text
                        variant="bodyStrong"
                        numberOfLines={1}
                        testID={`kitchen-batch-row-${String(line.ingredientId)}-name`}
                    >
                        {nameOf(line.ingredientId)}
                    </Text>
                    {line.isOptional ? (
                        <Badge
                            testID={`kitchen-batch-row-${String(line.ingredientId)}-optional`}
                            tone="neutral"
                            icon={null}
                            label={t('kitchen:ops.batch.optionalBadge')}
                        />
                    ) : null}
                </Inline>
            ),
        },
        {
            key: 'quantity',
            role: 'metric',
            width: 104,
            label: t('kitchen:ops.batch.columnRequired'),
            priority: 90,
            mono: true,
            sort: (left, right, direction) =>
                compareNumber(
                    scaleLine(left.quantity, ingredientFactor),
                    scaleLine(right.quantity, ingredientFactor),
                    direction,
                ),
            value: (line) => number(required(line).quantity),
            render: (line) => (
                <Text
                    variant="mono"
                    testID={`kitchen-batch-row-${String(line.ingredientId)}-quantity`}
                >
                    {number(required(line).quantity)}
                </Text>
            ),
        },
        {
            key: 'unit',
            role: 'meta',
            width: 64,
            label: t('kitchen:ops.batch.columnUnit'),
            priority: 70,
            filter: unitFilter<RecipeLine>((line) => required(line).unit),
            value: (line) => t(unitShortKey(required(line).unit)),
        },
        {
            key: 'available',
            width: 104,
            label: t('kitchen:ops.batch.columnAvailable'),
            priority: 60,
            mono: true,
            sort: (left, right, direction) =>
                byKnown(shortOf(left).available, shortOf(right).available, direction),
            value: available,
            render: (line) => (
                <Text
                    variant="mono"
                    tone="secondary"
                    testID={`kitchen-batch-row-${String(line.ingredientId)}-available`}
                >
                    {available(line)}
                </Text>
            ),
        },
        {
            key: 'short',
            width: 104,
            label: t('kitchen:ops.batch.columnShort'),
            priority: 80,
            mono: true,
            sort: (left, right, direction) =>
                byKnown(shortOf(left).short, shortOf(right).short, direction),
            value: short,
            render: (line) => {
                const figure = shortOf(line).short;
                return (
                    <Text
                        variant="mono"
                        tone={figure !== null && figure > 0 ? 'danger' : 'secondary'}
                        testID={`kitchen-batch-row-${String(line.ingredientId)}-short`}
                    >
                        {short(line)}
                    </Text>
                );
            },
        },
        {
            key: 'position',
            role: 'status',
            badge: true,
            width: 104,
            label: t('kitchen:ops.batch.columnPosition'),
            priority: 85,
            value: position,
            render: (line) => {
                const figure = shortOf(line).short;
                if (figure === null) return <Text tone="secondary">{dash}</Text>;
                return (
                    <Badge
                        testID={`kitchen-batch-row-${String(line.ingredientId)}-position`}
                        tone={figure > 0 ? 'danger' : 'success'}
                        label={position(line)}
                    />
                );
            },
        },
    ];

    const packagingColumns: readonly ControlledColumn<
        RecipePackagingLine,
        CatalogueColumn<RecipePackagingLine>
    >[] = [
        {
            key: 'item',
            role: 'title',
            label: t('kitchen:ops.batch.columnItem'),
            width: 200,
            priority: 100,
            sort: (left, right, direction) =>
                compareText(sortName(left.ingredientId), sortName(right.ingredientId), direction),
            value: (row) => nameOf(row.ingredientId),
            render: (row) => (
                <Text
                    variant="bodyStrong"
                    numberOfLines={1}
                    testID={`kitchen-batch-row-${String(row.ingredientId)}-name`}
                >
                    {nameOf(row.ingredientId)}
                </Text>
            ),
        },
        {
            key: 'quantity',
            role: 'metric',
            width: 140,
            label: t('kitchen:ops.batch.columnQuantity'),
            priority: 90,
            mono: true,
            sort: (left, right, direction) =>
                compareNumber(
                    scalePackaging(left.quantity, packagingFactor, left.unit),
                    scalePackaging(right.quantity, packagingFactor, right.unit),
                    direction,
                ),
            value: (row) => number(packed(row).quantity),
            render: (row) => {
                const applied = scalePackaging(row.quantity, packagingFactor, row.unit);
                const exact = scaleLine(row.quantity, packagingFactor);
                return (
                    <Inline space="xs" align="center">
                        <Text
                            variant="mono"
                            testID={`kitchen-batch-row-${String(row.ingredientId)}-quantity`}
                        >
                            {number(displayQuantity(applied, row.unit).quantity)}
                        </Text>
                        {Math.abs(applied - exact) > ROUNDED_TOLERANCE ? (
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID={`kitchen-batch-row-${String(row.ingredientId)}-exact`}
                            >
                                {t('kitchen:ops.batch.roundedFrom', {
                                    exact: number(displayQuantity(exact, row.unit).quantity),
                                })}
                            </Text>
                        ) : null}
                    </Inline>
                );
            },
        },
        {
            key: 'unit',
            role: 'meta',
            width: 64,
            label: t('kitchen:ops.batch.columnUnit'),
            priority: 70,
            filter: unitFilter<RecipePackagingLine>((row) => packed(row).unit),
            value: (row) => t(unitShortKey(packed(row).unit)),
        },
        {
            key: 'basis',
            role: 'meta',
            width: 160,
            label: t('kitchen:ops.batch.columnBasis'),
            priority: 60,
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.basis))].map((basis) => ({
                        key: basis,
                        label: t(BASIS_KEYS[basis]),
                    })),
                match: (row, value) => row.basis === value,
            },
            // One line: the comment follows the basis and reads whole on hover.
            value: (row) =>
                row.comment === null
                    ? t(BASIS_KEYS[row.basis])
                    : `${t(BASIS_KEYS[row.basis])} · ${row.comment}`,
        },
    ];

    return (
        <>
            {/*
             * ponytail: rows are keyed by ingredient id. A sheet that lists one ingredient twice
             * gives the two rows one key — index the rows if a kitchen hits it.
             */}
            <ProductionTable<RecipeLine>
                first={first}
                testID="kitchen-batch-sheet-ingredients"
                sectionTestID="kitchen-batch-consume"
                title={t('kitchen:ops.batch.consumeHeading')}
                description={t('kitchen:ops.batch.consumeBody')}
                aside={
                    <Badge tone="info" icon={null} label={t('kitchen:ops.batch.fromDatabase')} />
                }
                rows={version.lines}
                columns={shelfLineColumns}
                rowKey={(line) => String(line.ingredientId)}
            />

            <ProductionTable<RecipePackagingLine>
                testID="kitchen-batch-sheet-packaging"
                sectionTestID="kitchen-batch-packaging-section"
                title={t('kitchen:ops.batch.packagingHeading')}
                aside={
                    <Text variant="caption" tone="secondary">
                        {version.packaging.length === 0
                            ? t('kitchen:ops.batch.noneRecorded')
                            : t('kitchen:ops.batch.lineCount', {
                                  count: version.packaging.length,
                              })}
                    </Text>
                }
                rows={version.packaging}
                columns={packagingColumns}
                rowKey={(row) => String(row.ingredientId)}
                empty={
                    <Text testID="kitchen-batch-packaging-empty" variant="caption" tone="secondary">
                        {t('kitchen:ops.batch.noPackaging')}
                    </Text>
                }
            />
        </>
    );
}
