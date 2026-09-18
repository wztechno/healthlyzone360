import type { ProductionPlan, ProductionPlanLine } from '@healthy360/api-client/contracts';
import { Callout, Heading, Stack, Table, Text } from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { formatMoney, knownCurrency } from '../format.ts';

/**
 * What a batch would need, against what the shelves can actually give (PROD1).
 *
 * ```
 * ITEM                 REQUIRED   ON HAND   CLAIMED ELSEWHERE   AVAILABLE   MISSING
 * Flour, plain (kg)      8.0000   10.0000              8.0000      2.0000    6.0000
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
 * ## The holes are not rows and must never become zeroes
 *
 * `notComputable` is part of a recipe nobody could turn into a quantity. "Need nothing for that"
 * and "we could not work out what this needs" are opposite statements, and the only reason they
 * arrive apart is so a client cannot merge them by accident. They render as their own notice, above
 * the tables, where somebody has to read them before pressing Confirm.
 */

export interface BatchPlanPanelProps {
    readonly testID: string;
    readonly plan: ProductionPlan;
    readonly costsVisible: boolean;
}

export function BatchPlanPanel({ testID, plan, costsVisible }: BatchPlanPanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const noValue = t('kitchen:list.noValue');

    const quantity = (value: string, unitCode: string | null): string =>
        `${value}${unitCode === null ? '' : ` ${unitCode}`}`;

    const columns: readonly TableColumn<ProductionPlanLine>[] = [
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
                    {line.stockItemCode === null ? null : (
                        <Text variant="caption" tone="secondary" numberOfLines={1}>
                            {line.stockItemCode}
                        </Text>
                    )}
                </Stack>
            ),
        },
        {
            key: 'required',
            header: t('kitchen:ops.production.planRequired'),
            numeric: true,
            render: (line) => <Text variant="mono">{quantity(line.required, line.unitCode)}</Text>,
        },
        {
            key: 'onHand',
            header: t('kitchen:ops.production.planOnHand'),
            numeric: true,
            render: (line) => (
                <Text variant="mono" tone="secondary">
                    {line.onHand}
                </Text>
            ),
        },
        {
            key: 'reserved',
            header: t('kitchen:ops.production.planReserved'),
            numeric: true,
            render: (line) => (
                <Text variant="mono" tone="secondary">
                    {line.reserved}
                </Text>
            ),
        },
        {
            key: 'available',
            header: t('kitchen:ops.production.planAvailable'),
            numeric: true,
            render: (line) => (
                <Text variant="mono" tone={Number(line.available) < 0 ? 'danger' : 'primary'}>
                    {line.available}
                </Text>
            ),
        },
        {
            key: 'missing',
            header: t('kitchen:ops.production.planMissing'),
            numeric: true,
            primary: true,
            render: (line) => (
                <Text variant="mono" tone={Number(line.missing) > 0 ? 'danger' : 'secondary'}>
                    {line.missing}
                </Text>
            ),
        },
        ...(costsVisible
            ? ([
                  {
                      key: 'lineCost',
                      header: t('kitchen:ops.production.columnUnitCost'),
                      numeric: true,
                      render: (line: ProductionPlanLine) =>
                          line.estimatedUnitCostAmount === null ||
                          line.estimatedUnitCostAmount === undefined ? (
                              // Uncosted, never zero. A zero reads as free.
                              <Text variant="mono" tone="secondary">
                                  {noValue}
                              </Text>
                          ) : (
                              <Text variant="mono" tone="secondary">
                                  {formatMoney(
                                      formatter,
                                      Number(line.estimatedUnitCostAmount),
                                      knownCurrency(line.currencyCode),
                                  )}
                              </Text>
                          ),
                  },
              ] satisfies readonly TableColumn<ProductionPlanLine>[])
            : []),
    ];

    return (
        <Stack space="md" testID={testID}>
            <Heading level={2}>{t('kitchen:ops.production.headingPlan')}</Heading>

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

            {costsVisible ? <PlanEstimate testID={testID} plan={plan} /> : null}

            <Callout
                testID={`${testID}-shortages`}
                tone={plan.shortLineCount === 0 ? 'success' : 'warning'}
                title={
                    plan.shortLineCount === 0
                        ? t('kitchen:ops.production.planReady')
                        : t('kitchen:ops.production.planShort', { count: plan.shortLineCount })
                }
            />

            {plan.ingredients.length === 0 ? null : (
                <Stack space="sm">
                    <Heading level={3}>
                        {t('kitchen:ops.production.planIngredientsHeading')}
                    </Heading>
                    <Table<ProductionPlanLine>
                        testID={`${testID}-ingredients`}
                        caption={t('kitchen:ops.production.planIngredientsHeading')}
                        captionHidden
                        columns={columns}
                        rows={plan.ingredients}
                        rowKey={(line) => String(line.stockItemId)}
                    />
                </Stack>
            )}

            {plan.packaging.length === 0 ? null : (
                <Stack space="sm">
                    <Heading level={3}>{t('kitchen:ops.production.planPackagingHeading')}</Heading>
                    <Table<ProductionPlanLine>
                        testID={`${testID}-packaging`}
                        caption={t('kitchen:ops.production.planPackagingHeading')}
                        captionHidden
                        columns={columns}
                        rows={plan.packaging}
                        rowKey={(line) => String(line.stockItemId)}
                    />
                </Stack>
            )}
        </Stack>
    );
}

/**
 * What the batch is expected to cost, or why nobody can say.
 *
 * **Withheld rather than partial.** A total over the lines that happened to carry a price reads
 * exactly like a complete one and is *smaller*, which is the direction that gets a kitchen into
 * trouble — so an uncosted line or two currencies among the lines leaves the figure null with the
 * reason beside it. It blocks nothing: confirm does not consult cost at all, because a kitchen
 * about to cook is not refused over arithmetic nobody has finished.
 */
function PlanEstimate({
    testID,
    plan,
}: {
    readonly testID: string;
    readonly plan: ProductionPlan;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const amount = plan.estimatedCostAmount;
    const uncosted = plan.uncostedLineCount ?? 0;
    const conflict = plan.currencyConflict ?? false;

    return (
        <View className="flex-col gap-1" testID={`${testID}-estimate`}>
            <Text variant="caption" tone="secondary">
                {t('kitchen:ops.production.estimatedCost')}
            </Text>
            <Text variant="bodyStrong" testID={`${testID}-estimate-amount`}>
                {amount === null || amount === undefined
                    ? t('kitchen:list.noValue')
                    : formatMoney(formatter, Number(amount), knownCurrency(plan.currencyCode))}
            </Text>
            {conflict ? (
                <Text variant="caption" tone="warning" testID={`${testID}-estimate-conflict`}>
                    {t('kitchen:ops.production.currencyConflict')}
                </Text>
            ) : null}
            {uncosted > 0 ? (
                <Text variant="caption" tone="warning" testID={`${testID}-estimate-uncosted`}>
                    {t('kitchen:ops.production.uncostedLines', { count: uncosted })}
                </Text>
            ) : null}
        </View>
    );
}
