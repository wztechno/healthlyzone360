import {
    Callout,
    EmptyState,
    ErrorState,
    FormSection,
    RecordSkeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import { ProductionOrderId } from '@healthy360/domain-types';
import { useLocalSearchParams } from 'expo-router';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useProductionTechnicalSheetQuery } from '../../../data/kitchen-ops-hooks.ts';
import { PRODUCTION_VIEW_PERMISSION } from '../entity-registry.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
import { BatchLinesPanel } from '../production-desk/batch-lines-panel.tsx';

import { DeskButton } from '../desk-kit/desk-button.tsx';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
/**
 * `/kitchen/production-desk/{order}/sheet` — what one batch stood on (PROD1).
 *
 * ## Two sheets, two questions, and they must never be read as one
 *
 * The **recipe's** technical sheet answers "what would this cost today". It is live, and it moves
 * when a weekly price is published or a formulation is edited — which is exactly what a person
 * costing next week's menu wants. This one answers "what did *that batch* stand on", reads only
 * what confirm snapshotted, and does not move at all.
 *
 * A publication id alone does not freeze that: it says nothing about which version supplied a
 * produced component, what fallback price a line fell back to, or what the version's nutrition said
 * at the time. The order stores each of those, and this reads them back. The two sheets are under
 * different headings and say so in words, because a reader who took one for the other would
 * reconstruct a margin that never existed.
 *
 * ## Nutrition is presented, never recomputed
 *
 * The block is the version's own, per 100 g, copied at confirm. Where the version **withheld** a
 * nutrient because an ingredient's data was incomplete, it stays withheld — a zero would say the
 * food contains none of it.
 */

export interface ProductionBatchSheetScreenProps {
    readonly order?: string | undefined;
}

export function ProductionBatchSheetScreen({ order }: ProductionBatchSheetScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [PRODUCTION_VIEW_PERMISSION] }}
            testID="kitchen-production-batch-sheet"
        >
            <ProductionBatchSheet order={order} />
        </Gate>
    );
}

