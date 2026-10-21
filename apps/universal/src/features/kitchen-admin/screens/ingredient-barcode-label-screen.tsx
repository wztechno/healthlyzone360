import { formatGtin } from '@healthy360/api-client/contracts';
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
import { IngredientId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useIngredientQuery } from '../../../data/kitchen-admin-hooks.ts';
import { useIngredientBarcodesQuery } from '../../../data/kitchen-ops-hooks.ts';
import { Ean13Barcode } from '../ean13-barcode.tsx';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { usePrintSheet } from '../print-sheet.tsx';
import { MAX_LABEL_COPIES } from '../production-desk/batch-figures.ts';

/**
 * `/kitchen/ingredients/{ingredient}/label` — the kitchen code's label, as many copies as asked
 * (ingredient barcodes, plan §8).
 *
 * ```
 * ┌──────────────────────────────┐
 * │ Basmati rice (decanted)      │  one line, ~3 mm, truncated
 * │ ▌▌▎▍▌▌▎▍▌▎▍▌▌▎▍▌▎▍▌▌▎▍▌▎▍▌   │  26 mm of bars
 * │ 0400000000015                │  the digits, ~3 mm
 * └──────────────────────────────┘
 * ```
 *
 * The production label's print sheet, copy clamp and 58 × 40 mm page, so one label stock is set up
 * once. The name follows the session language; the digits are isolated so an Arabic layout never
 * reorders them.
 */

export interface IngredientBarcodeLabelScreenProps {
    readonly ingredient?: string | undefined;
}

export function IngredientBarcodeLabelScreen({ ingredient }: IngredientBarcodeLabelScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-ingredient-label"
        >
            <IngredientBarcodeLabel ingredient={ingredient} />
        </Gate>
    );
}

function IngredientBarcodeLabel({ ingredient }: IngredientBarcodeLabelScreenProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const sheet = usePrintSheet();
    const [typedCopies, setTypedCopies] = useState('1');

    const parsed = ingredient === undefined ? null : IngredientId.safeParse(ingredient);
    const record = useIngredientQuery(parsed);
    const barcodes = useIngredientBarcodesQuery(parsed);
    const failure = toFailure(record.error ?? barcodes.error);

    if (parsed === null) {
        return (
            <EmptyState
                testID="kitchen-ingredient-label-not-found"
                title={t('kitchen:barcodes.labelNotFound')}
            />
        );
    }

    if (record.isPending || barcodes.isPending) {
        return <RecordSkeleton testID="kitchen-ingredient-label-loading" />;
    }

    if (failure !== null) {
        return (
            <ErrorState
                testID="kitchen-ingredient-label-error"
                title={t('kitchen:barcodes.labelLoadError')}
                failure={failure}
                onRetry={() => {
                    void record.refetch();
                    void barcodes.refetch();
                }}
                retrying={record.isFetching || barcodes.isFetching}
            />
        );
    }

    const kitchenCode = barcodes.data?.find((row) => row.origin === 'system');
    const backButton = (
        <Button
            testID="kitchen-ingredient-label-back"
            variant="secondary"
            label={t('kitchen:barcodes.backToIngredient')}
            onPress={() => {
                router.push(`/kitchen/ingredients/${String(parsed)}`);
            }}
        />
    );

    if (kitchenCode === undefined || record.data === undefined) {
        return (
            <Callout
                testID="kitchen-ingredient-label-nothing"
                tone="warning"
                role="alert"
                title={t('kitchen:barcodes.labelNone')}
                actions={backButton}
            />
        );
    }

    const name = record.data.name;
    const shownName = locale === 'ar' && name.ar !== '' ? name.ar : name.en;
    const digits = formatGtin(kitchenCode.gtin);
    const asked = Number(typedCopies.trim());
    const copies = Math.min(
        Math.max(Number.isInteger(asked) && asked > 0 ? asked : 1, 1),
        MAX_LABEL_COPIES,
    );

    return (
        <Stack space="lg" testID="kitchen-ingredient-label-screen">
            {/* Screen-only: the print block hides this whole block by test id. */}
            <Stack space="sm" testID="kitchen-ingredient-label-toolbar">
                <Heading level={1} testID="kitchen-ingredient-label-title">
                    {t('kitchen:barcodes.printLabel')}
                </Heading>
                <Inline space="sm" align="end" justify="between" wrap>
                    <View className="w-32">
                        <QuantityInput
                            testID="kitchen-ingredient-label-copies"
                            id="kitchen-ingredient-label-copies"
                            label={t('kitchen:ops.production.labelCopies')}
                            placeholder="1"
                            value={typedCopies}
                            onChangeText={setTypedCopies}
                        />
                    </View>
                    <Inline space="sm" align="center" wrap>
                        {backButton}
                        {sheet.mode === 'browser' ? (
                            <Button
                                testID="kitchen-ingredient-label-print"
                                label={t('kitchen:barcodes.printLabel')}
                                onPress={sheet.print}
                            />
                        ) : null}
                    </Inline>
                </Inline>
                {sheet.mode === 'browser' ? null : (
                    <Callout
                        testID="kitchen-ingredient-label-native-notice"
                        tone="info"
                        title={t('kitchen:ops.supplyOrders.print.nativeUnavailableTitle')}
                    />
                )}
            </Stack>

            {/* The copies and only the copies: the print block breaks the page after each one. */}
            <View testID="kitchen-ingredient-label-sheets" className="flex-row flex-wrap gap-4">
                {Array.from({ length: copies }, (_, index) => (
                    <View
                        key={index}
                        testID={`kitchen-ingredient-label-copy-${String(index + 1)}`}
                        className="items-center gap-1 rounded-lg border border-stroke-subtle bg-surface-raised p-2"
                    >
                        <Text
                            variant="bodyStrong"
                            numberOfLines={1}
                            testID={`kitchen-ingredient-label-copy-${String(index + 1)}-name`}
                        >
                            {shownName}
                        </Text>
                        <Ean13Barcode value={digits} />
                        <Text
                            variant="mono"
                            testID={`kitchen-ingredient-label-copy-${String(index + 1)}-digits`}
                        >
                            {`⁦${digits}⁩`}
                        </Text>
                    </View>
                ))}
            </View>
        </Stack>
    );
}
