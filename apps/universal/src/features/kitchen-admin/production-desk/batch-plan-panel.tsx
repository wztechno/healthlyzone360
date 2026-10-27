import type { ProductionPlan, ProductionPlanLine } from '@healthy360/api-client/contracts';
import { Callout, Stack, Text, useIssueGroup } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { compareAmount, compareText } from '../catalogue/use-column-controls.tsx';
import { formatMoney, knownCurrency } from '../format.ts';
import { BATCH_QUANTITY_FORMAT } from '../operations/batch-sheet.tsx';
import { ledgerQuantity } from '../ops-format.ts';
import { ProductionTable } from './production-table.tsx';

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
 * arrive apart is so a client cannot merge them by accident. They are their own card in the page's
 * issue tray, under "Check", where somebody has to read them before pressing Confirm — or their own
 * notice above the tables, on a page without a tray.
 *
 * How many shelves are short, and what the batch is estimated to cost, are the page's to state —
 * in its figures and its cost card — so this panel is the tables and nothing that repeats them.
 * Each is a {@link ProductionTable}, the shape the planner's own Ingredients and Packaging take.
 */

export interface BatchPlanPanelProps {
    readonly testID: string;
    readonly plan: ProductionPlan;
    readonly costsVisible: boolean;
    /** No hairline over the first section: the first in its column. */
    readonly first?: boolean | undefined;
}

type PlanColumn = ControlledColumn<ProductionPlanLine, CatalogueColumn<ProductionPlanLine>>;

export function BatchPlanPanel({ testID, plan, costsVisible, first = false }: BatchPlanPanelProps) {
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

    const byFigure =
        (pick: (line: ProductionPlanLine) => string | null | undefined) =>
        (left: ProductionPlanLine, right: ProductionPlanLine, direction: 'asc' | 'desc') =>
            compareAmount(pick(left) ?? null, pick(right) ?? null, direction);

    const missing = (line: ProductionPlanLine): string =>
        Number(line.missing) > 0 ? figure(line.missing) : noValue;

    const unitCost = (line: ProductionPlanLine): string =>
        line.estimatedUnitCostAmount === null || line.estimatedUnitCostAmount === undefined
            ? // Uncosted, never zero. A zero reads as free.
              noValue
            : formatMoney(
                  formatter,
                  Number(line.estimatedUnitCostAmount),
                  knownCurrency(line.currencyCode),
              );

    const columns: readonly PlanColumn[] = [
        {
            key: 'item',
            role: 'title',
            label: t('kitchen:ops.production.columnItem'),
            width: 160,
            priority: 100,
            sort: (left, right, direction) =>
                compareText(left.stockItemNameEn, right.stockItemNameEn, direction),
            value: (line) => line.stockItemNameEn ?? noValue,
            // The name alone. A long one ends in an ellipsis and reads whole on hover; the shelf's
            // code is a key for the ledger, not something a cook reads down a column.
            render: (line) => <Text variant="strong">{line.stockItemNameEn ?? noValue}</Text>,
        },
        {
            key: 'required',
            role: 'meta',
            label: t('kitchen:ops.production.planRequired'),
            width: 96,
            priority: 90,
            mono: true,
            sort: byFigure((line) => line.required),
            value: (line) => figure(line.required, line.unitCode),
            render: (line) => <Text variant="mono">{figure(line.required, line.unitCode)}</Text>,
        },
        {
            key: 'onHand',
            label: t('kitchen:ops.production.planOnHand'),
            width: 80,
            priority: 70,
            mono: true,
            sort: byFigure((line) => line.onHand),
            value: (line) => figure(line.onHand),
            render: (line) => <Text variant="mono">{figure(line.onHand)}</Text>,
        },
        {
            key: 'reserved',
            label: t('kitchen:ops.production.planReserved'),
            width: 136,
            priority: 60,
            mono: true,
            sort: byFigure((line) => line.reserved),
            value: (line) => figure(line.reserved),
            render: (line) => <Text variant="mono">{figure(line.reserved)}</Text>,
        },
        {
            key: 'available',
            label: t('kitchen:ops.production.planAvailable'),
            width: 80,
            priority: 80,
            mono: true,
            sort: byFigure((line) => line.available),
            value: (line) => figure(line.available),
            render: (line) => (
                <Text variant="mono" tone={Number(line.available) < 0 ? 'danger' : 'primary'}>
                    {figure(line.available)}
                </Text>
            ),
        },
        {
            key: 'missing',
            role: 'metric',
            label: t('kitchen:ops.production.planMissing'),
            width: 80,
            priority: 95,
            mono: true,
            sort: byFigure((line) => line.missing),
            value: missing,
            render: (line) => (
                <Text variant="mono" tone={Number(line.missing) > 0 ? 'danger' : 'primary'}>
                    {missing(line)}
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
                      sort: byFigure((line) => line.estimatedUnitCostAmount),
                      value: unitCost,
                      render: (line) => <Text variant="mono">{unitCost(line)}</Text>,
                  },
              ] satisfies readonly PlanColumn[])
            : []),
    ];

    const lineCount = (count: number) => (
        <Text variant="caption" tone="secondary">
            {t('kitchen:ops.batch.lineCount', { count })}
        </Text>
    );

    // "Live, nothing claimed yet" belongs to the plan as a whole: behind the first table's (i).
    const liveCaption = t('kitchen:ops.production.planLiveCaption');

    // Registered empty too, so the card goes once the plan has no holes left.
    const inTray = useIssueGroup({
        key: 'check',
        title: t('kitchen:tray.groupCheck'),
        items:
            plan.notComputable.length === 0
                ? []
                : [
                      {
                          key: 'plan-holes',
                          tone: 'warning',
                          label: t('kitchen:ops.production.planHolesTitle'),
                          // The server's own words for each hole, one to a line.
                          detail: plan.notComputable.map((hole) => hole.detail).join('\n'),
                          testID: `${testID}-holes`,
                      },
                  ],
    });

    return (
        <Stack space="md" testID={testID}>
            {inTray || plan.notComputable.length === 0 ? null : (
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
                <ProductionTable<ProductionPlanLine>
                    first={first}
                    testID={`${testID}-ingredients`}
                    title={t('kitchen:ops.production.planIngredientsHeading')}
                    aside={lineCount(plan.ingredients.length)}
                    description={liveCaption}
                    rows={plan.ingredients}
                    columns={columns}
                    rowKey={(line) => String(line.stockItemId)}
                />
            )}

            {plan.packaging.length === 0 ? null : (
                <ProductionTable<ProductionPlanLine>
                    first={first && plan.ingredients.length === 0}
                    testID={`${testID}-packaging`}
                    title={t('kitchen:ops.production.planPackagingHeading')}
                    aside={lineCount(plan.packaging.length)}
                    description={plan.ingredients.length === 0 ? liveCaption : undefined}
                    rows={plan.packaging}
                    columns={columns}
                    rowKey={(line) => String(line.stockItemId)}
                />
            )}
        </Stack>
    );
}
