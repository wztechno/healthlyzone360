import type { ProductionOrderLine } from '@healthy360/api-client/contracts';
import { DataList, Heading, Stack, Text } from '@healthy360/design-system';
import type { DataListColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { formatMoney, knownCurrency } from '../format.ts';
import { BATCH_QUANTITY_FORMAT } from '../operations/batch-sheet.tsx';
import { ledgerQuantity } from '../ops-format.ts';
import { orderedLines } from './completion-model.ts';

/**
 * What a batch claimed and what it actually took (PROD1).
 *
 * ```
 * ITEM                      CLAIMED   USED    WASTED   UNIT COST
 * Flour, plain (kg)          8.0000  7.6000   0.5000        2.10
 * Tray, 1 kg (pcs)          40.0000 40.0000        —        0.35
 * ```
 *
 * ## Used and wasted are two columns because they are two movements
 *
 * The shelf fell by their **sum**, as a `consume` and a `waste` with different reasons: what went
 * into the batch is the cost of the food, and what went on the floor is a loss. One "taken" column
 * would add them, which is arithmetically right and puts the loss into the batch's unit cost, where
 * the monthly report reads it as the price of the food.
 *
 * ## Claimed can be below required, and that is the interesting row
 *
 * `reservedQuantity` is what the shelf could actually give at confirm. Where a physical correction
 * left it short it is below `requiredQuantity`, and a cook needs to see that before they start
 * rather than discover it at the mixer.
 */

export interface BatchLinesPanelProps {
    readonly testID: string;
    readonly lines: readonly ProductionOrderLine[];
    readonly costsVisible: boolean;
    /** The completion columns are noise on a batch that has not settled. */
    readonly withOutcome: boolean;
    /** Leave the heading to a card title that already says it. */
    readonly headless?: boolean | undefined;
}

export function BatchLinesPanel({
    testID,
    lines,
    costsVisible,
    withOutcome,
    headless = false,
}: BatchLinesPanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const rows = orderedLines(lines);
    const noValue = t('kitchen:list.noValue');

    /** A quantity with its unit, or the em dash. Never a bare zero standing in for "not yet". */
    const quantity = (value: string | null, unitCode: string | null): string =>
        ledgerQuantity(
            (parsed) => formatter.formatNumber(parsed, BATCH_QUANTITY_FORMAT),
            value,
            unitCode,
            noValue,
        );

    const columns: readonly DataListColumn<ProductionOrderLine>[] = [
        {
            key: 'item',
            label: t('kitchen:ops.production.columnItem'),
            width: 200,
            priority: 100,
            // The name alone: a long one ends in an ellipsis and reads whole on hover.
            render: (line) => <Text variant="strong">{line.stockItemNameEn ?? noValue}</Text>,
        },
        {
            key: 'kind',
            label: t('kitchen:ops.production.columnKind'),
            width: 104,
            priority: 40,
            value: (line) =>
                t(
                    line.lineKind === 'packaging'
                        ? 'kitchen:ops.production.lineKindPackaging'
                        : 'kitchen:ops.production.lineKindIngredient',
                ),
        },
        {
            key: 'required',
            width: 104,
            label: t('kitchen:ops.production.planRequired'),
            priority: 90,
            mono: true,
            render: (line) => (
                <Text variant="mono">{quantity(line.requiredQuantity, line.unitCode)}</Text>
            ),
        },
        {
            key: 'claimed',
            width: 104,
            label: t('kitchen:ops.production.columnClaimed'),
            priority: 85,
            mono: true,
            render: (line) => (
                <Text
                    variant="mono"
                    // Below what the batch needs is the row a cook must not miss, so it carries the
                    // warning ink as well as the smaller number — colour is never alone.
                    tone={isShortClaim(line) ? 'warning' : 'secondary'}
                >
                    {quantity(line.reservedQuantity, line.unitCode)}
                </Text>
            ),
        },
        ...(withOutcome
            ? ([
                  {
                      key: 'used',
                      width: 104,
                      label: t('kitchen:ops.production.columnUsed'),
                      priority: 95,
                      mono: true,
                      render: (line: ProductionOrderLine) => (
                          <Text variant="mono">
                              {quantity(line.consumedQuantity, line.unitCode)}
                          </Text>
                      ),
                  },
                  {
                      key: 'wasted',
                      width: 104,
                      label: t('kitchen:ops.production.columnWasted'),
                      priority: 80,
                      mono: true,
                      render: (line: ProductionOrderLine) => (
                          <Text
                              variant="mono"
                              tone={Number(line.wasteQuantity ?? '0') > 0 ? 'danger' : 'secondary'}
                          >
                              {quantity(line.wasteQuantity, line.unitCode)}
                          </Text>
                      ),
                  },
              ] satisfies readonly DataListColumn<ProductionOrderLine>[])
            : []),
        ...(costsVisible
            ? ([
                  {
                      key: 'unitCost',
                      width: 104,
                      label: t('kitchen:ops.production.columnUnitCost'),
                      priority: 50,
                      mono: true,
                      render: (line: ProductionOrderLine) => {
                          // The settled figure once there is one, the estimate until then. An
                          // uncosted line is the em dash and never a zero: a zero reads as free,
                          // and a kitchen would price against it.
                          const amount = line.actualUnitCostAmount ?? line.estimatedUnitCostAmount;

                          return (
                              <Text variant="mono" tone="secondary">
                                  {amount === null || amount === undefined
                                      ? noValue
                                      : formatMoney(
                                            formatter,
                                            Number(amount),
                                            knownCurrency(line.costCurrencyCode),
                                        )}
                              </Text>
                          );
                      },
                  },
              ] satisfies readonly DataListColumn<ProductionOrderLine>[])
            : []),
    ];

    return (
        <Stack space="sm" testID={testID}>
            {headless ? null : (
                <Heading level={2}>{t('kitchen:ops.production.headingLines')}</Heading>
            )}
            <DataList<ProductionOrderLine>
                testID={`${testID}-table`}
                label={t('kitchen:ops.production.headingLines')}
                columns={columns}
                rows={rows}
                rowKey={(line) => line.id}
                density="sm"
            />
        </Stack>
    );
}

/** The shelf gave less than the batch asked for — a correction between planning and confirming. */
function isShortClaim(line: ProductionOrderLine): boolean {
    if (line.reservedQuantity === null) return false;

    return Number(line.reservedQuantity) < Number(line.requiredQuantity);
}
