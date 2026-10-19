import type { ProductionOrderLine } from '@healthy360/api-client/contracts';
import {
    Button,
    DataList,
    DateField,
    Dialog,
    Heading,
    InfoTip,
    Inline,
    QuantityInput,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { DataListColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { addDays } from '../../commerce/dates.ts';
import { withoutMinus } from '../format.ts';
import { BATCH_QUANTITY_FORMAT } from '../operations/batch-sheet.tsx';
import { ledgerQuantity } from '../ops-format.ts';
import type { CompletionDraft, LineField } from './completion-model.ts';
import {
    completionErrors,
    hasCompletionErrors,
    orderedLines,
    readNumber,
    withLineQuantity,
} from './completion-model.ts';

/**
 * What the cook says actually happened (PROD1).
 *
 * ```
 * ┌ Report what came out (i) ──────────────────────────── 640 × 640 ✕ ┐
 * │ PRODUCED (i) [ 38 kg ]              REJECTED (i) [ 1 kg ]          │
 * │ What went in (i)                                                   │
 * │ ┌ ITEM            CLAIMED     USED            WASTED  ┐            │
 * │ │ Flour, plain    8 kg        [ as claimed ]  [ 0 ]   │            │
 * │ │ Tray, 1 kg      40 pcs      [ as claimed ]  [ 0 ]   │            │
 * │ └──────────────────────────────────────────────────────┘            │
 * │ MADE ON [ 2026-09-16 ]   USE BY [ 2026-09-21 ]   STORED IN [ … ]   │
 * ├────────────────────────────────────────────────────────────────────┤
 * │                                         [ Cancel ] [ Complete ]    │
 * └────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## A square with a table in it
 *
 * The 480px dialog stacked every input under a label and every shelf under the last, with the
 * reasoning written out between them — a page of sentences around a dozen numbers. The square
 * (`Dialog size="square"`) gives the shelves one row each, in the admin's own list with the page
 * table's column words, and every explanation sits behind an (i).
 *
 * ## One form for completing and for abandoning, and that is deliberate
 *
 * A kitchen that had to retype everything to abandon a batch would cancel it instead and leave the
 * flour unaccounted for. So abandoning asks for the same report plus a reason, and the only thing
 * `mode` changes is the reason field, the title and the button.
 *
 * ## Every blank means something, and the two meanings differ per column
 *
 * A blank under **used** is "as claimed" — a cook who followed the recipe retypes nothing — and a
 * blank under **wasted** is zero. {@link completionErrors} and {@link withLineQuantity} hold that
 * asymmetry so no call site has to re-derive it from a `?? 0`; the placeholder says it in words,
 * because a field whose emptiness carries meaning has to say so.
 *
 * ## Produced and the reason say they are missing only once touched
 *
 * Submit is disabled while it is blank either way. Greeting the cook with a red sentence before they
 * have typed anything told them nothing the disabled button did not.
 *
 * ## Use by is computed when the recipe says how long it keeps
 *
 * With a shelf life the date is Made on plus that many days, shown read-only and never sent — the
 * server computes the same date and refuses a typed one. It shows only while the drafted usable
 * quantity is above zero, because a batch that put nothing on a shelf gets no date (and no lot).
 * Without a shelf life the cook types it, as before. There is no "Label" field any more: the system
 * mints the lot on the label.
 */

export interface BatchSettlementDialogProps {
    readonly testID: string;
    readonly open: boolean;
    readonly mode: 'complete' | 'abandon';
    readonly lines: readonly ProductionOrderLine[];
    readonly yieldUnitCode: string | null;
    /** The recipe's shelf life in days. Set, Use by is computed and read-only; null, it is typed. */
    readonly shelfLifeDays: number | null;
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
    shelfLifeDays,
    draft,
    onChange,
    onSubmit,
    onClose,
    submitting,
    failureMessage = null,
}: BatchSettlementDialogProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const [producedTouched, setProducedTouched] = useState(false);
    const [reasonTouched, setReasonTouched] = useState(false);

    // Each opening is a fresh report: the last one's "you left this blank" does not carry over.
    // Adjusted while rendering, on the change of `open`, rather than in an effect a frame late.
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setProducedTouched(false);
            setReasonTouched(false);
        }
    }

    const errors = completionErrors(draft, mode);
    const blocked = hasCompletionErrors(errors);
    const rows = orderedLines(lines);
    const noValue = t('kitchen:list.noValue');

    const usable = (readNumber(draft.produced) ?? 0) - (readNumber(draft.rejected) ?? 0);
    const computedExpiry =
        shelfLifeDays === null || usable <= 0 || draft.productionDate === null
            ? null
            : addDays(draft.productionDate, shelfLifeDays);

    const setLine = (field: LineField, stockItemId: string, value: string) => {
        // What was used and what was wasted are both amounts, never below zero.
        onChange(withLineQuantity(draft, field, stockItemId, withoutMinus(value)));
    };

    const claimed = (line: ProductionOrderLine): string =>
        ledgerQuantity(
            (parsed) => formatter.formatNumber(parsed, BATCH_QUANTITY_FORMAT),
            line.reservedQuantity ?? line.requiredQuantity,
            line.unitCode,
            noValue,
        );

    /*
     * Padded off the row's edges, as the supply order's quantity cells are: a DataList cell has no
     * vertical padding — the density is a floor — so a box the row's height sits on both hairlines.
     */
    const inputCell = (field: LineField, line: ProductionOrderLine) => {
        const id = String(line.stockItemId);
        const name = line.stockItemNameEn ?? noValue;
        const consumed = field === 'consumed';

        return (
            <View className="min-w-0 flex-1 py-tight">
                <QuantityInput
                    testID={`${testID}-${consumed ? 'consumed' : 'waste'}-${id}`}
                    id={`${testID}-${consumed ? 'consumed' : 'waste'}-${id}`}
                    // The shelf's own name: a dozen inputs with one accessible name is a form a
                    // screen-reader user cannot tell apart.
                    label={t(
                        consumed
                            ? 'kitchen:ops.production.consumedLineLabel'
                            : 'kitchen:ops.production.wasteLineLabel',
                        { item: name },
                    )}
                    labelHidden
                    size="xs"
                    placeholder={t(
                        consumed
                            ? 'kitchen:ops.production.asPlanned'
                            : 'kitchen:fields.quantityPlaceholder',
                    )}
                    unit={line.unitCode ?? undefined}
                    value={draft[field][id] ?? ''}
                    onChangeText={(value) => {
                        setLine(field, id, value);
                    }}
                />
            </View>
        );
    };

    const columns: readonly DataListColumn<ProductionOrderLine>[] = [
        {
            key: 'item',
            label: t('kitchen:ops.production.columnItem'),
            width: 168,
            priority: 100,
            render: (line) => <Text variant="strong">{line.stockItemNameEn ?? noValue}</Text>,
        },
        {
            key: 'claimed',
            label: t('kitchen:ops.production.columnClaimed'),
            width: 104,
            priority: 70,
            mono: true,
            render: (line) => (
                <Text variant="mono" tone="secondary">
                    {claimed(line)}
                </Text>
            ),
        },
        // The two inputs outrank everything but the name: the fitter must never drop a field.
        {
            key: 'consumed',
            label: t('kitchen:ops.production.columnUsed'),
            width: 148,
            priority: 95,
            render: (line) => inputCell('consumed', line),
        },
        {
            key: 'waste',
            label: t('kitchen:ops.production.columnWasted'),
            width: 120,
            priority: 90,
            render: (line) => inputCell('waste', line),
        },
    ];

    return (
        <Dialog
            testID={testID}
            size="square"
            open={open}
            onClose={onClose}
            title={t(
                mode === 'abandon'
                    ? 'kitchen:ops.production.abandonTitle'
                    : 'kitchen:ops.production.completeTitle',
            )}
            titleAside={
                <InfoTip
                    testID={`${testID}-info`}
                    label={t(
                        mode === 'abandon'
                            ? 'kitchen:ops.production.abandonTitle'
                            : 'kitchen:ops.production.completeTitle',
                    )}
                    text={t(
                        mode === 'abandon'
                            ? 'kitchen:ops.production.abandonSubtitle'
                            : 'kitchen:ops.production.completeSubtitle',
                    )}
                />
            }
            actions={
                <>
                    <Button
                        testID={`${testID}-cancel`}
                        variant="quiet"
                        size="sm"
                        label={t('kitchen:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID={`${testID}-submit`}
                        variant={mode === 'abandon' ? 'danger' : 'primary'}
                        size="sm"
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
            <View className="flex-row items-start gap-base">
                <View className="min-w-0 flex-1">
                    <QuantityInput
                        testID={`${testID}-produced`}
                        id={`${testID}-produced`}
                        label={t('kitchen:ops.production.producedLabel')}
                        hint={t('kitchen:ops.production.producedHint')}
                        placeholder={t('kitchen:ops.production.producedPlaceholder')}
                        unit={yieldUnitCode ?? undefined}
                        required
                        value={draft.produced}
                        error={
                            producedTouched && errors.produced !== undefined
                                ? t(errors.produced)
                                : undefined
                        }
                        onChangeText={(value) => {
                            setProducedTouched(true);
                            onChange({ ...draft, produced: value });
                        }}
                    />
                </View>
                <View className="min-w-0 flex-1">
                    <QuantityInput
                        testID={`${testID}-rejected`}
                        id={`${testID}-rejected`}
                        label={t('kitchen:ops.production.rejectedLabel')}
                        hint={t('kitchen:ops.production.rejectedHint')}
                        placeholder={t('kitchen:fields.quantityPlaceholder')}
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
                <Stack space="xs">
                    <Inline space="xs" align="center">
                        <Heading level={3}>{t('kitchen:ops.production.consumedHeading')}</Heading>
                        <InfoTip
                            testID="kitchen-batch-settle-consumed-info"
                            label={t('kitchen:ops.production.consumedHeading')}
                            text={`${t('kitchen:ops.production.consumedHint')} ${t(
                                'kitchen:ops.production.wasteHint',
                            )}`}
                        />
                    </Inline>
                    {/*
                     * A plain `DataList`, unframed: inside a window a raised panel is a card on a
                     * card. Not `CatalogueList` either — that one pages at eighteen rows and turns
                     * two-line below `md`, and either would hide an input.
                     */}
                    <DataList<ProductionOrderLine>
                        testID={`${testID}-lines`}
                        label={t('kitchen:ops.production.consumedHeading')}
                        columns={columns}
                        rows={rows}
                        rowKey={(line) => line.id}
                        density="sm"
                    />
                </Stack>
            )}

            <View className="flex-row items-start gap-base">
                <View className="min-w-0 flex-1">
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
                <View className="min-w-0 flex-1">
                    {shelfLifeDays === null ? (
                        <DateField
                            testID={`${testID}-expiry-date`}
                            id={`${testID}-expiry-date`}
                            label={t('kitchen:ops.production.expiryDateLabel')}
                            value={draft.expiryDate}
                            onChange={(value) => {
                                onChange({ ...draft, expiryDate: value });
                            }}
                        />
                    ) : (
                        <QuantityInput
                            testID={`${testID}-expiry-date`}
                            id={`${testID}-expiry-date`}
                            readOnly
                            label={t('kitchen:ops.production.expiryDateLabel')}
                            hint={t('kitchen:ops.production.expiryFromRecipe', {
                                days: t('kitchen:calendar.dayCount', { count: shelfLifeDays }),
                            })}
                            placeholder={noValue}
                            value={computedExpiry ?? ''}
                            onChangeText={() => undefined}
                        />
                    )}
                </View>
                <View className="min-w-0 flex-1">
                    <TextInputField
                        testID={`${testID}-storage-location`}
                        id={`${testID}-storage-location`}
                        label={t('kitchen:ops.production.storageLocationLabel')}
                        placeholder={t('kitchen:ops.production.storageLocationPlaceholder')}
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
                    placeholder={t('kitchen:ops.production.abandonReasonPlaceholder')}
                    value={draft.reason}
                    required
                    error={
                        reasonTouched && errors.reason !== undefined ? t(errors.reason) : undefined
                    }
                    onChangeText={(value) => {
                        setReasonTouched(true);
                        onChange({ ...draft, reason: value });
                    }}
                />
            ) : null}

            {failureMessage === null || failureMessage === undefined ? null : (
                <Text tone="danger" testID={`${testID}-error`}>
                    {failureMessage}
                </Text>
            )}
        </Dialog>
    );
}
