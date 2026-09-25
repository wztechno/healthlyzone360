import type { ProductionOrder } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    QuantityInput,
    RecordSkeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import { ProductionOrderId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { isMeasureUnit } from '@healthy360/nutrition';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useProductionOrderQuery } from '../../../data/kitchen-ops-hooks.ts';
import { PRODUCTION_VIEW_PERMISSION } from '../entity-registry.ts';
import { unitShortKey } from '../format.ts';
import { usePrintSheet } from '../print-sheet.tsx';
import { formatLot, labelCopies } from '../production-desk/batch-figures.ts';
import { Gs1Barcode } from '../production-desk/gs1-barcode.tsx';

/**
 * `/kitchen/production-desk/{order}/label` — the batch's label, as many copies as it needs.
 *
 * ```
 * ┌──────────────────────────────────────┐
 * │ Caesar dressing  صلصة سيزر           │
 * │ Lot 260925-007-7                     │
 * │ Made on 25 Sep 2026  Use by 30 Sep   │
 * │ ▌▌▎▍▌▌▎▍▌▎▍▌▌▎▍▌▎▍▌▌▎▍▌▎▍▌▌▎▍▌▎▍    │
 * │ (11)260925(17)260930(10)2609250077   │
 * │ Batch of 20 L  Main Kitchen  PB-…    │
 * └──────────────────────────────────────┘
 * ```
 *
 * The supply-order print route's shape, for the same reason it is a route (`window.print()` prints
 * the document): a toolbar the print CSS hides, and a box holding **only** the copies, each of which
 * the print block puts on its own 58 × 40 mm page. Nothing opens the print dialog by itself (D-103);
 * native renders the preview and says printing lives on the web.
 *
 * The GS1 line is wrapped in LRI…PDI isolates so an Arabic session does not reorder the parentheses
 * and digits — the printed text has to match what the bars encode, character for character.
 */

export interface ProductionBatchLabelScreenProps {
    readonly order?: string | undefined;
}

export function ProductionBatchLabelScreen({ order }: ProductionBatchLabelScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [PRODUCTION_VIEW_PERMISSION] }}
            testID="kitchen-production-label"
        >
            <ProductionBatchLabel order={order} />
        </Gate>
    );
}

function ProductionBatchLabel({ order }: ProductionBatchLabelScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const sheet = usePrintSheet();

    const parsed = order === undefined ? null : ProductionOrderId.safeParse(order);
    const record = useProductionOrderQuery(parsed);
    /** What was typed into Copies; `null` until somebody types, which means "the default". */
    const [typedCopies, setTypedCopies] = useState<string | null>(null);

    const detail = record.data;
    const failure = toFailure(record.error);

    if (parsed === null) {
        return (
            <EmptyState
                testID="kitchen-production-label-not-found"
                title={t('kitchen:ops.production.notFoundTitle')}
                body={t('kitchen:ops.production.notFoundBody')}
            />
        );
    }

    if (record.isPending) {
        return <RecordSkeleton testID="kitchen-production-label-loading" />;
    }

    if (failure !== null) {
        return (
            <ErrorState
                testID="kitchen-production-label-error"
                title={t('kitchen:ops.production.loadErrorTitle')}
                failure={failure}
                onRetry={() => {
                    void record.refetch();
                }}
                retrying={record.isFetching}
            />
        );
    }

    if (detail === undefined) {
        return (
            <EmptyState
                testID="kitchen-production-label-not-found"
                title={t('kitchen:ops.production.notFoundTitle')}
                body={t('kitchen:ops.production.notFoundBody')}
            />
        );
    }

    const batch = detail.order;
    // Held as locals so the narrowing below survives into the copies' closure.
    const lot = batch.lotNumber;
    const barcode = batch.barcode;

    const backButton = (
        <Button
            testID="kitchen-production-label-back"
            variant="secondary"
            label={t('kitchen:ops.production.openBatch')}
            onPress={() => {
                router.push(`/kitchen/production-desk/${String(batch.id)}`);
            }}
        />
    );

    // A lot is minted only when a settlement put usable units on a shelf; before that, and on a
    // batch that made nothing, there is no label to print.
    if (lot === null || barcode === null) {
        return (
            <Stack space="lg" testID="kitchen-production-label-screen">
                <Callout
                    testID="kitchen-production-label-nothing"
                    tone="warning"
                    role="alert"
                    title={t('kitchen:ops.supplyOrders.print.nothingToPrintTitle')}
                    actions={backButton}
                />
            </Stack>
        );
    }

    const copies = labelCopies(batch, typedCopies);

    return (
        <Stack space="lg" testID="kitchen-production-label-screen">
            {/* Screen-only: the print block hides this whole block by test id. */}
            <Stack space="sm" testID="kitchen-production-label-toolbar">
                <Heading level={1} testID="kitchen-production-label-title">
                    {t('kitchen:ops.production.printLabel')}
                </Heading>

                <Inline space="sm" align="end" justify="between" wrap>
                    <View className="w-32">
                        <QuantityInput
                            testID="kitchen-production-label-copies"
                            id="kitchen-production-label-copies"
                            label={t('kitchen:ops.production.labelCopies')}
                            value={typedCopies ?? String(copies)}
                            onChangeText={setTypedCopies}
                        />
                    </View>

                    <Inline space="sm" align="center" wrap>
                        {backButton}
                        {sheet.mode === 'browser' ? (
                            <Button
                                testID="kitchen-production-label-print"
                                label={t('kitchen:ops.production.printLabel')}
                                onPress={sheet.print}
                            />
                        ) : null}
                    </Inline>
                </Inline>

                {sheet.mode === 'browser' ? null : (
                    <Callout
                        testID="kitchen-production-label-native-notice"
                        tone="info"
                        title={t('kitchen:ops.supplyOrders.print.nativeUnavailableTitle')}
                    />
                )}
            </Stack>

            {/*
             * The copies and **only** the copies are children of this box: the print block breaks
             * the page after each one and cancels it on `:last-child`.
             */}
            <View testID="kitchen-production-label-sheets" className="flex-row flex-wrap gap-4">
                {Array.from({ length: copies }, (_, index) => (
                    <LabelCopy
                        key={index}
                        testID={`kitchen-production-label-copy-${String(index + 1)}`}
                        batch={batch}
                        lot={lot}
                        barcode={barcode}
                    />
                ))}
            </View>
        </Stack>
    );
}

