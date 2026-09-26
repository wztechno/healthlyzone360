import type {
    IngredientAdmin,
    PackagingBasis,
    RecipeLine,
    RecipePackagingLine,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import { Badge, FormSection, Inline, Stack, Table, Text } from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import type { IngredientId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCan } from '../../../access/gate.tsx';
import { useIngredientsByIds } from '../../../data/kitchen-admin-hooks.ts';
import { useStockItemsQuery, useStockLevelsQuery } from '../../../data/kitchen-ops-hooks.ts';
import { displayQuantity, scaleLine, scalePackaging } from '../batch-scaling.ts';
import { INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, unitShortKey } from '../format.ts';

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
 */
export function BatchSheet({ version, factor, ingredients, availability, first }: BatchSheetProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const dash = t('kitchen:list.noValue');
    const number = (value: number): string => formatter.formatNumber(value, BATCH_QUANTITY_FORMAT);

    const nameOf = (ingredientId: IngredientId): string => {
        const found = ingredients[String(ingredientId)];
        return found === undefined ? dash : displayName(found.name, locale).value;
    };

    const shortOf = (line: RecipeLine): { available: number | null; short: number | null } => {
        const available = availability(line.ingredientId, line.unit);
        if (available === null) return { available: null, short: null };
        const required = scaleLine(line.quantity, factor);
        return { available, short: Math.max(0, required - available) };
    };

    const shelfLineColumns: readonly TableColumn<RecipeLine>[] = [
        {
            key: 'item',
            header: t('kitchen:ops.batch.columnItem'),
            rowHeader: true,
            flex: 2,
            render: (line) => (
                <Inline space="xs" align="center" wrap>
                    <Text
                        variant="bodyStrong"
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
            header: t('kitchen:ops.batch.columnRequired'),
            numeric: true,
            primary: true,
            render: (line) => (
                <Text
                    variant="mono"
                    testID={`kitchen-batch-row-${String(line.ingredientId)}-quantity`}
                >
                    {number(displayQuantity(scaleLine(line.quantity, factor), line.unit).quantity)}
                </Text>
            ),
        },
        {
            key: 'unit',
            numeric: true,
            header: t('kitchen:ops.batch.columnUnit'),
            // The unit the required figure is read in — grams under a kilogram. See `displayQuantity`.
            render: (line) => (
                <Text tone="secondary">
                    {t(
                        unitShortKey(
                            displayQuantity(scaleLine(line.quantity, factor), line.unit).unit,
                        ),
                    )}
                </Text>
            ),
        },
        {
            key: 'available',
            header: t('kitchen:ops.batch.columnAvailable'),
            numeric: true,
            render: (line) => {
                const { available } = shortOf(line);
                return (
                    <Text
                        variant="mono"
                        tone="secondary"
                        testID={`kitchen-batch-row-${String(line.ingredientId)}-available`}
                    >
                        {available === null
                            ? dash
                            : `${number(available)} ${t(unitShortKey(line.unit))}`}
                    </Text>
                );
            },
        },
        {
            key: 'short',
            header: t('kitchen:ops.batch.columnShort'),
            numeric: true,
            render: (line) => {
                const { short } = shortOf(line);
                return (
                    <Text
                        variant="mono"
                        tone={short !== null && short > 0 ? 'danger' : 'secondary'}
                        testID={`kitchen-batch-row-${String(line.ingredientId)}-short`}
                    >
                        {short === null || short === 0
                            ? dash
                            : `${number(short)} ${t(unitShortKey(line.unit))}`}
                    </Text>
                );
            },
        },
        {
            key: 'position',
            header: t('kitchen:ops.batch.columnPosition'),
            render: (line) => {
                const { short } = shortOf(line);
                if (short === null) return <Text tone="secondary">{dash}</Text>;
                return short > 0 ? (
                    <Badge
                        testID={`kitchen-batch-row-${String(line.ingredientId)}-position`}
                        tone="danger"
                        label={t('kitchen:ops.batch.positionShort')}
                    />
                ) : (
                    <Badge
                        testID={`kitchen-batch-row-${String(line.ingredientId)}-position`}
                        tone="success"
                        label={t('kitchen:ops.batch.positionCovered')}
                    />
                );
            },
        },
    ];

    const packagingColumns: readonly TableColumn<RecipePackagingLine>[] = [
        {
            key: 'item',
            header: t('kitchen:ops.batch.columnItem'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Text
                    variant="bodyStrong"
                    testID={`kitchen-batch-row-${String(row.ingredientId)}-name`}
                >
                    {nameOf(row.ingredientId)}
                </Text>
            ),
        },
        {
            key: 'quantity',
            header: t('kitchen:ops.batch.columnQuantity'),
            numeric: true,
            primary: true,
            render: (row) => {
                const applied = scalePackaging(row.quantity, factor, row.unit);
                const exact = scaleLine(row.quantity, factor);
                return (
                    <Inline space="xs" align="center" wrap>
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
            numeric: true,
            header: t('kitchen:ops.batch.columnUnit'),
            render: (row) => (
                <Text tone="secondary">
                    {t(
                        unitShortKey(
                            displayQuantity(
                                scalePackaging(row.quantity, factor, row.unit),
                                row.unit,
                            ).unit,
                        ),
                    )}
                </Text>
            ),
        },
        {
            key: 'basis',
            header: t('kitchen:ops.batch.columnBasis'),
            render: (row) => (
                <Stack space="none">
                    <Text tone="secondary">{t(BASIS_KEYS[row.basis])}</Text>
                    {row.comment === null ? null : (
                        <Text tone="secondary" variant="caption">
                            {row.comment}
                        </Text>
                    )}
                </Stack>
            ),
        },
    ];

    return (
        <>
            <FormSection
                first={first}
                testID="kitchen-batch-consume"
                title={t('kitchen:ops.batch.consumeHeading')}
                description={t('kitchen:ops.batch.consumeBody')}
                aside={
                    <Badge tone="info" icon={null} label={t('kitchen:ops.batch.fromDatabase')} />
                }
            >
                {/*
                 * ponytail: rows are keyed by ingredient id. A sheet that lists one ingredient twice
                 * gives the two rows one key — index the rows if a kitchen hits it.
                 */}
                <Table<RecipeLine>
                    testID="kitchen-batch-ingredients"
                    caption={t('kitchen:ops.batch.ingredientsHeading')}
                    captionHidden
                    columns={shelfLineColumns}
                    rows={version.lines}
                    rowKey={(line) => String(line.ingredientId)}
                    rowSize="sm"
                />
            </FormSection>

            <FormSection
                testID="kitchen-batch-packaging-section"
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
            >
                {version.packaging.length === 0 ? (
                    <Text testID="kitchen-batch-packaging-empty" variant="caption" tone="secondary">
                        {t('kitchen:ops.batch.noPackaging')}
                    </Text>
                ) : (
                    <Table<RecipePackagingLine>
                        testID="kitchen-batch-packaging"
                        caption={t('kitchen:ops.batch.packagingHeading')}
                        captionHidden
                        columns={packagingColumns}
                        rows={version.packaging}
                        rowKey={(row) => String(row.ingredientId)}
                        rowSize="sm"
                    />
                )}
                {version.packaging.length === 0 ? null : (
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:ops.batch.roundingFoot')}
                    </Text>
                )}
            </FormSection>
        </>
    );
}
