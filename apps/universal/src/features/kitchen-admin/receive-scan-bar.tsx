import type { ApiFailure, BarcodeScan, StockItem } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Dialog,
    QuantityInput,
    Select,
    Stack,
    TextInputField,
    useIssueGroup,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { isMeasureUnit } from '@healthy360/nutrition';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toFailure } from '../../data/hooks.ts';
import {
    useLinkIngredientBarcodeMutation,
    useResolveBarcodeScan,
} from '../../data/kitchen-ops-hooks.ts';
import { barcodeFailureText, shelfForIngredient, unlinkedScanMessage } from './barcode-scan.ts';
import { CameraScanButton } from './camera-scan-button.tsx';
import { focusField } from './field-focus.ts';
import { unitShortKey } from './format.ts';
import type { ScannedPack } from './receive-delivery-model.ts';

/**
 * The scan field both receive screens put above their lines (ingredient barcodes, plan §8).
 *
 * A keyboard-wedge scanner types into it and presses Enter; the camera button reads the same way.
 * A scan that resolves to a shelf is handed to the screen as a {@link ScannedPack}, which lands it
 * on a row through `applyScan`. A readable code nobody has linked opens **Link this barcode** — the
 * receiver links it to an ingredient on the spot and the scan runs again. A retired kitchen label
 * and a weighed-item label each say what they are instead.
 *
 * What the last scan has to say is a card in the page's issue tray, under "Check" — it is about the
 * process, not about the field — and it is live: the next scan replaces it, and the screen stops
 * passing its notice once the fix lands. Without a tray around it, the bar draws it under itself.
 */
export interface ReceiveScanBarProps {
    readonly testID: string;
    /** The kitchen's shelves — where a scan lands, and what an unknown code can be linked to. */
    readonly stockItems: readonly StockItem[];
    readonly onScanned: (pack: ScannedPack) => void;
    /** What the screen has to say about the last scan it placed — a lot kept apart, a pack to type. */
    readonly notice?: ScanNotice | null | undefined;
}

/** The screen's word on the last scan it placed, and the row it is about. */
export interface ScanNotice {
    readonly text: string;
    /** `warning` while something is left to do (a quantity to type); `info` for a plain fact. */
    readonly tone: 'warning' | 'info';
    /** The control the card's Fix takes the reader to — the row the scan landed on. */
    readonly fieldId?: string | undefined;
}

/** Where the last scan landed, when its placement had something to say (`applyScan`'s flags). */
export interface PlacedScan {
    readonly kind: 'keptApart' | 'typeQuantity';
    /** The row it landed on. */
    readonly key: string;
    /** That row's quantity once the scan landed: typing another is the fix a pack with no size needs. */
    readonly quantity: string;
}

/**
 * What a placed scan still has to say, read off the rows as they are now: nothing once its row is
 * gone, and nothing about a quantity once one has been typed. A lot kept apart is a fact, said until
 * the next scan.
 */
export function placedScanNotice(
    placed: PlacedScan | null,
    lines: readonly { readonly key: string; readonly quantity: string }[],
    t: TFunction,
    quantityFieldId: (key: string) => string,
): ScanNotice | null {
    if (placed === null) return null;
    const line = lines.find((candidate) => candidate.key === placed.key);
    if (line === undefined) return null;
    if (placed.kind === 'keptApart') {
        return {
            text: t('kitchen:barcodes.keptApart'),
            tone: 'info',
            fieldId: quantityFieldId(line.key),
        };
    }
    return line.quantity === placed.quantity
        ? {
              text: t('kitchen:barcodes.typeQuantity'),
              tone: 'warning',
              fieldId: quantityFieldId(line.key),
          }
        : null;
}

