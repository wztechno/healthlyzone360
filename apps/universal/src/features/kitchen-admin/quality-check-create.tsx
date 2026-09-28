import type {
    GoodsReceipt,
    ProductionOrder,
    QualityCheck,
    QualityCheckStatus,
    QualityCheckSubjectType,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    FormSection,
    SearchInput,
    Skeleton,
    Stack,
    Text,
    cx,
    useToast,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { toFailure } from '../../data/hooks.ts';
import {
    useCreateQualityCheckMutation,
    useGoodsReceiptsQuery,
    useHoldQualityCheckMutation,
    useProcurementReferenceQuery,
    useProductionOrdersQuery,
    useQualityChecksQuery,
    useStockItemsQuery,
} from '../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../session/session-provider.tsx';
import { ChoiceTiles, RadioMark } from './choice-tiles.tsx';
import { EditorFrame } from './editor-frame.tsx';
import {
    ledgerQuantity,
    productionStatusKey,
    qualityCheckStatusKey,
    qualityCheckStatusTone,
} from './ops-format.ts';
import { useOptimisticConcurrency } from './use-optimistic-concurrency.ts';
import { useUnsavedGuard } from './use-unsaved-guard.ts';

/**
 * Open a quality check — the Post Receipt design's `qc` screen.
 *
 * ```
 * Open a quality check  • A hold stops the stock          [ Back to quality control ] [ Open check ]
 * • Draft  Not saved yet
 * ┌ SUBJECT  What is being inspected ───────────────────┐  ┌ Summary ───────────────────┐
 * │ (•) Goods receipt        ( ) Production batch        │  │ Subject type  Goods receipt │
 * │ [ ⌕ Receipt, delivery note or supplier ]             │  │ Subject       DN-4471       │
 * │   RECEIPT        SUPPLIER        DATE      CHECKS    │  │ Starts as     Pending       │
 * │ (•) DN-4471      Beqaa Fresh     12 Sep    None yet  │  └────────────────────────────┘
 * │ ( ) DN-2210      Tripoli Dairy   11 Sep    Hold · 4c… │  ┌ What a check can do ───────┐
 * └──────────────────────────────────────────────────────┘  │ Pending   Opened, not decided│
 * ┌ WHAT THE CHECK COVERS  DN-4471 · Beqaa Fresh ────────┐  │ On hold   Can't be used     │
 * ┌ START AS  (•) Pending   ( ) On hold now ─────────────┐  └────────────────────────────┘
 * ```
 *
 * ## Picked, not typed
 *
 * The editor it replaces asked for a subject *id* — a UUID nobody has in their head. A check is
 * about a delivery or a batch somebody can see, so the subject is chosen from this branch's recent
 * receipts and batches, searchable by the words on the paperwork, with the checks each already has
 * beside it. Choosing one shows what the check will cover, because a hold stops all of it.
 *
 * ## A second check is allowed, and flagged
 *
 * A subject with a check still pending or on hold usually wants that check decided, not another
 * opened. The server allows both, so this warns and offers the open one rather than refusing.
 *
 * ## "On hold now" is two writes
 *
 * The create contract opens a check as pending and nothing else. Starting on hold is the create
 * followed at once by a hold — the same write the list's Hold makes — and if the hold is refused
 * the check still exists, pending, and the toast says so rather than pretending it stopped anything.
 *
 * ## What the contract does not carry
 *
 * A receipt has no number of its own on the wire, so it is named by its delivery note and, lacking
 * one, a short id. Only the most recent {@link LIST_LIMIT} subjects are listed; the search reaches
 * the rest of what the reads returned.
 */

type StartAs = 'pending' | 'hold';

/** How many subjects the list draws before the search has to narrow it. */
const LIST_LIMIT = 20;
/** How many of a receipt's lines "What the check covers" names before counting the rest. */
const COVER_LIMIT = 3;
/** A check that still wants deciding — the kind a second one would duplicate. */
const OPEN_STATUSES: ReadonlySet<QualityCheckStatus> = new Set(['pending', 'hold']);

/** A receipt or a batch, as one row of the subject list. */
interface SubjectRow {
    readonly id: string;
    readonly ref: string;
    readonly meta: string;
    readonly who: string;
    readonly date: string | null;
    readonly check: QualityCheck | null;
    readonly cover: readonly { readonly key: string; readonly name: string; readonly qty: string }[];
    readonly more: number;
}

function shortId(id: string): string {
    return `${id.slice(0, 8)}…`;
}

export interface QualityCheckCreateProps {
    readonly onDone: () => void;
    /** Leaves the editor for an existing check — the duplicate warning's way out. */
    readonly onOpenCheck: (check: QualityCheck) => void;
}

export function QualityCheckCreate({ onDone, onOpenCheck }: QualityCheckCreateProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const access = useAccessState();
    const branchId = access.branch?.id ?? null;

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });
    const concurrency = useOptimisticConcurrency({ onReload: onDone });
    const createCheck = useCreateQualityCheckMutation();
    const holdCheck = useHoldQualityCheckMutation();

    const [kind, setKind] = useState<QualityCheckSubjectType>('goods_receipt');
    const [query, setQuery] = useState('');
    const [pickedId, setPickedId] = useState<string | null>(null);
    const [start, setStart] = useState<StartAs>('pending');
    const [submitted, setSubmitted] = useState(false);

    const isReceipt = kind === 'goods_receipt';
    const checks = useQualityChecksQuery();
    const receipts = useGoodsReceiptsQuery(isReceipt);
    const stockItems = useStockItemsQuery(isReceipt);
    const reference = useProcurementReferenceQuery(isReceipt);
    // The open batches (the endpoint's default) and the finished ones — a check is as often about
    // what came off the line yesterday as about what is on it now.
    const branchFilter = branchId === null ? {} : { branchId };
    const openBatches = useProductionOrdersQuery(branchFilter, !isReceipt);
    const doneBatches = useProductionOrdersQuery(
        { ...branchFilter, status: 'completed' },
        !isReceipt,
    );

    const number = (value: number) => formatter.formatNumber(value, { maximumFractionDigits: 3 });
    const noValue = t('kitchen:list.noValue');

    /** The check a subject most needs looked at: an open one before a settled one. */
    const checkBySubject = useMemo(() => {
        const map = new Map<string, QualityCheck>();
        for (const check of checks.data ?? []) {
            const held = map.get(check.subjectId);
            if (held === undefined || (!OPEN_STATUSES.has(held.status) && OPEN_STATUSES.has(check.status))) {
                map.set(check.subjectId, check);
            }
        }
        return map;
    }, [checks.data]);

    const itemNames = useMemo(() => {
        const map = new Map<string, { readonly name: string; readonly unitCode: string }>();
        for (const item of stockItems.data ?? []) {
            map.set(String(item.id), { name: item.nameEn, unitCode: item.unitCode });
        }
        return map;
    }, [stockItems.data]);

    const unitCodes = useMemo(() => {
        const map = new Map<string, string>();
        for (const unit of reference.data?.measurementUnits ?? []) map.set(unit.id, unit.code);
        return map;
    }, [reference.data]);

    // Recomputed each render: a page of receipts or batches, and cheaper than keeping a memo honest.
    const rows: readonly SubjectRow[] = (() => {
        if (isReceipt) {
            return [...(receipts.data ?? [])]
                .filter((row) => branchId === null || String(row.branchId) === String(branchId))
                .sort((left, right) => receiptDate(right).localeCompare(receiptDate(left)))
                .map((row: GoodsReceipt) => ({
                    id: String(row.id),
                    ref: row.documentRef ?? shortId(String(row.id)),
                    meta: t('kitchen:ops.procurement.lineCount', { count: row.lines.length }),
                    who: row.supplier?.nameEn ?? t('kitchen:ops.procurement.noSupplier'),
                    date: receiptDate(row) === '' ? null : receiptDate(row),
                    check: checkBySubject.get(String(row.id)) ?? null,
                    cover: row.lines.slice(0, COVER_LIMIT).map((line) => {
                        const item = itemNames.get(String(line.stockItemId));
                        const unit =
                            (line.unitId === null ? undefined : unitCodes.get(line.unitId)) ??
                            item?.unitCode ??
                            null;
                        return {
                            key: line.id,
                            name: item?.name ?? shortId(String(line.stockItemId)),
                            qty: ledgerQuantity(number, line.quantity, unit, noValue),
                        };
                    }),
                    more: Math.max(0, row.lines.length - COVER_LIMIT),
                }));
        }
        const batches = [...(openBatches.data?.orders ?? []), ...(doneBatches.data?.orders ?? [])];
        return batches
            .sort((left, right) => (right.productionDate ?? '').localeCompare(left.productionDate ?? ''))
            .map((row: ProductionOrder) => {
                const made = ledgerQuantity(
                    number,
                    row.producedQuantity ?? row.plannedYield,
                    row.plannedYieldUnitCode,
                    noValue,
                );
                const name = row.productionItemNameEn ?? noValue;
                return {
                    id: String(row.id),
                    ref: row.reference ?? row.batchReference ?? shortId(String(row.id)),
                    meta: t('kitchen:ops.qc.batchMeta', {
                        quantity: made,
                        status: t(productionStatusKey(row.status)),
                    }),
                    who: name,
                    date: row.productionDate,
                    check: checkBySubject.get(String(row.id)) ?? null,
                    cover: [{ key: String(row.id), name, qty: made }],
                    more: 0,
                };
            });
    })();

    const needle = query.trim().toLowerCase();
    const matching = rows.filter(
        (row) => needle === '' || `${row.ref} ${row.who} ${row.meta}`.toLowerCase().includes(needle),
    );
    const shown = matching.slice(0, LIST_LIMIT);
    const picked = rows.find((row) => row.id === pickedId) ?? null;
    const duplicate = picked?.check != null && OPEN_STATUSES.has(picked.check.status) ? picked.check : null;

    const loading = isReceipt
        ? receipts.isPending || stockItems.isPending || reference.isPending
        : openBatches.isPending || doneBatches.isPending;
    const loadFailure = toFailure(
        isReceipt ? receipts.error : (openBatches.error ?? doneBatches.error),
    );
    const saveFailure = toFailure(createCheck.error);
    const missingSubject = submitted && picked === null;

    const formatDate = (value: string | null) =>
        value === null ? noValue : formatter.formatDate(value, { dateStyle: 'medium' });

    function chooseKind(next: QualityCheckSubjectType) {
        // A receipt and a batch are different lists; a pick in one means nothing in the other.
        setKind(next);
        setPickedId(null);
        setQuery('');
        // Only a pick is something to lose — looking at the other list is not an edit.
    }

    function submit() {
        setSubmitted(true);
        if (picked === null) return;
        const subject = picked;
        createCheck.mutate(
            { subjectType: kind, subjectId: subject.id },
            {
                onSuccess: (created) => {
                    guard.markClean();
                    if (start === 'pending') {
                        toast.show({
                            testID: 'kitchen-qc-created-toast',
                            tone: 'success',
                            message: t('kitchen:ops.qc.createdToast'),
                        });
                        onDone();
                        return;
                    }
                    holdCheck.mutate(created.id, {
                        onSuccess: () => {
                            toast.show({
                                testID: 'kitchen-qc-created-held-toast',
                                tone: 'warning',
                                message: t('kitchen:ops.qc.createdHeldToast', { subject: subject.ref }),
                            });
                            onDone();
                        },
                        onError: () => {
                            toast.show({
                                testID: 'kitchen-qc-hold-failed-toast',
                                tone: 'danger',
                                message: t('kitchen:ops.qc.holdAfterCreateFailed'),
                            });
                            onDone();
                        },
                    });
                },
            },
        );
    }

    const summary = [
        {
            key: 'kind',
            label: t('kitchen:ops.qc.summarySubjectType'),
            value: t(isReceipt ? 'kitchen:ops.qc.kindReceiptTitle' : 'kitchen:ops.qc.kindBatchTitle'),
        },
        { key: 'subject', label: t('kitchen:ops.qc.summarySubject'), value: picked?.ref ?? noValue },
        {
            key: 'date',
            label: t(isReceipt ? 'kitchen:ops.qc.summaryReceived' : 'kitchen:ops.qc.summaryPlannedFor'),
            value: picked === null ? noValue : formatDate(picked.date),
        },
        {
            key: 'start',
            label: t('kitchen:ops.qc.summaryStartsAs'),
            value: t(start === 'hold' ? 'kitchen:ops.qc.statusOnHold' : 'kitchen:ops.qc.statusPending'),
        },
    ];

    const rail = (
        <View className="flex-col gap-base web:sticky web:top-0">
            <View
                testID="kitchen-qc-create-summary"
                className="flex-col gap-snug rounded bg-surface-brand-subtle p-base shadow-elevation-card"
            >
                <Text variant="section" className="text-content-on-brand-subtle">
                    {t('kitchen:ops.qc.summaryTitle')}
                </Text>
                {summary.map((row) => (
                    <View
                        key={row.key}
                        testID={`kitchen-qc-create-summary-${row.key}`}
                        className="flex-row items-baseline justify-between gap-tight"
                    >
                        <Text variant="caption" numberOfLines={1} className="text-content-on-brand-subtle">
                            {row.label}
                        </Text>
                        <Text
                            variant="caption"
                            align="end"
                            numberOfLines={1}
                            className="min-w-0 shrink font-semibold tabular-nums text-content-on-brand-subtle"
                        >
                            {row.value}
                        </Text>
                    </View>
                ))}
                <Text variant="caption" className="text-content-on-brand-subtle">
                    {t(start === 'hold' ? 'kitchen:ops.qc.summaryFootHold' : 'kitchen:ops.qc.summaryFootPending')}
                </Text>
            </View>

            <FormSection
                first
                variant="card"
                testID="kitchen-qc-create-states"
                title={t('kitchen:ops.qc.statesTitle')}
            >
                <View className="flex-col gap-tight">
                    {(
                        [
                            ['pending', 'kitchen:ops.qc.statePending'],
                            ['hold', 'kitchen:ops.qc.stateHold'],
                            ['released', 'kitchen:ops.qc.stateReleased'],
                        ] as const
                    ).map(([status, body]) => (
                        <View key={status} className="flex-row items-baseline gap-tight">
                            <View className="w-20 flex-row">
                                <Badge
                                    variant="label"
                                    icon={null}
                                    tone={qualityCheckStatusTone(status)}
                                    label={t(
                                        status === 'hold'
                                            ? 'kitchen:ops.qc.statusOnHold'
                                            : qualityCheckStatusKey(status),
                                    )}
                                />
                            </View>
                            <Text variant="caption" tone="secondary" className="min-w-0 flex-1">
                                {t(body)}
                            </Text>
                        </View>
                    ))}
                </View>
            </FormSection>
        </View>
    );

    return (
        <EditorFrame
            testID="kitchen-qc-create-editor"
            title={t('kitchen:ops.qc.createTitle')}
            titleChip={{ label: t('kitchen:ops.qc.createChip'), tone: 'danger' }}
            meta={null}
            guard={guard}
            concurrency={concurrency}
            saveLabel={t(start === 'hold' ? 'kitchen:ops.qc.createSubmitHold' : 'kitchen:ops.qc.createSubmit')}
            saving={createCheck.isPending || holdCheck.isPending}
            onSaveDraft={submit}
            backLabel={t('kitchen:ops.qc.backToList')}
            onBack={onDone}
            rail={rail}
            banner={
                !missingSubject && saveFailure === null ? undefined : (
                    <Stack space="sm">
                        {missingSubject ? (
                            <Callout
                                testID="kitchen-qc-create-missing"
                                role="alert"
                                tone="danger"
                                icon="warning"
                                title={t('kitchen:ops.qc.issueNoSubject')}
                            />
                        ) : null}
                        {saveFailure === null ? null : (
                            <Callout
                                testID="kitchen-qc-create-error"
                                role="alert"
                                tone="danger"
                                title={t('kitchen:ops.qc.createFailed')}
                                body={saveFailure.message}
                            />
                        )}
                    </Stack>
                )
            }
        >
            <View className="flex-col gap-base">
                <FormSection
                    first
                    variant="card"
                    testID="kitchen-qc-create-subject"
                    title={t('kitchen:ops.qc.subjectSection')}
                    aside={
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:ops.qc.subjectAside')}
                        </Text>
                    }
                >
                    <View className="flex-col gap-snug">
                        <ChoiceTiles<QualityCheckSubjectType>
                            testID="kitchen-qc-subject-type"
                            label={t('kitchen:ops.qc.summarySubjectType')}
                            tiles={[
                                {
                                    value: 'goods_receipt',
                                    title: t('kitchen:ops.qc.kindReceiptTitle'),
                                    body: t('kitchen:ops.qc.kindReceiptBody'),
                                },
                                {
                                    value: 'production_order',
                                    title: t('kitchen:ops.qc.kindBatchTitle'),
                                    body: t('kitchen:ops.qc.kindBatchBody'),
                                },
                            ]}
                            value={kind}
                            onChange={chooseKind}
                        />

                        <View className="max-w-[420px]">
                            <SearchInput
                                testID="kitchen-qc-subject-search"
                                label={t('kitchen:toolbar.searchLabel')}
                                placeholder={t(
                                    isReceipt
                                        ? 'kitchen:ops.qc.searchReceipts'
                                        : 'kitchen:ops.qc.searchBatches',
                                )}
                                size="sm"
                                value={query}
                                onChangeText={setQuery}
                            />
                        </View>

                        {loading ? (
                            <Stack space="xs" testID="kitchen-qc-subject-loading">
                                {Array.from({ length: 4 }, (_, index) => (
                                    <Skeleton key={index} heightClassName="h-10" />
                                ))}
                            </Stack>
                        ) : loadFailure !== null ? (
                            <Callout
                                testID="kitchen-qc-subject-error"
                                tone="danger"
                                title={t('kitchen:ops.qc.subjectsFailed')}
                                body={loadFailure.message}
                            />
                        ) : (
                            <SubjectList
                                isReceipt={isReceipt}
                                rows={shown}
                                pickedId={pickedId}
                                invalid={missingSubject}
                                empty={
                                    rows.length === 0
                                        ? t(isReceipt ? 'kitchen:ops.qc.receiptsNone' : 'kitchen:ops.qc.batchesNone')
                                        : t('kitchen:ops.qc.subjectsNoMatch')
                                }
                                formatDate={formatDate}
                                onPick={(id) => {
                                    setPickedId(id);
                                    guard.markDirty();
                                }}
                            />
                        )}

                        {matching.length > shown.length ? (
                            <Text variant="caption" tone="secondary" testID="kitchen-qc-subject-more">
                                {t('kitchen:ops.qc.subjectsLimited', { count: shown.length })}
                            </Text>
                        ) : null}

                        {duplicate === null || picked === null ? null : (
                            <Callout
                                testID="kitchen-qc-create-duplicate"
                                tone="warning"
                                title={t(
                                    duplicate.status === 'hold'
                                        ? 'kitchen:ops.qc.duplicateHold'
                                        : 'kitchen:ops.qc.duplicatePending',
                                    { subject: picked.ref, check: shortId(String(duplicate.id)) },
                                )}
                                actions={
                                    <Button
                                        testID="kitchen-qc-create-duplicate-open"
                                        variant="ghost"
                                        size="sm"
                                        label={t('kitchen:ops.qc.duplicateOpen', {
                                            check: shortId(String(duplicate.id)),
                                        })}
                                        onPress={() => {
                                            // No "discard?" here: the only thing left behind is
                                            // the pick of this very subject, and its check is
                                            // where the reader is going.
                                            guard.markClean();
                                            onOpenCheck(duplicate);
                                        }}
                                    />
                                }
                            />
                        )}
                    </View>
                </FormSection>

                {picked === null ? null : (
                    <>
                        <FormSection
                            first
                            variant="card"
                            testID="kitchen-qc-create-cover"
                            title={t(isReceipt ? 'kitchen:ops.qc.coverReceiptTitle' : 'kitchen:ops.qc.coverBatchTitle')}
                            aside={
                                <Text variant="caption" tone="secondary" numberOfLines={1}>
                                    {t('kitchen:ops.qc.coverAside', { ref: picked.ref, who: picked.who })}
                                </Text>
                            }
                        >
                            <View className="flex-col">
                                {picked.cover.map((line) => (
                                    <View
                                        key={line.key}
                                        className="min-h-row-sm flex-row items-center justify-between gap-tight border-b border-stroke-subtle px-control-sm"
                                    >
                                        <Text variant="caption" numberOfLines={1} className="min-w-0 shrink">
                                            {line.name}
                                        </Text>
                                        <Text variant="caption" className="font-semibold tabular-nums">
                                            {line.qty}
                                        </Text>
                                    </View>
                                ))}
                                {picked.more > 0 ? (
                                    <Text
                                        variant="micro"
                                        tone="secondary"
                                        testID="kitchen-qc-create-cover-more"
                                        className="px-control-sm pt-tight"
                                    >
                                        {t('kitchen:ops.qc.coverMore', { count: picked.more })}
                                    </Text>
                                ) : null}
                            </View>
                        </FormSection>

                        <FormSection
                            first
                            variant="card"
                            testID="kitchen-qc-create-start"
                            title={t('kitchen:ops.qc.startSection')}
                        >
                            <ChoiceTiles<StartAs>
                                testID="kitchen-qc-start"
                                label={t('kitchen:ops.qc.startSection')}
                                tiles={[
                                    {
                                        value: 'pending',
                                        title: t('kitchen:ops.qc.startPendingTitle'),
                                        body: t('kitchen:ops.qc.startPendingBody'),
                                    },
                                    {
                                        value: 'hold',
                                        title: t('kitchen:ops.qc.startHoldTitle'),
                                        body: t('kitchen:ops.qc.startHoldBody'),
                                    },
                                ]}
                                value={start}
                                onChange={(next) => {
                                    setStart(next);
                                    guard.markDirty();
                                }}
                            />
                        </FormSection>
                    </>
                )}
            </View>
        </EditorFrame>
    );
}

