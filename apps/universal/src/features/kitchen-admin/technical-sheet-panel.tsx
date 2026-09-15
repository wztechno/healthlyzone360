import type {
    CostAmount,
    RecipeAdmin,
    RecipeLine,
    RecipeVersionAdmin,
    TechnicalSheetAdmin,
    TechnicalSheetLineAdmin,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Card,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Table,
    Text,
} from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { displayName, humaniseCode } from './format.ts';

/**
 * The recipe as the kitchen's paper technical sheet lays it out: a Description
 * block (Designation, Kind, Quantity Produced), the Raw Materiel table with
 * the sheet's own columns — U., Q., U.P., T, Comments — a Total row, and the
 * Cost block (total, per-unit, per-piece, each with its waste figure).
 *
 * ## The money is a separate question from the formulation
 *
 * `sheet` is `null` for a member without `recipe.view_costs_organisation`,
 * and the panel simply renders without the U.P./T columns and without the
 * Cost block. That is the same person seeing the same formulation; what they
 * cannot see is what it costs, and a panel that failed outright would hide
 * the half they are entitled to.
 *
 * ## Three cost blocks arrive; this leads with the live one
 *
 * `computed` is this system's arithmetic over the lines as they stand, so it is
 * there for a draft that was never published and it moves when a line is
 * edited. `recalculated` is the same arithmetic frozen at publication, and
 * `as_recorded` is the v6 import's transcription of a source workbook —
 * verbatim, rounding errors included, which makes it evidence rather than an
 * answer.
 *
 * The panel read `as_recorded` and nothing else for a while, which meant every
 * recipe a kitchen typed in by hand showed an empty cost block: only imported
 * rows have that snapshot, and the `estimatedCost` beside it is hard-coded null
 * in the mapper. `basisMismatch` still travels with a snapshot, because a
 * confident-looking number under review is worse than no number.
 *
 * The packaging half and the all-in total are drawn from `computed` alone. A
 * snapshot carries neither — they are the second table the source sheet runs
 * down the same page, with its own total and its own waste rate.
 */
/**
 * The subset of a cost block this panel draws, so the three sources can be normalised into one.
 *
 * `basisMismatch` only ever comes from a snapshot: it marks a source sheet whose cost label claimed
 * a denominator its yield never stated, which is a fact about a transcription rather than about
 * arithmetic this system performed.
 */
interface SheetFigures {
    readonly totalInputCost: CostAmount | null;
    readonly costPerYieldUnit: CostAmount | null;
    readonly costPerYieldUnitWithWaste: CostAmount | null;
    readonly costPerPiece: CostAmount | null;
    readonly costPerPieceWithWaste: CostAmount | null;
    readonly wastePercent: number;
    readonly basisMismatch: boolean;
}

