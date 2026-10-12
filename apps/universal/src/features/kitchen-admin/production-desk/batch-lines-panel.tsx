import type { ProductionOrderLine } from '@healthy360/api-client/contracts';
import { Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { compareAmount, compareText } from '../catalogue/use-column-controls.tsx';
import { formatMoney, knownCurrency } from '../format.ts';
import { BATCH_QUANTITY_FORMAT } from '../operations/batch-sheet.tsx';
import { ledgerQuantity } from '../ops-format.ts';
import { orderedLines } from './completion-model.ts';
import { ProductionTable } from './production-table.tsx';

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
 *
 * Drawn as every production table is — {@link ProductionTable} — so a shelf reads the same here as
 * on the planner and the new batch's preview.
 */

export interface BatchLinesPanelProps {
    readonly testID: string;
    readonly lines: readonly ProductionOrderLine[];
    readonly costsVisible: boolean;
    /** The completion columns are noise on a batch that has not settled. */
    readonly withOutcome: boolean;
    /** No hairline over the section: the first in its column. */
    readonly first?: boolean | undefined;
}

type LineColumn = ControlledColumn<ProductionOrderLine, CatalogueColumn<ProductionOrderLine>>;

export function BatchLinesPanel({
    testID,
    lines,
    costsVisible,
    withOutcome,
    first = false,
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

    /** By the figure the wire sends, blanks last either way: "not yet" is not the smallest. */
    const byQuantity =
        (pick: (line: ProductionOrderLine) => string | null) =>
        (left: ProductionOrderLine, right: ProductionOrderLine, direction: 'asc' | 'desc') =>
            compareAmount(pick(left), pick(right), direction);

    const kindLabel = (kind: ProductionOrderLine['lineKind']): string =>
        t(
            kind === 'packaging'
                ? 'kitchen:ops.production.lineKindPackaging'
                : 'kitchen:ops.production.lineKindIngredient',
        );

    /** The settled figure once there is one, the estimate until then. */
    const unitCost = (line: ProductionOrderLine): string | null =>
        line.actualUnitCostAmount ?? line.estimatedUnitCostAmount ?? null;

    const columns: readonly LineColumn[] = [
        {
            key: 'item',
            role: 'title',
            label: t('kitchen:ops.production.columnItem'),
            width: 200,
            priority: 100,
            sort: (left, right, direction) =>
                compareText(left.stockItemNameEn, right.stockItemNameEn, direction),
            value: (line) => line.stockItemNameEn ?? noValue,
            // The name alone: a long one ends in an ellipsis and reads whole on hover.
            render: (line) => <Text variant="strong">{line.stockItemNameEn ?? noValue}</Text>,
        },
        {
            key: 'kind',
            role: 'meta',
            label: t('kitchen:ops.production.columnKind'),
            width: 104,
            priority: 40,
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((line) => line.lineKind))].map((kind) => ({
                        key: kind,
                        label: kindLabel(kind),
                    })),
                match: (line, value) => line.lineKind === value,
            },
            value: (line) => kindLabel(line.lineKind),
        },
        {
            key: 'required',
            role: 'meta',
            width: 104,
            label: t('kitchen:ops.production.planRequired'),
            priority: 90,
            mono: true,
            sort: byQuantity((line) => line.requiredQuantity),
            value: (line) => quantity(line.requiredQuantity, line.unitCode),
            render: (line) => (
                <Text variant="mono">{quantity(line.requiredQuantity, line.unitCode)}</Text>
            ),
        },
        {
            key: 'claimed',
            role: 'metric',
            width: 104,
            label: t('kitchen:ops.production.columnClaimed'),
            priority: 85,
            mono: true,
            sort: byQuantity((line) => line.reservedQuantity),
            value: (line) => quantity(line.reservedQuantity, line.unitCode),
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
                      sort: byQuantity((line) => line.consumedQuantity),
                      value: (line) => quantity(line.consumedQuantity, line.unitCode),
                      render: (line) => (
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
                      sort: byQuantity((line) => line.wasteQuantity),
                      value: (line) => quantity(line.wasteQuantity, line.unitCode),
                      render: (line) => (
                          <Text
                              variant="mono"
                              tone={Number(line.wasteQuantity ?? '0') > 0 ? 'danger' : 'secondary'}
                          >
                              {quantity(line.wasteQuantity, line.unitCode)}
                          </Text>
                      ),
                  },
              ] satisfies readonly LineColumn[])
            : []),
        ...(costsVisible
            ? ([
                  {
                      key: 'unitCost',
                      width: 104,
                      label: t('kitchen:ops.production.columnUnitCost'),
                      priority: 50,
                      mono: true,
                      sort: byQuantity(unitCost),
                      // An uncosted line is the em dash and never a zero: a zero reads as free,
                      // and a kitchen would price against it.
                      value: (line) => {
                          const amount = unitCost(line);

                          return amount === null
                              ? noValue
                              : formatMoney(
                                    formatter,
                                    Number(amount),
                                    knownCurrency(line.costCurrencyCode),
                                );
                      },
                      render: (line) => {
                          const amount = unitCost(line);

                          return (
                              <Text variant="mono" tone="secondary">
                                  {amount === null
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
              ] satisfies readonly LineColumn[])
            : []),
    ];

    return (
        <ProductionTable<ProductionOrderLine>
            first={first}
            sectionTestID={testID}
            testID={`${testID}-table`}
            title={t('kitchen:ops.production.headingLines')}
            aside={
                <Text variant="caption" tone="secondary">
                    {t('kitchen:ops.batch.lineCount', { count: rows.length })}
                </Text>
            }
            rows={rows}
            columns={columns}
            rowKey={(line) => line.id}
        />
    );
}

/** The shelf gave less than the batch asked for — a correction between planning and confirming. */
function isShortClaim(line: ProductionOrderLine): boolean {
    if (line.reservedQuantity === null) return false;

    return Number(line.reservedQuantity) < Number(line.requiredQuantity);
}
