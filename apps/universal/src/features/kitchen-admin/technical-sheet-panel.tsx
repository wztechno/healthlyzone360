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
 * ## The figures are the sheet's own
 *
 * Costs come from the `as_recorded` snapshot — the source document's numbers,
 * verbatim, including its rounding. `basisMismatch` marks a sheet whose cost
 * label claims a denominator its yield never stated; the flag travels with
 * the figures because a confident-looking number under review is worse than
 * no number.
 */
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
    const figures = sheet?.asRecorded ?? null;
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
