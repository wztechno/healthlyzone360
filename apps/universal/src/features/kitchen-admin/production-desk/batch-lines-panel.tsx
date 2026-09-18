import type { ProductionOrderLine } from '@healthy360/api-client/contracts';
import { Heading, Stack, Table, Text } from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { formatMoney, knownCurrency } from '../format.ts';
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
}

export function BatchLinesPanel({
    testID,
    lines,
    costsVisible,
    withOutcome,
}: BatchLinesPanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const rows = orderedLines(lines);
    const noValue = t('kitchen:list.noValue');

    /** A quantity with its unit, or the em dash. Never a bare zero standing in for "not yet". */
    const quantity = (value: string | null, unitCode: string | null): string =>
        value === null ? noValue : `${value}${unitCode === null ? '' : ` ${unitCode}`}`;

    const columns: readonly TableColumn<ProductionOrderLine>[] = [
        {
            key: 'item',
            header: t('kitchen:ops.production.columnItem'),
            rowHeader: true,
            flex: 3,
            render: (line) => (
                <Stack space="none">
                    <Text variant="bodyStrong" numberOfLines={1}>
                        {line.stockItemNameEn ?? noValue}
                    </Text>
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                        {t(
                            line.lineKind === 'packaging'
                                ? 'kitchen:ops.production.lineKindPackaging'
                                : 'kitchen:ops.production.lineKindIngredient',
                        )}
                        {line.stockItemCode === null ? '' : ` · ${line.stockItemCode}`}
                    </Text>
                </Stack>
            ),
        },
        {
            key: 'required',
            header: t('kitchen:ops.production.planRequired'),
            numeric: true,
            render: (line) => (
                <Text variant="mono">{quantity(line.requiredQuantity, line.unitCode)}</Text>
            ),
        },
        {
            key: 'claimed',
            header: t('kitchen:ops.production.columnClaimed'),
            numeric: true,
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
                      header: t('kitchen:ops.production.columnUsed'),
                      numeric: true,
                      primary: true,
                      render: (line: ProductionOrderLine) => (
                          <Text variant="mono">
                              {quantity(line.consumedQuantity, line.unitCode)}
                          </Text>
                      ),
                  },
                  {
                      key: 'wasted',
                      header: t('kitchen:ops.production.columnWasted'),
                      numeric: true,
                      render: (line: ProductionOrderLine) => (
                          <Text
                              variant="mono"
                              tone={Number(line.wasteQuantity ?? '0') > 0 ? 'danger' : 'secondary'}
                          >
                              {quantity(line.wasteQuantity, line.unitCode)}
                          </Text>
                      ),
                  },
              ] satisfies readonly TableColumn<ProductionOrderLine>[])
            : []),
        ...(costsVisible
            ? ([
                  {
                      key: 'unitCost',
                      header: t('kitchen:ops.production.columnUnitCost'),
                      numeric: true,
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
              ] satisfies readonly TableColumn<ProductionOrderLine>[])
            : []),
    ];

    return (
        <Stack space="sm" testID={testID}>
            <Heading level={2}>{t('kitchen:ops.production.headingLines')}</Heading>
            <Table<ProductionOrderLine>
                testID={`${testID}-table`}
                caption={t('kitchen:ops.production.headingLines')}
                captionHidden
                columns={columns}
                rows={rows}
                rowKey={(line) => line.id}
            />
        </Stack>
    );
}

/** The shelf gave less than the batch asked for — a correction between planning and confirming. */
function isShortClaim(line: ProductionOrderLine): boolean {
    if (line.reservedQuantity === null) return false;

    return Number(line.reservedQuantity) < Number(line.requiredQuantity);
}