function LabelCopy({
    testID,
    batch,
    lot,
    barcode,
}: {
    readonly testID: string;
    readonly batch: ProductionOrder;
    readonly lot: string;
    readonly barcode: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const noValue = t('kitchen:list.noValue');

    // A `YYYY-MM-DD` parses as UTC midnight, so it is formatted in UTC or it lands a day early west
    // of Greenwich.
    const day = (iso: string) =>
        formatter.formatDate(iso, { dateStyle: 'medium', timeZone: 'UTC' });

    const unitCode = batch.plannedYieldUnitCode;
    const unit =
        unitCode === null ? '' : isMeasureUnit(unitCode) ? t(unitShortKey(unitCode)) : unitCode;
    const nameAr =
        batch.productionItemNameAr !== null &&
        batch.productionItemNameAr !== batch.productionItemNameEn
            ? batch.productionItemNameAr
            : null;

    return (
        <View
            testID={testID}
            className="w-56 gap-1 rounded-lg border border-stroke-subtle bg-surface-raised p-2"
        >
            <View className="flex-row flex-wrap gap-x-2">
                <Text variant="bodyStrong" testID={`${testID}-name`}>
                    {batch.productionItemNameEn ?? noValue}
                </Text>
                {nameAr === null ? null : (
                    <Text variant="bodyStrong" testID={`${testID}-name-ar`}>
                        {nameAr}
                    </Text>
                )}
            </View>

            <View className="flex-row gap-x-1">
                <Text variant="caption">{t('kitchen:ops.production.lotLabel')}</Text>
                <Text variant="mono" testID={`${testID}-lot`}>
                    {formatLot(lot)}
                </Text>
            </View>

            <View testID={`${testID}-dates`} className="flex-row flex-wrap justify-between gap-x-2">
                <View className="flex-row gap-x-1">
                    <Text variant="caption">{t('kitchen:ops.production.productionDateLabel')}</Text>
                    <Text variant="bodyStrong" testID={`${testID}-made`}>
                        {batch.productionDate === null ? noValue : day(batch.productionDate)}
                    </Text>
                </View>
                <View className="flex-row gap-x-1">
                    <Text variant="caption">{t('kitchen:ops.production.expiryDateLabel')}</Text>
                    <Text variant="bodyStrong" testID={`${testID}-use-by`}>
                        {batch.expiryDate === null
                            ? t('kitchen:ops.production.noExpiry')
                            : day(batch.expiryDate)}
                    </Text>
                </View>
            </View>

            <Gs1Barcode value={barcode} />
            <Text variant="mono" testID={`${testID}-hri`}>
                {`\u2066${barcode}\u2069`}
            </Text>

            <View className="flex-row flex-wrap gap-x-2">
                {batch.usableYieldQuantity === null ? null : (
                    <Text variant="caption" testID={`${testID}-batch-of`}>
                        {t('kitchen:ops.production.labelBatchOf', {
                            quantity: formatter.formatNumber(Number(batch.usableYieldQuantity)),
                            unit,
                        })}
                    </Text>
                )}
                {batch.branchName === null ? null : (
                    <Text variant="caption" testID={`${testID}-branch`}>
                        {batch.branchName}
                    </Text>
                )}
                {batch.reference === null ? null : (
                    <Text variant="mono" testID={`${testID}-reference`}>
                        {batch.reference}
                    </Text>
                )}
            </View>
        </View>
    );
}