export function TechnicalSheetPanel({
    testID,
    recipe,
    version,
    sheet,
    isLoading,
}: {
    readonly testID: string;
    readonly recipe: RecipeAdmin;
    readonly version: RecipeVersionAdmin;
    /** `null` = costs not visible to this member; `undefined` while loading. */
    readonly sheet: TechnicalSheetAdmin | null | undefined;
    readonly isLoading: boolean;
}) {
    const { t } = useTranslation(['kitchen']);
    const { locale } = useLocale();
    const formatter = useFormatter();

    const showCosts = sheet !== null && sheet !== undefined;

    const cost = (amount: CostAmount | null): string =>
        amount === null
            ? '—'
            : formatter.formatCurrency(amount.amount, amount.currency, {
                  maximumFractionDigits: 3,
              });

    const rows = version.lines.map((line: RecipeLine, index: number) => {
        const sheetLine: TechnicalSheetLineAdmin | undefined = sheet?.lines[index];

        return {
            key: `${index + 1}-${String(line.ingredientId)}`,
            designation: line.sourceDesignation ?? displayName(line.ingredientName, locale).value,
            unit: line.unit,
            quantity: line.quantity,
            unitCost: sheetLine?.unitCost ?? null,
            lineCost: sheetLine?.lineCost ?? null,
            comment: sheetLine?.comment ?? null,
        };
    });

    type Row = (typeof rows)[number];

    const inputQuantity = version.lines.reduce(
        (sum: number, line: RecipeLine) => sum + line.quantity,
        0,
    );
    /*
     * Which of the three cost blocks this sheet leads with, in the order a reader should trust
     * them.
     *
     * The panel used to read `asRecorded` and nothing else, and that was the wrong one of the three
     * to pick: `as_recorded` is written by the v6 importer alone — it is the source workbook's own
     * numbers, kept verbatim including its errors — so a recipe a kitchen typed in by hand rendered
     * no cost block at all. The `estimatedCost` fallback beside it did not help either; the mapper
     * hard-codes that to null.
     *
     * `computed` is this system's arithmetic over the lines **as they stand now**, so it is present
     * for a draft that has never been published and it moves when somebody edits a line. The two
     * snapshots follow it: `recalculated` is the same arithmetic frozen at publication, and
     * `as_recorded` is the import's transcription, which is evidence rather than an answer.
     */
    const computed = sheet?.computed ?? null;
    const figures: SheetFigures | null =
        computed !== null
            ? {
                  totalInputCost: computed.production.total,
                  costPerYieldUnit: computed.production.costPerYieldUnit,
                  costPerYieldUnitWithWaste: computed.production.costPerYieldUnitWithWaste,
                  costPerPiece: computed.production.costPerPiece,
                  costPerPieceWithWaste: computed.production.costPerPieceWithWaste,
                  wastePercent: computed.production.wastePercent,
                  basisMismatch: false,
              }
            : (sheet?.recalculated ?? sheet?.asRecorded ?? null);

    /*
     * The packaging half, drawn only when there is one.
     *
     * A version that packages nothing has a complete packaging block full of zeroes — honest, and
     * not worth three rows of nought. `costPerYieldUnit` being null is the signal that nothing was
     * costed at all.
     */
    const packagingFigures =
        computed !== null && computed.packaging.costPerYieldUnit !== null
            ? computed.packaging
            : null;

    const totalCost = figures?.totalInputCost ?? version.estimatedCost;

    const quantityProduced =
        version.yieldPieces === null
            ? `${formatter.formatNumber(version.yieldQuantity)} ${version.yieldUnit}`
            : t('kitchen:recipes.sheetQuantityWithPieces', {
                  pieces: formatter.formatNumber(version.yieldPieces),
                  quantity: formatter.formatNumber(version.yieldQuantity),
                  unit: version.yieldUnit,
              });

    const columns = [
        {
            key: 'designation',
            header: t('kitchen:recipes.sheetColDesignation'),
            primary: true,
            rowHeader: true,
            flex: 2,
            render: (row: Row) => <Text>{row.designation}</Text>,
        },
        {
            key: 'unit',
            header: t('kitchen:recipes.sheetColUnit'),
            render: (row: Row) => <Text variant="caption">{row.unit}</Text>,
        },
        {
            key: 'quantity',
            header: t('kitchen:recipes.sheetColQuantity'),
            numeric: true,
            render: (row: Row) => <Text>{formatter.formatNumber(row.quantity)}</Text>,
        },
        ...(showCosts
            ? [
                  {
                      key: 'unitCost',
                      header: t('kitchen:recipes.sheetColUnitPrice'),
                      numeric: true,
                      render: (row: Row) => <Text>{cost(row.unitCost)}</Text>,
                  },
                  {
                      key: 'lineCost',
                      header: t('kitchen:recipes.sheetColLineTotal'),
                      numeric: true,
                      render: (row: Row) => <Text>{cost(row.lineCost)}</Text>,
                  },
              ]
            : []),
        {
            key: 'comment',
            header: t('kitchen:recipes.sheetColComments'),
            flex: 2,
            render: (row: Row) =>
                row.comment === null ? null : <Text variant="caption">{row.comment}</Text>,
        },
    ];

    return (
        <Card testID={testID} tone="raised">
            <Stack space="md">
                <Stack space="xs">
                    <Heading level={2}>{t('kitchen:recipes.sheetTitle')}</Heading>
                    <Text variant="caption" testID={`${testID}-confidential`}>
                        {t('kitchen:recipes.sheetConfidential')}
                    </Text>
                </Stack>

                <Stack space="xs" testID={`${testID}-description`}>
                    <DescriptionRow
                        label={t('kitchen:recipes.sheetDesignation')}
                        value={displayName(recipe.name, locale).value}
                        testID={`${testID}-designation`}
                    />
                    <DescriptionRow
                        label={t('kitchen:recipes.sheetKind')}
                        value={
                            recipe.sourceKind === null
                                ? t('kitchen:recipes.sheetKindUnstated')
                                : humaniseCode(recipe.sourceKind)
                        }
                        testID={`${testID}-kind`}
                    />
                    <DescriptionRow
                        label={t('kitchen:recipes.sheetQuantityProduced')}
                        value={quantityProduced}
                        testID={`${testID}-quantity`}
                    />
                </Stack>

                {isLoading ? (
                    <Skeleton testID={`${testID}-loading`} heightClassName="h-32" />
                ) : (
                    <Stack space="sm">
                        <Table<Row>
                            testID={`${testID}-lines`}
                            caption={t('kitchen:recipes.sheetRawMaterial')}
                            columns={columns}
                            rows={rows}
                            rowKey={(row: Row) => row.key}
                            emptyLabel={t('kitchen:recipes.sheetNoLines')}
                            // A sheet of nine lines is read as a column of figures, and the table's
                            // default row is a control's height: the compact row keeps the whole
                            // formulation in one glance, the way the batch planner's tables do.
                            rowSize="sm"
                        />

                        {rows.length > 0 ? (
                            <Inline space="md" testID={`${testID}-total`}>
                                <Text variant="label">{t('kitchen:recipes.sheetTotalRow')}</Text>
                                <Text>
                                    {formatter.formatNumber(inputQuantity)} {version.yieldUnit}
                                </Text>
                                {showCosts && totalCost !== null ? (
                                    <Text variant="label">{cost(totalCost)}</Text>
                                ) : null}
                            </Inline>
                        ) : null}
                    </Stack>
                )}

                {showCosts ? (
                    figures === null ? (
                        <Text variant="caption" testID={`${testID}-cost-absent`}>
                            {t('kitchen:recipes.sheetCostAbsent')}
                        </Text>
                    ) : (
                        <Stack space="xs" testID={`${testID}-cost`}>
                            <Inline space="sm">
                                <Heading level={3}>{t('kitchen:recipes.sheetCostTitle')}</Heading>
                                <Badge tone="warning" label={t('kitchen:rollup.confidential')} />
                                {figures.basisMismatch ? (
                                    <Badge
                                        tone="warning"
                                        testID={`${testID}-cost-mismatch`}
                                        label={t('kitchen:recipes.sheetBasisMismatch')}
                                    />
                                ) : null}
                            </Inline>
                            <DescriptionRow
                                label={t('kitchen:recipes.sheetCostTotal')}
                                value={cost(figures.totalInputCost)}
                                testID={`${testID}-cost-total`}
                            />
                            {figures.costPerYieldUnit !== null ? (
                                <DescriptionRow
                                    label={t('kitchen:recipes.sheetCostPerUnit', {
                                        unit: version.yieldUnit,
                                    })}
                                    value={cost(figures.costPerYieldUnit)}
                                    testID={`${testID}-cost-per-unit`}
                                />
                            ) : null}
                            {figures.costPerYieldUnitWithWaste !== null ? (
                                <DescriptionRow
                                    label={t('kitchen:recipes.sheetCostWithWaste', {
                                        percent: formatter.formatNumber(figures.wastePercent),
                                    })}
                                    value={cost(figures.costPerYieldUnitWithWaste)}
                                    testID={`${testID}-cost-per-unit-waste`}
                                />
                            ) : null}
                            {figures.costPerPiece !== null ? (
                                <DescriptionRow
                                    label={t('kitchen:recipes.sheetCostPerPiece')}
                                    value={cost(figures.costPerPiece)}
                                    testID={`${testID}-cost-per-piece`}
                                />
                            ) : null}
                            {figures.costPerPieceWithWaste !== null ? (
                                <DescriptionRow
                                    label={t('kitchen:recipes.sheetCostWithWaste', {
                                        percent: formatter.formatNumber(figures.wastePercent),
                                    })}
                                    value={cost(figures.costPerPieceWithWaste)}
                                    testID={`${testID}-cost-per-piece-waste`}
                                />
                            ) : null}

                            {/*
                             * What one batch ships in, and what the two halves come to together.
                             *
                             * The source workbook runs these as a second table down the same page,
                             * with its own total and its own waste rate — so they are rows here
                             * rather than a separate panel. `packaging_waste_percent` is a
                             * different number from the production coefficient on purpose: sauce
                             * left in the pot is not split film.
                             */}
                            {packagingFigures === null ? null : (
                                <>
                                    <DescriptionRow
                                        label={t('kitchen:recipes.sheetPackagingPerUnit', {
                                            unit: version.yieldUnit,
                                        })}
                                        value={cost(packagingFigures.costPerYieldUnit)}
                                        testID={`${testID}-packaging-per-unit`}
                                    />
                                    {packagingFigures.costPerYieldUnitWithWaste === null ? null : (
                                        <DescriptionRow
                                            label={t('kitchen:recipes.sheetCostWithWaste', {
                                                percent: formatter.formatNumber(
                                                    packagingFigures.wastePercent,
                                                ),
                                            })}
                                            value={cost(packagingFigures.costPerYieldUnitWithWaste)}
                                            testID={`${testID}-packaging-per-unit-waste`}
                                        />
                                    )}
                                </>
                            )}

                            {computed?.totalCostPerYieldUnit == null ? null : (
                                <DescriptionRow
                                    label={t('kitchen:recipes.sheetCostAllIn', {
                                        unit: version.yieldUnit,
                                    })}
                                    value={cost(computed.totalCostPerYieldUnit)}
                                    testID={`${testID}-cost-all-in`}
                                />
                            )}
                        </Stack>
                    )
                ) : (
                    <Text variant="caption" testID={`${testID}-cost-hidden`}>
                        {t('kitchen:recipes.sheetCostHidden')}
                    </Text>
                )}
            </Stack>
        </Card>
    );
}

function DescriptionRow({
    label,
    value,
    testID,
}: {
    readonly label: string;
    readonly value: string;
    readonly testID: string;
}) {
    return (
        <View className="flex-row items-baseline gap-3" testID={testID}>
            <View className="w-44">
                <Text variant="label">{label}</Text>
            </View>
            <View className="flex-1">
                <Text>{value}</Text>
            </View>
        </View>
    );
}
