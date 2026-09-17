import type { ProductionOrderLine } from '@healthy360/api-client/contracts';
import {
    Button,
    DateField,
    Dialog,
    Heading,
    QuantityInput,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { CompletionDraft, LineField } from './completion-model.ts';
import {
    completionErrors,
    hasCompletionErrors,
    orderedLines,
    withLineQuantity,
} from './completion-model.ts';

/**
 * What the cook says actually happened (PROD1).
 *
 * ```
 * PRODUCED  [ 38 ]   REJECTED  [ 1 ]
 *
 * WHAT WENT IN                      WHAT WENT IN THE BIN
 * Flour, plain      [ as claimed ]  [        ]
 * Tray, 1 kg        [ as claimed ]  [        ]
 *
 * MADE ON [ 2026-09-16 ]  LABEL [ CD-0916 ]  STORED IN [ Chill 2 ]  USE BY [ 2026-09-23 ]
 * ```
 *
 * ## One form for completing and for abandoning, and that is deliberate
 *
 * A kitchen that had to retype everything to abandon a batch would cancel it instead and leave the
 * flour unaccounted for. So abandoning asks for the same report plus a reason, and the only thing
 * `mode` changes is the reason field, the title and the button.
 *
 * ## Every blank means something, and the two meanings differ per column
 *
 * A blank under **what went in** is "as claimed" — a cook who followed the recipe retypes nothing —
 * and a blank under **what went in the bin** is zero. {@link completionErrors} and
 * {@link withLineQuantity} hold that asymmetry so no call site has to re-derive it from a `?? 0`;
 * the placeholder says it in words, because a field whose emptiness carries meaning has to say so.
 */

export interface BatchSettlementDialogProps {
    readonly testID: string;
    readonly open: boolean;
    readonly mode: 'complete' | 'abandon';
    readonly lines: readonly ProductionOrderLine[];
    readonly yieldUnitCode: string | null;
    readonly draft: CompletionDraft;
    readonly onChange: (draft: CompletionDraft) => void;
    readonly onSubmit: () => void;
    readonly onClose: () => void;
    readonly submitting: boolean;
    /** The server's refusal, already turned into a sentence. */
    readonly failureMessage?: string | null | undefined;
}

export function BatchSettlementDialog({
    testID,
    open,
    mode,
    lines,
    yieldUnitCode,
    draft,
    onChange,
    onSubmit,
    onClose,
    submitting,
    failureMessage = null,
}: BatchSettlementDialogProps) {
    const { t } = useTranslation();

    const errors = completionErrors(draft, mode);
    const blocked = hasCompletionErrors(errors);
    const rows = orderedLines(lines);

    const setLine = (field: LineField, stockItemId: string, value: string) => {
        onChange(withLineQuantity(draft, field, stockItemId, value));
    };

    return (
        <Dialog
            testID={testID}
            open={open}
            onClose={onClose}
            title={t(
                mode === 'abandon'
                    ? 'kitchen:ops.production.abandonTitle'
                    : 'kitchen:ops.production.completeTitle',
            )}
            actions={
                <>
                    <Button
                        testID={`${testID}-cancel`}
                        variant="quiet"
                        label={t('kitchen:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID={`${testID}-submit`}
                        variant={mode === 'abandon' ? 'danger' : 'primary'}
                        label={t(
                            mode === 'abandon'
                                ? 'kitchen:ops.production.abandonSubmit'
                                : 'kitchen:ops.production.completeSubmit',
                        )}
                        loading={submitting}
                        disabled={blocked}
                        onPress={onSubmit}
                    />
                </>
            }
        >
            <Stack space="lg">
                <Text tone="secondary">
                    {t(
                        mode === 'abandon'
                            ? 'kitchen:ops.production.abandonSubtitle'
                            : 'kitchen:ops.production.completeSubtitle',
                    )}
                </Text>

                <View className="flex-col gap-3 md:flex-row">
                    <View className="flex-1">
                        <QuantityInput
                            testID={`${testID}-produced`}
                            id={`${testID}-produced`}
                            label={t('kitchen:ops.production.producedLabel')}
                            hint={t('kitchen:ops.production.producedHint')}
                            unit={yieldUnitCode ?? undefined}
                            required
                            value={draft.produced}
                            error={errors.produced === undefined ? undefined : t(errors.produced)}
                            onChangeText={(value) => {
                                onChange({ ...draft, produced: value });
                            }}
                        />
                    </View>
                    <View className="flex-1">
                        <QuantityInput
                            testID={`${testID}-rejected`}
                            id={`${testID}-rejected`}
                            label={t('kitchen:ops.production.rejectedLabel')}
                            hint={t('kitchen:ops.production.rejectedHint')}
                            unit={yieldUnitCode ?? undefined}
                            value={draft.rejected}
                            error={errors.rejected === undefined ? undefined : t(errors.rejected)}
                            onChangeText={(value) => {
                                onChange({ ...draft, rejected: value });
                            }}
                        />
                    </View>
                </View>

                {rows.length === 0 ? null : (
                    <Stack space="sm">
                        <Heading level={3}>{t('kitchen:ops.production.consumedHeading')}</Heading>
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.production.consumedHint')}
                        </Text>
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.production.wasteHint')}
                        </Text>
                        {rows.map((line) => {
                            const id = String(line.stockItemId);

                            return (
                                <View
                                    key={line.id}
                                    className="flex-col gap-2 md:flex-row md:items-end"
                                >
                                    <View className="min-w-0 flex-1 justify-end pb-1">
                                        <Text variant="bodyStrong" numberOfLines={1}>
                                            {line.stockItemNameEn ?? t('kitchen:list.noValue')}
                                        </Text>
                                        <Text variant="caption" tone="secondary">
                                            {t('kitchen:ops.production.columnClaimed')}{' '}
                                            {line.reservedQuantity ?? line.requiredQuantity}
                                            {line.unitCode === null ? '' : ` ${line.unitCode}`}
                                        </Text>
                                    </View>
                                    <View className="flex-1">
                                        <QuantityInput
                                            testID={`${testID}-consumed-${id}`}
                                            id={`${testID}-consumed-${id}`}
                                            label={t('kitchen:ops.production.consumedHeading')}
                                            placeholder={t('kitchen:ops.production.asPlanned')}
                                            unit={line.unitCode ?? undefined}
                                            value={draft.consumed[id] ?? ''}
                                            onChangeText={(value) => {
                                                setLine('consumed', id, value);
                                            }}
                                        />
                                    </View>
                                    <View className="flex-1">
                                        <QuantityInput
                                            testID={`${testID}-waste-${id}`}
                                            id={`${testID}-waste-${id}`}
                                            label={t('kitchen:ops.production.wasteHeading')}
                                            unit={line.unitCode ?? undefined}
                                            value={draft.waste[id] ?? ''}
                                            onChangeText={(value) => {
                                                setLine('waste', id, value);
                                            }}
                                        />
                                    </View>
                                </View>
                            );
                        })}
                    </Stack>
                )}

                <View className="flex-col gap-3 md:flex-row">
                    <View className="flex-1">
                        <DateField
                            testID={`${testID}-production-date`}
                            id={`${testID}-production-date`}
                            label={t('kitchen:ops.production.productionDateLabel')}
                            value={draft.productionDate}
                            onChange={(value) => {
                                onChange({ ...draft, productionDate: value });
                            }}
                        />
                    </View>
                    <View className="flex-1">
                        <DateField
                            testID={`${testID}-expiry-date`}
                            id={`${testID}-expiry-date`}
                            label={t('kitchen:ops.production.expiryDateLabel')}
                            value={draft.expiryDate}
                            onChange={(value) => {
                                onChange({ ...draft, expiryDate: value });
                            }}
                        />
                    </View>
                </View>

                <View className="flex-col gap-3 md:flex-row">
                    <View className="flex-1">
                        <TextInputField
                            testID={`${testID}-batch-reference`}
                            id={`${testID}-batch-reference`}
                            label={t('kitchen:ops.production.batchReferenceLabel')}
                            value={draft.batchReference}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            onChangeText={(value) => {
                                onChange({ ...draft, batchReference: value });
                            }}
                        />
                    </View>
                    <View className="flex-1">
                        <TextInputField
                            testID={`${testID}-storage-location`}
                            id={`${testID}-storage-location`}
                            label={t('kitchen:ops.production.storageLocationLabel')}
                            value={draft.storageLocation}
                            onChangeText={(value) => {
                                onChange({ ...draft, storageLocation: value });
                            }}
                        />
                    </View>
                </View>

                {mode === 'abandon' ? (
                    <TextInputField
                        testID={`${testID}-reason`}
                        id={`${testID}-reason`}
                        label={t('kitchen:ops.production.abandonReasonLabel')}
                        hint={t('kitchen:ops.production.abandonReasonHint')}
                        value={draft.reason}
                        required
                        error={errors.reason === undefined ? undefined : t(errors.reason)}
                        onChangeText={(value) => {
                            onChange({ ...draft, reason: value });
                        }}
                    />
                ) : null}

                {failureMessage === null || failureMessage === undefined ? null : (
                    <Text tone="danger" testID={`${testID}-error`}>
                        {failureMessage}
                    </Text>
                )}
            </Stack>
        </Dialog>
    );
}