export function ReceiveScanBar({ testID, stockItems, onScanned, notice }: ReceiveScanBarProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const resolveScan = useResolveBarcodeScan();
    const [code, setCode] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [linking, setLinking] = useState<BarcodeScan | null>(null);

    const run = (scan: BarcodeScan) => {
        const data = scan.data.trim();
        if (data === '') return;
        setMessage(null);

        resolveScan({ data, symbology: scan.symbology }).then(
            (result) => {
                if (result.link === null) {
                    if (result.originHint === 'system') setMessage(unlinkedScanMessage(t, result));
                    else setLinking({ data, symbology: scan.symbology });
                    return;
                }
                const shelf = shelfForIngredient(stockItems, result.link.ingredientId);
                if (shelf === undefined) {
                    setMessage(t('kitchen:barcodes.noShelf'));
                    return;
                }
                onScanned({
                    stockItemId: String(shelf.id),
                    gtin: result.gtin,
                    supplierLot: result.supplierLot,
                    expiresOn: result.expiresOn,
                    bestBeforeOn: result.bestBeforeOn,
                    boundaryVerified: result.boundaryVerified,
                    packQuantity: result.link.packQuantity,
                    packUnitCode: result.link.packUnitCode,
                });
            },
            (error: unknown) => {
                setMessage(barcodeFailureText(t, toFailure(error), locale));
            },
        );
    };

    // A refused scan speaks over the screen's notice on the one before it.
    const shown: ScanNotice | null =
        message === null ? (notice ?? null) : { text: message, tone: 'warning' };
    const fieldId = shown?.fieldId;
    // Registered empty too, so the card goes the moment the next scan or the fix lands.
    const inTray = useIssueGroup({
        key: 'check',
        title: t('kitchen:tray.groupCheck'),
        items:
            shown === null
                ? []
                : [
                      {
                          key: 'scan',
                          tone: shown.tone,
                          label: shown.text,
                          action:
                              fieldId === undefined
                                  ? undefined
                                  : {
                                        onPress: () => {
                                            focusField(fieldId);
                                        },
                                    },
                          testID: `${testID}-message`,
                      },
                  ],
    });

    return (
        <Stack space="sm" testID={testID}>
            <TextInputField
                testID={`${testID}-code`}
                id={`${testID}-code`}
                size="sm"
                className="w-field"
                label={t('kitchen:barcodes.scanLabel')}
                placeholder={t('kitchen:barcodes.scanPlaceholder')}
                value={code}
                autoCorrect={false}
                autoCapitalize="none"
                blurOnSubmit={false}
                onChangeText={setCode}
                onSubmitEditing={() => {
                    // Cleared on submit, not on the answer: a scanner's next read must not land
                    // on the tail of this one while it is still being looked up.
                    setCode('');
                    run({ data: code, symbology: null });
                }}
                trailing={<CameraScanButton testID={`${testID}-camera`} onScan={run} />}
            />
            {inTray || shown === null ? null : (
                <Callout
                    testID={`${testID}-message`}
                    role="alert"
                    tone={shown.tone}
                    title={shown.text}
                />
            )}
            {linking === null ? null : (
                <LinkBarcodeDialog
                    testID={`${testID}-link`}
                    scan={linking}
                    stockItems={stockItems}
                    onClose={() => {
                        setLinking(null);
                    }}
                    onLinked={() => {
                        const scan = linking;
                        setLinking(null);
                        run(scan);
                    }}
                />
            )}
        </Stack>
    );
}

/**
 * "Link this barcode": pick the ingredient-backed shelf the pack belongs to, optionally say how much
 * one scan is, save. The link is the receiver's route — producer's codes only, audited.
 */
function LinkBarcodeDialog({
    testID,
    scan,
    stockItems,
    onClose,
    onLinked,
}: {
    readonly testID: string;
    readonly scan: BarcodeScan;
    readonly stockItems: readonly StockItem[];
    readonly onClose: () => void;
    readonly onLinked: () => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const link = useLinkIngredientBarcodeMutation();
    const shelves = stockItems.filter(
        (item) => item.backing === 'ingredient' && item.ingredientId !== null,
    );
    const [shelfId, setShelfId] = useState<string | null>(null);
    const [packQuantity, setPackQuantity] = useState('');
    const [failure, setFailure] = useState<ApiFailure | null>(null);

    const shelf = shelves.find((item) => String(item.id) === shelfId) ?? null;
    // A pack is counted in its shelf's unit — the only unit a receipt line adds it to.
    const unit = shelf !== null && isMeasureUnit(shelf.unitCode) ? shelf.unitCode : null;
    const quantity = Number(packQuantity);

    const save = () => {
        const ingredientId = shelf?.ingredientId ?? null;
        if (ingredientId === null) return;
        setFailure(null);
        link.mutate(
            {
                ingredientId,
                code: scan.data,
                symbology: scan.symbology,
                ...(packQuantity.trim() === '' || !Number.isFinite(quantity) || unit === null
                    ? {}
                    : { packQuantity: quantity, packUnitCode: unit }),
            },
            {
                onSuccess: onLinked,
                onError: (error) => {
                    setFailure(toFailure(error));
                },
            },
        );
    };

    return (
        <Dialog
            testID={testID}
            open
            onClose={onClose}
            title={t('kitchen:barcodes.linkTitle')}
            description={t('kitchen:barcodes.linkBody', { code: `⁦${scan.data}⁩` })}
            actions={
                <>
                    <Button
                        testID={`${testID}-cancel`}
                        variant="quiet"
                        label={t('kitchen:barcodes.linkCancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID={`${testID}-save`}
                        label={t('kitchen:barcodes.linkSave')}
                        loading={link.isPending}
                        disabled={shelf === null || link.isPending}
                        onPress={save}
                    />
                </>
            }
        >
            <Stack space="sm">
                <Select
                    testID={`${testID}-shelf`}
                    id={`${testID}-shelf`}
                    label={t('kitchen:barcodes.linkShelf')}
                    searchable
                    options={shelves.map((item) => ({
                        value: String(item.id),
                        label: `${item.code} — ${item.nameEn}`,
                    }))}
                    value={shelfId}
                    onChange={setShelfId}
                />
                <QuantityInput
                    testID={`${testID}-pack`}
                    id={`${testID}-pack`}
                    size="sm"
                    label={t('kitchen:barcodes.packLabel')}
                    placeholder={t('kitchen:barcodes.packPlaceholder')}
                    {...(unit === null ? {} : { unit: t(unitShortKey(unit)) })}
                    value={packQuantity}
                    onChangeText={setPackQuantity}
                />
                {failure === null ? null : (
                    <Callout
                        testID={`${testID}-error`}
                        role="alert"
                        tone="danger"
                        title={barcodeFailureText(t, failure, locale) ?? ''}
                    />
                )}
            </Stack>
        </Dialog>
    );
}