function ProductionBatchSheet({ order }: ProductionBatchSheetScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const params = useLocalSearchParams<{ readonly returnTo?: string }>();
    const back = useReturnTo(
        params.returnTo,
        order === undefined ? '/kitchen/production-desk' : `/kitchen/production-desk/${order}`,
    );

    const parsed = order === undefined ? null : ProductionOrderId.safeParse(order);
    const record = useProductionTechnicalSheetQuery(parsed);

    const sheet = record.data;
    const failure = toFailure(record.error);
    const noValue = t('kitchen:list.noValue');

    if (parsed === null) {
        return (
            <EmptyState
                testID="kitchen-production-batch-sheet-not-found"
                title={t('kitchen:ops.production.notFoundTitle')}
                body={t('kitchen:ops.production.notFoundBody')}
            />
        );
    }

    if (record.isPending) {
        return <RecordSkeleton testID="kitchen-production-batch-sheet-loading" />;
    }

    if (failure !== null) {
        return (
            <ErrorState
                testID="kitchen-production-batch-sheet-error"
                title={t('kitchen:ops.production.loadErrorTitle')}
                failure={failure}
                onRetry={() => {
                    void record.refetch();
                }}
                retrying={record.isFetching}
            />
        );
    }

    if (sheet === undefined) {
        return (
            <EmptyState
                testID="kitchen-production-batch-sheet-not-found"
                title={t('kitchen:ops.production.notFoundTitle')}
                body={t('kitchen:ops.production.notFoundBody')}
            />
        );
    }

    const nutrition = Object.entries(sheet.nutritionFacts ?? {});

    return (
        <Stack space="lg" testID="kitchen-production-batch-sheet-screen">
            <KitchenPageHeader
                testID="kitchen-production-batch-sheet-header"
                title={t('kitchen:ops.production.sheetTitle')}
                subtitle={t('kitchen:ops.production.sheetSubtitle')}
                back={
                    <View className="flex-row">
                        <DeskButton
                            testID="kitchen-production-batch-sheet-back"
                            variant="ghost"
                            size="sm"
                            label={t('kitchen:ops.production.openBatch')}
                            onPress={() => {
                                back.leave();
                            }}
                        />
                    </View>
                }
            />

            {sheet.basis.confirmedAt === null ? (
                <EmptyState
                    testID="kitchen-production-batch-sheet-unconfirmed"
                    title={t('kitchen:ops.production.sheetUnconfirmedTitle')}
                    body={t('kitchen:ops.production.sheetUnconfirmedBody')}
                />
            ) : (
                <>
                    <Callout
                        testID="kitchen-production-batch-sheet-live-note"
                        tone="info"
                        title={t('kitchen:ops.production.sheetLive')}
                    />

                    <FormSection
                        first
                        variant="panel"
                        testID="kitchen-production-batch-sheet-basis"
                        title={t('kitchen:ops.production.sheetBasisHeading')}
                    >
                        <View className="flex-row flex-wrap gap-tight">
                            <SheetFigure
                                testID="kitchen-production-batch-sheet-confirmed"
                                label={t('kitchen:ops.production.confirmedAtLabel')}
                                value={formatter.formatDate(sheet.basis.confirmedAt, {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                })}
                            />
                            <SheetFigure
                                testID="kitchen-production-batch-sheet-publication"
                                label={t('kitchen:ops.production.sheetPublicationLabel')}
                                // Stated even without the costs code: *which* week priced a batch
                                // is not itself a price.
                                value={
                                    sheet.basis.weeklyPricePublicationId === null
                                        ? t('kitchen:ops.production.sheetPublicationNone')
                                        : t('kitchen:ops.production.sheetPublicationSet')
                                }
                            />
                        </View>
                    </FormSection>

                    <FormSection
                        first
                        variant="panel"
                        testID="kitchen-production-batch-sheet-yield"
                        title={t('kitchen:ops.production.headingYield')}
                    >
                        <View className="flex-row flex-wrap gap-tight">
                            <SheetFigure
                                testID="kitchen-production-batch-sheet-yield-planned"
                                label={t('kitchen:ops.production.yieldPlanned')}
                                value={sheet.yield.plannedQuantity ?? noValue}
                            />
                            <SheetFigure
                                testID="kitchen-production-batch-sheet-yield-produced"
                                label={t('kitchen:ops.production.yieldProduced')}
                                value={sheet.yield.producedQuantity ?? noValue}
                            />
                            <SheetFigure
                                testID="kitchen-production-batch-sheet-yield-rejected"
                                label={t('kitchen:ops.production.yieldRejected')}
                                value={sheet.yield.rejectedQuantity ?? noValue}
                            />
                            <SheetFigure
                                testID="kitchen-production-batch-sheet-yield-usable"
                                label={t('kitchen:ops.production.yieldUsable')}
                                value={sheet.yield.usableQuantity ?? noValue}
                            />
                            <SheetFigure
                                testID="kitchen-production-batch-sheet-yield-variance"
                                label={t('kitchen:ops.production.yieldVariance')}
                                value={sheet.yield.varianceQuantity ?? noValue}
                            />
                        </View>
                    </FormSection>

                    <BatchLinesPanel
                        testID="kitchen-production-batch-sheet-lines"
                        panel
                        lines={sheet.lines}
                        costsVisible={sheet.costsVisible}
                        withOutcome={sheet.yield.producedQuantity !== null}
                    />

                    <FormSection
                        first
                        variant="panel"
                        testID="kitchen-production-batch-sheet-nutrition"
                        title={t('kitchen:ops.production.sheetNutritionHeading')}
                    >
                        {nutrition.length === 0 ? (
                            <Text tone="secondary">
                                {t('kitchen:ops.production.sheetNutritionEmpty')}
                            </Text>
                        ) : (
                            <View className="flex-row flex-wrap gap-tight">
                                {nutrition.map(([nutrient, value]) => (
                                    <SheetFigure
                                        key={nutrient}
                                        testID={`kitchen-production-batch-sheet-nutrient-${nutrient}`}
                                        label={nutrient}
                                        // A withheld nutrient is an em dash. Rendering it as zero
                                        // would say the food contains none of it.
                                        value={
                                            value === null || value === undefined
                                                ? noValue
                                                : String(value)
                                        }
                                    />
                                ))}
                            </View>
                        )}
                    </FormSection>
                </>
            )}
        </Stack>
    );
}

function SheetFigure({
    testID,
    label,
    value,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
}) {
    return (
        // The board's figure tile: a quiet label over the value, on the sunken ground.
        <View className="min-w-32 flex-col gap-0.5 rounded-lg bg-surface-sunken px-snug py-tight">
            <Text variant="micro" tone="secondary" className="uppercase tracking-wide">
                {label}
            </Text>
            <Text variant="mono" className="font-bold" testID={testID} numberOfLines={1}>
                {value}
            </Text>
        </View>
    );
}
