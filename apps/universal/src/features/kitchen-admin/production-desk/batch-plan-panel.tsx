import type { ProductionPlan, ProductionPlanLine } from '@healthy360/api-client/contracts';
import { Callout, DataList, Heading, Stack, Text } from '@healthy360/design-system';
import type { DataListColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { formatMoney, knownCurrency } from '../format.ts';
import { BATCH_QUANTITY_FORMAT } from '../operations/batch-sheet.tsx';
import { ledgerQuantity } from '../ops-format.ts';

/**
 * What a batch would need, against what the shelves can actually give (PROD1).
 *
 * ```
 * ITEM                 REQUIRED   ON HAND   CLAIMED ELSEWHERE   AVAILABLE   MISSING
 * Flour, plain         8 kg       10        8                   2           6
 * ```
 *
 * ## Five columns because no two of them answer the same question
 *
 * The drop from `onHand` to `available` is what needs explaining — it is other batches' claims, not
 * a miscount — and a screen that showed one number would send somebody to the store cupboard to
 * look for flour that is there and spoken for. `available` may be **negative** where more is
 * claimed than is present; it is rendered as it arrives, because a shelf somebody over-committed is
 * a real state and clamping it would hide it.
 *
 * Figures are read to three places, the batch sheet's own precision: the ledger's `1.804906` and
 * `0.0000` are exact and unreadable down a column.
 *
 * ## The holes are not rows and must never become zeroes
 *
 * `notComputable` is part of a recipe nobody could turn into a quantity. "Need nothing for that"
 * and "we could not work out what this needs" are opposite statements, and the only reason they
 * arrive apart is so a client cannot merge them by accident. They render as their own notice, above
 * the tables, where somebody has to read them before pressing Confirm.
 *
 * How many shelves are short, and what the batch is estimated to cost, are the page's to state —
 * in its figures and its cost card — so this panel is the tables and nothing that repeats them.
 */

export interface BatchPlanPanelProps {
    readonly testID: string;
    readonly plan: ProductionPlan;
    readonly costsVisible: boolean;
    /** Leave the heading to a card title that already says it. */
    readonly headless?: boolean | undefined;
}

export function BatchPlanPanel({
    testID,
    plan,
    costsVisible,
    headless = false,
}: BatchPlanPanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const noValue = t('kitchen:list.noValue');

    const figure = (value: string, unitCode: string | null = null): string =>
        ledgerQuantity(
            (parsed) => formatter.formatNumber(parsed, BATCH_QUANTITY_FORMAT),
            value,
            unitCode,
            noValue,
        );

    const columns: readonly DataListColumn<ProductionPlanLine>[] = [
        {
            key: 'item',
            label: t('kitchen:ops.production.columnItem'),
            width: 160,
            priority: 100,
            // The name alone. A long one ends in an ellipsis and reads whole on hover; the shelf's
            // code is a key for the ledger, not something a cook reads down a column.
            render: (line) => <Text variant="strong">{line.stockItemNameEn ?? noValue}</Text>,
        },
        {
            key: 'required',
            label: t('kitchen:ops.production.planRequired'),
            width: 96,
            priority: 90,
            mono: true,
            render: (line) => <Text variant="mono">{figure(line.required, line.unitCode)}</Text>,
        },
        {
            key: 'onHand',
            label: t('kitchen:ops.production.planOnHand'),
            width: 80,
            priority: 70,
            mono: true,
            render: (line) => <Text variant="mono">{figure(line.onHand)}</Text>,
        },
        {
            key: 'reserved',
            label: t('kitchen:ops.production.planReserved'),
            width: 136,
            priority: 60,
            mono: true,
            render: (line) => <Text variant="mono">{figure(line.reserved)}</Text>,
        },
        {
            key: 'available',
            label: t('kitchen:ops.production.planAvailable'),
            width: 80,
            priority: 80,
            mono: true,
            render: (line) => (
                <Text variant="mono" tone={Number(line.available) < 0 ? 'danger' : 'primary'}>
                    {figure(line.available)}
                </Text>
            ),
        },
        {
            key: 'missing',
            label: t('kitchen:ops.production.planMissing'),
            width: 80,
            priority: 95,
            mono: true,
            render: (line) => (
                <Text variant="mono" tone={Number(line.missing) > 0 ? 'danger' : 'primary'}>
                    {Number(line.missing) > 0 ? figure(line.missing) : noValue}
                </Text>
            ),
        },
        ...(costsVisible
            ? ([
                  {
                      key: 'lineCost',
                      label: t('kitchen:ops.production.columnUnitCost'),
                      width: 96,
                      priority: 50,
                      mono: true,
                      render: (line: ProductionPlanLine) => (
                          <Text variant="mono">
                              {line.estimatedUnitCostAmount === null ||
                              line.estimatedUnitCostAmount === undefined
                                  ? // Uncosted, never zero. A zero reads as free.
                                    noValue
                                  : formatMoney(
                                        formatter,
                                        Number(line.estimatedUnitCostAmount),
                                        knownCurrency(line.currencyCode),
                                    )}
                          </Text>
                      ),
                  },
              ] satisfies readonly DataListColumn<ProductionPlanLine>[])
            : []),
    ];

    return (
        <Stack space="md" testID={testID}>
            {headless ? null : (
                <Heading level={2}>{t('kitchen:ops.production.headingPlan')}</Heading>
            )}

            {plan.notComputable.length === 0 ? null : (
                <Callout
                    testID={`${testID}-holes`}
                    tone="warning"
                    role="alert"
                    title={t('kitchen:ops.production.planHolesTitle')}
                    body={t('kitchen:ops.production.planHolesBody')}
                >
                    <Stack space="none">
                        {plan.notComputable.map((hole) => (
                            <Text key={`${hole.reasonCode}:${hole.detail}`} variant="caption">
                                {hole.detail}
                            </Text>
                        ))}
                    </Stack>
                </Callout>
            )}

            {plan.ingredients.length === 0 ? null : (
                <Stack space="xs">
                    <Heading level={3}>
                        {t('kitchen:ops.production.planIngredientsHeading')}
                    </Heading>
                    <DataList<ProductionPlanLine>
                        testID={`${testID}-ingredients`}
                        label={t('kitchen:ops.production.planIngredientsHeading')}
                        columns={columns}
                        rows={plan.ingredients}
                        rowKey={(line) => String(line.stockItemId)}
                        density="sm"
                    />
                </Stack>
            )}

            {plan.packaging.length === 0 ? null : (
                <Stack space="xs">
                    <Heading level={3}>{t('kitchen:ops.production.planPackagingHeading')}</Heading>
                    <DataList<ProductionPlanLine>
                        testID={`${testID}-packaging`}
                        label={t('kitchen:ops.production.planPackagingHeading')}
                        columns={columns}
                        rows={plan.packaging}
                        rowKey={(line) => String(line.stockItemId)}
                        density="sm"
                    />
                </Stack>
            )}
        </Stack>
    );
}