/** A receipt's business date, or its timestamp's day when the older rows have none. */
function receiptDate(row: GoodsReceipt): string {
    return row.receivedOn ?? row.receivedAt?.slice(0, 10) ?? '';
}

/* ------------------------------------------------------------------------------------------------
 * The subject list
 * ---------------------------------------------------------------------------------------------- */

/** The two fixed trailing tracks, so the header labels stand over their values. */
const DATE_TRACK = 'w-24';
const CHECK_TRACK = 'w-36';

/**
 * The subjects as a one-of list in `CatalogueList`'s frame: the header band, then a row per subject
 * that is itself the radio — the reference and what it is, who it came from or what it made, its
 * date, and the check it already carries.
 */
function SubjectList({
    isReceipt,
    rows,
    pickedId,
    invalid,
    empty,
    formatDate,
    onPick,
}: {
    readonly isReceipt: boolean;
    readonly rows: readonly SubjectRow[];
    readonly pickedId: string | null;
    readonly invalid: boolean;
    readonly empty: string;
    readonly formatDate: (value: string | null) => string;
    readonly onPick: (id: string) => void;
}) {
    const { t } = useTranslation();

    const header = (text: string, className?: string) => (
        <Text variant="strong" numberOfLines={1} className={cx('text-content-on-brand-subtle', className)}>
            {text}
        </Text>
    );

    return (
        <View
            testID="kitchen-qc-subject-list"
            role="radiogroup"
            aria-label={t('kitchen:ops.qc.subjectSection')}
            className={cx(
                'flex-col overflow-hidden rounded-panel border bg-surface-raised',
                invalid ? 'border-danger-border' : 'border-stroke-subtle',
            )}
        >
            <View className="min-h-row-sm flex-row items-center gap-tight bg-surface-brand-subtle px-control-sm">
                <View className="w-4" />
                {header(t(isReceipt ? 'kitchen:ops.qc.colReceipt' : 'kitchen:ops.qc.colBatch'), 'min-w-0 flex-1')}
                {header(t(isReceipt ? 'kitchen:ops.qc.colSupplier' : 'kitchen:ops.qc.colRecipe'), 'min-w-0 flex-1')}
                {header(t('kitchen:ops.qc.colDate'), DATE_TRACK)}
                {header(t('kitchen:ops.qc.colChecks'), CHECK_TRACK)}
            </View>

            {rows.length === 0 ? (
                <Text variant="caption" tone="secondary" testID="kitchen-qc-subject-empty" className="px-control-sm py-base">
                    {empty}
                </Text>
            ) : (
                rows.map((row) => {
                    const on = row.id === pickedId;
                    return (
                        <Pressable
                            key={row.id}
                            testID={`kitchen-qc-subject-${row.id}`}
                            role="radio"
                            accessibilityRole="radio"
                            aria-checked={on}
                            accessibilityState={{ checked: on }}
                            aria-label={`${row.ref}, ${row.who}`}
                            onPress={() => {
                                onPick(row.id);
                            }}
                            className={cx(
                                'min-h-row-md flex-row items-center gap-tight border-b border-stroke-subtle px-control-sm py-snug',
                                on ? 'bg-surface-brand-subtle' : 'hover:bg-surface-sunken',
                            )}
                        >
                            <View className="w-4">
                                <RadioMark on={on} />
                            </View>
                            <View className="min-w-0 flex-1 flex-col">
                                <Text variant="caption" numberOfLines={1} className="font-semibold tabular-nums">
                                    {row.ref}
                                </Text>
                                <Text variant="micro" tone="secondary" numberOfLines={1}>
                                    {row.meta}
                                </Text>
                            </View>
                            <Text variant="caption" numberOfLines={1} className="min-w-0 flex-1">
                                {row.who}
                            </Text>
                            <Text variant="caption" tone="secondary" numberOfLines={1} className={cx(DATE_TRACK, 'tabular-nums')}>
                                {formatDate(row.date)}
                            </Text>
                            <View className={cx(CHECK_TRACK, 'flex-row')}>
                                {row.check === null ? (
                                    <Text variant="caption" tone="secondary">
                                        {t('kitchen:ops.qc.checksNone')}
                                    </Text>
                                ) : (
                                    <Badge
                                        variant="label"
                                        icon={null}
                                        testID={`kitchen-qc-subject-${row.id}-check`}
                                        tone={qualityCheckStatusTone(row.check.status)}
                                        label={t('kitchen:ops.qc.checkBadge', {
                                            status: t(
                                                row.check.status === 'hold'
                                                    ? 'kitchen:ops.qc.statusOnHold'
                                                    : qualityCheckStatusKey(row.check.status),
                                            ),
                                            check: shortId(String(row.check.id)),
                                        })}
                                    />
                                )}
                            </View>
                        </Pressable>
                    );
                })
            )}
        </View>
    );
}
