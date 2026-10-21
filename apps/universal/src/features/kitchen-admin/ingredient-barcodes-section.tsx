import { formatGtin } from '@healthy360/api-client/contracts';
import type { ApiFailure, BarcodeScan, IngredientBarcode } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    FormSection,
    Icon,
    IconButton,
    Inline,
    ListItem,
    QuantityInput,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { IngredientId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { toFailure } from '../../data/hooks.ts';
import {
    useAddIngredientBarcodeMutation,
    useIngredientBarcodesQuery,
    useRemoveIngredientBarcodeMutation,
} from '../../data/kitchen-ops-hooks.ts';
import { barcodeFailureText } from './barcode-scan.ts';
import { CameraScanButton } from './camera-scan-button.tsx';
import { unitCodeLabel, unitShortKey } from './format.ts';

/**
 * An ingredient's barcodes (ingredient barcodes, plan §8): producer's codes and the one kitchen code.
 *
 * Writes immediately rather than through the editor's Save — a barcode is the kitchen's own row,
 * not a field of the ingredient — which is also why it works on a platform-library record whose own
 * fields are read-only, and on packaging, which reuses this editor.
 */
export interface IngredientBarcodesSectionProps {
    readonly ingredientId: IngredientId;
    /** The ingredient's default unit — what a pack size is counted in. */
    readonly defaultUnit: MeasureUnit;
    readonly canManage: boolean;
}

export function IngredientBarcodesSection({
    ingredientId,
    defaultUnit,
    canManage,
}: IngredientBarcodesSectionProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const barcodes = useIngredientBarcodesQuery(ingredientId);
    const add = useAddIngredientBarcodeMutation(ingredientId);
    const remove = useRemoveIngredientBarcodeMutation(ingredientId);

    const [code, setCode] = useState('');
    const [packQuantity, setPackQuantity] = useState('');
    const [failure, setFailure] = useState<ApiFailure | null>(null);

    const rows = barcodes.data ?? [];
    const hasKitchenCode = rows.some((row) => row.origin === 'system');
    const quantity = Number(packQuantity);
    const pack =
        packQuantity.trim() === '' || !Number.isFinite(quantity)
            ? {}
            : { packQuantity: quantity, packUnitCode: defaultUnit };

    const write = (request: Parameters<typeof add.mutate>[0]) => {
        setFailure(null);
        add.mutate(request, {
            onSuccess: () => {
                setCode('');
                setPackQuantity('');
            },
            onError: (error) => {
                setFailure(toFailure(error));
            },
        });
    };

    const link = (scan: BarcodeScan) => {
        if (scan.data.trim() === '') return;
        write({ origin: 'supplier', code: scan.data.trim(), symbology: scan.symbology, ...pack });
    };

    const packLabel = (row: IngredientBarcode): string | null =>
        row.packQuantity === null
            ? null
            : t('kitchen:barcodes.packSize', {
                  quantity: Number(row.packQuantity),
                  unit: unitCodeLabel(row.packUnitCode ?? '', t),
              });

    return (
        <FormSection
            variant="card"
            testID="kitchen-ingredient-barcodes"
            title={t('kitchen:barcodes.title')}
            description={t('kitchen:barcodes.description')}
            actions={
                canManage && !hasKitchenCode && barcodes.data !== undefined ? (
                    <Button
                        testID="kitchen-ingredient-barcode-generate"
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:barcodes.generate')}
                        disabled={add.isPending}
                        onPress={() => {
                            write({ origin: 'system' });
                        }}
                    />
                ) : undefined
            }
        >
            <Stack space="sm">
                {rows.length === 0 ? (
                    <Text
                        testID="kitchen-ingredient-barcodes-empty"
                        variant="caption"
                        tone="secondary"
                    >
                        {t('kitchen:barcodes.empty')}
                    </Text>
                ) : (
                    // Two field tracks and their gap: a code's badges and actions stay beside it
                    // instead of drifting to the far edge of a wide card.
                    <View className="max-w-[576px]">
                        {rows.map((row, index) => (
                            <ListItem
                                key={row.id}
                                testID={`kitchen-ingredient-barcode-${row.id}`}
                                // Digits stay left-to-right in an Arabic layout.
                                title={`\u2066${formatGtin(row.gtin)}\u2069`}
                                divider={index < rows.length - 1}
                                meta={
                                    <>
                                        <Badge
                                            variant="label"
                                            tone={row.origin === 'system' ? 'info' : 'neutral'}
                                            icon={null}
                                            label={t(
                                                row.origin === 'system'
                                                    ? 'kitchen:barcodes.originSystem'
                                                    : 'kitchen:barcodes.originSupplier',
                                            )}
                                        />
                                        {packLabel(row) === null ? null : (
                                            <Text variant="caption" tone="secondary">
                                                {packLabel(row)}
                                            </Text>
                                        )}
                                    </>
                                }
                                trailing={
                                    <Inline space="xs" align="center">
                                        {row.origin === 'system' ? (
                                            <Button
                                                testID={`kitchen-ingredient-barcode-${row.id}-print`}
                                                variant="quiet"
                                                size="sm"
                                                label={t('kitchen:barcodes.printLabel')}
                                                onPress={() => {
                                                    router.push(
                                                        `/kitchen/ingredients/${String(ingredientId)}/label`,
                                                    );
                                                }}
                                            />
                                        ) : null}
                                        {canManage ? (
                                            <IconButton
                                                testID={`kitchen-ingredient-barcode-${row.id}-remove`}
                                                variant="ghost"
                                                tone="danger"
                                                size="sm"
                                                label={t('kitchen:barcodes.remove')}
                                                icon={<Icon name="close" size="sm" />}
                                                disabled={remove.isPending}
                                                onPress={() => {
                                                    setFailure(null);
                                                    remove.mutate(row.id, {
                                                        onError: (error) => {
                                                            setFailure(toFailure(error));
                                                        },
                                                    });
                                                }}
                                            />
                                        ) : null}
                                    </Inline>
                                }
                            />
                        ))}
                    </View>
                )}

                {canManage ? (
                    <View className="z-auto flex-row flex-wrap items-end gap-tight">
                        <TextInputField
                            testID="kitchen-ingredient-barcode-code"
                            id="kitchen-ingredient-barcode-code"
                            size="sm"
                            className="w-field"
                            label={t('kitchen:barcodes.codeLabel')}
                            placeholder={t('kitchen:barcodes.codePlaceholder')}
                            value={code}
                            autoCorrect={false}
                            autoCapitalize="none"
                            blurOnSubmit={false}
                            onChangeText={setCode}
                            onSubmitEditing={() => {
                                link({ data: code, symbology: null });
                            }}
                            trailing={
                                <CameraScanButton
                                    testID="kitchen-ingredient-barcode-camera"
                                    onScan={link}
                                />
                            }
                        />
                        <QuantityInput
                            testID="kitchen-ingredient-barcode-pack"
                            id="kitchen-ingredient-barcode-pack"
                            size="sm"
                            label={t('kitchen:barcodes.packLabel')}
                            placeholder={t('kitchen:barcodes.packPlaceholder')}
                            unit={t(unitShortKey(defaultUnit))}
                            value={packQuantity}
                            onChangeText={setPackQuantity}
                        />
                        {/* Wrapped: `Button` pins itself `self-start`, which beats the row's
                            `items-end` and left it level with the labels, not the inputs. */}
                        <View>
                            <Button
                                testID="kitchen-ingredient-barcode-add"
                                size="sm"
                                label={t('kitchen:barcodes.add')}
                                loading={add.isPending}
                                disabled={add.isPending || code.trim() === ''}
                                onPress={() => {
                                    link({ data: code, symbology: null });
                                }}
                            />
                        </View>
                    </View>
                ) : null}

                {failure === null ? null : (
                    <Callout
                        testID="kitchen-ingredient-barcode-error"
                        role="alert"
                        tone="danger"
                        title={t('kitchen:barcodes.refusedTitle')}
                        body={barcodeFailureText(t, failure, locale) ?? ''}
                    />
                )}
            </Stack>
        </FormSection>
    );
}
