import type { ProductionOrder, ProductionPlan } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Cascade,
    Dialog,
    EmptyState,
    ErrorState,
    RecordSkeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import { ProductionOrderId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import {
    useAbandonProductionOrderMutation,
    useCancelProductionOrderMutation,
    useCompleteProductionOrderMutation,
    useConfirmProductionOrderMutation,
    useProductionOrderQuery,
    useStartProductionOrderMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { todayIso } from '../../commerce/dates.ts';
import { returnCrumbLabel } from '../came-from.ts';
import { RecordLens } from '../catalogue/record-lens.tsx';
import type {
    RecordLensFact,
    RecordLensFigure,
    RecordLensStep,
} from '../catalogue/record-lens.tsx';
import { PRODUCTION_MANAGE_PERMISSION, PRODUCTION_VIEW_PERMISSION } from '../entity-registry.ts';
import { formatMoney, knownCurrency, localDay } from '../format.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { BATCH_QUANTITY_FORMAT } from '../operations/batch-sheet.tsx';
import {
    ledgerQuantity,
    nextProductionEdge,
    productionStatusKey,
    productionStatusTone,
} from '../ops-format.ts';
import { formatLot } from '../production-desk/batch-figures.ts';
import { BatchLinesPanel } from '../production-desk/batch-lines-panel.tsx';
import { BatchPlanPanel } from '../production-desk/batch-plan-panel.tsx';
import { BatchSettlementDialog } from '../production-desk/batch-settlement-dialog.tsx';
import type { CompletionDraft } from '../production-desk/completion-model.ts';
import {
    abandonRequest,
    completionRequest,
    emptyCompletionDraft,
} from '../production-desk/completion-model.ts';
import { EditorGuardDialogs } from '../record-form-opening.tsx';
import { useUnsavedGuardFor } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/production-desk/{order}` — one batch, and every edge it has left (PROD1).
 *
 * ```
 * Kitchen workspace › Production › Batch B-0012        ← the trail; the middle crumb is the way back
 * ┌ [Draft] Classic Burger Sauce │ ○ Confirmed — ─ ○ Started — ─ ○ Completed —  [Sheet] [Confirm] ┐
 * │ Planned  Runs  Shelves short  Produced  Rejected  Variance │ ● Usable                         │
 * │ Lot · Made on · Use by · Stored in │ Estimated cost · Actual cost · ● Cost per unit (i)       │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 * What it claimed — the bare ProductionTable (or, for a draft, the plan's sections)
 * ```
 *
 * One Record lens (`record-lens.tsx`) holds everything the four stat cards and the Status, Cost and
 * Batch record cards used to: the batch's state and history, its figures, and its record and money
 * as facts. No caption explains a figure; why one is what it is sits behind its (i).
 *
 * ## No issue tray
 *
 * The user took the tray off this page (2026-11-02). What it held now lives where it is about: a
 * use-by date gone by is a warning dot on Use by, a cost that could not be completed is the reason
 * behind Withheld's (i), a plan's holes are the plan panel's own notice, and a refused Confirm or
 * Start is a danger callout over the lens.
 *
 * ## The trail names the page it was opened from
 *
 * Opened with a `returnTo` — from the Batch register, or the Batch planner — the middle crumb is
 * that page by name and goes back to it. Opened plainly it is Production, as before.
 *
 * ## A draft shows a plan and a confirmed batch shows its lines, never both
 *
 * They answer different questions. A plan is "what would this need against the shelves **now**",
 * live, and a draft has committed to nothing so that is the only honest answer for it. From confirm
 * onwards the lines are the answer: they are what the kitchen agreed to, what the reservations were
 * opened against and what the estimate was computed from. The server sends one or the other for
 * exactly this reason, and this screen renders whichever arrived rather than choosing.
 *
 * ## Five edges, and which are offered is the state's decision
 *
 * Confirm and start take no information, so they are buttons. Complete and abandon need what came
 * out, so they open {@link BatchSettlementDialog}. Calling off is separate from abandoning and the
 * two are never one control: a cancelled batch took nothing, an abandoned one ate stock, and the
 * server refuses the first once a movement exists — which is the refusal this screen surfaces
 * verbatim rather than pre-empting, because only the ledger knows.
 *
 * ## Money is absent, not zero
 *
 * Without `production.view_costs_organisation` the cost keys are **missing from the payload**, not
 * null, so the cost block is not rendered at all and the page says why. A batch whose cost nobody
 * could compute is a different answer again: present, null, and stated as withheld with the reason
 * beside it. Reading either as zero would tell a kitchen manager a batch was free.
 */

export interface ProductionBatchScreenProps {
    /** The route parameter. Anything that is not an identifier lands on the not-found state. */
    readonly order?: string | undefined;
}

export function ProductionBatchScreen({ order }: ProductionBatchScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [PRODUCTION_VIEW_PERMISSION] }}
            testID="kitchen-production-batch"
        >
            <ProductionBatch order={order} />
        </Gate>
    );
}

/** Which settlement form is open, if either. */
type Settlement = 'complete' | 'abandon' | null;

function ProductionBatch({ order }: ProductionBatchScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const params = useLocalSearchParams<{ readonly returnTo?: string }>();
    // Back steps to wherever the batch was opened from — the register, the planner, else the desk.
    const back = useReturnTo(params.returnTo, '/kitchen/production-desk');
    const returnLabel = returnCrumbLabel(back.returnTo, t);
    const toast = useToast();
    const canManage = useCan(PRODUCTION_MANAGE_PERMISSION);

    const parsed = order === undefined ? null : ProductionOrderId.safeParse(order);
    const record = useProductionOrderQuery(parsed);

    const confirmBatch = useConfirmProductionOrderMutation();
    const startBatch = useStartProductionOrderMutation();
    const completeBatch = useCompleteProductionOrderMutation();
    const abandonBatch = useAbandonProductionOrderMutation();
    const cancelBatch = useCancelProductionOrderMutation();

    const [settlement, setSettlement] = useState<Settlement>(null);
    const [draft, setDraft] = useState<CompletionDraft>(() => emptyCompletionDraft(todayIso()));
    const [cancelling, setCancelling] = useState(false);
    /*
     * A completion or write-off half typed is work to lose: leaving by the trail, the sidebar or the
     * browser's Back asks first. Measured against a blank form on the same day, so an opened and
     * untouched one asks nothing.
     */
    const guard = useUnsavedGuardFor(
        settlement !== null &&
            JSON.stringify(draft) !== JSON.stringify(emptyCompletionDraft(draft.productionDate)),
        { message: t('kitchen:unsaved.browserPrompt') },
    );

    const detail = record.data;
    const failure = toFailure(record.error);

    const title =
        detail === undefined
            ? null
            : detail.order.reference === null
              ? t('kitchen:ops.production.batchFallbackTitle')
              : t('kitchen:ops.production.batchTitle', { reference: detail.order.reference });
    // The trail names the batch, and its middle crumb — the page it was opened from — is the way back.
    useKitchenTrailLeaf(title, back.leave, returnLabel ?? undefined);

    if (parsed === null) {
        return (
            <EmptyState
                testID="kitchen-production-batch-not-found"
                title={t('kitchen:ops.production.notFoundTitle')}
                body={t('kitchen:ops.production.notFoundBody')}
            />
        );
    }

    if (record.isPending) {
        return <RecordSkeleton testID="kitchen-production-batch-loading" />;
    }

    if (failure !== null) {
        return (
            <ErrorState
                testID="kitchen-production-batch-error"
                title={t('kitchen:ops.production.loadErrorTitle')}
                failure={failure}
                onRetry={() => {
                    void record.refetch();
                }}
                retrying={record.isFetching}
            />
        );
    }

    // Settled and empty: the identifier parsed and the fetch succeeded with nothing behind it,
    // which is a batch that is gone rather than a request that went wrong.
    if (detail === undefined) {
        return (
            <EmptyState
                testID="kitchen-production-batch-not-found"
                title={t('kitchen:ops.production.notFoundTitle')}
                body={t('kitchen:ops.production.notFoundBody')}
            />
        );
    }

    const batch = detail.order;
    const edge = nextProductionEdge(batch.status);
    const settling = batch.status === 'in_production';
    const noValue = t('kitchen:list.noValue');

    const openSettlement = (mode: Exclude<Settlement, null>) => {
        // Seeded blank rather than from the claims: pre-filling "what actually went in" with what
        // was claimed would turn a form nobody read into a report the ledger treats as observed.
        // The placeholder says what a blank means instead.
        setDraft(emptyCompletionDraft(batch.productionDate ?? todayIso()));
        completeBatch.reset();
        abandonBatch.reset();
        setSettlement(mode);
    };

    const settled = (messageKey: string) => () => {
        setSettlement(null);
        toast.show({
            testID: 'kitchen-production-batch-toast',
            tone: 'success',
            message: t(messageKey),
        });
    };

    const submitSettlement = () => {
        const variables = { productionOrderId: batch.id, lockVersion: batch.lockVersion };

        if (settlement === 'abandon') {
            abandonBatch.mutate(
                { ...variables, request: abandonRequest(draft) },
                { onSuccess: settled('kitchen:ops.production.abandonedToast') },
            );

            return;
        }

        completeBatch.mutate(
            { ...variables, request: completionRequest(draft) },
            { onSuccess: settled('kitchen:ops.production.completedToast') },
        );
    };

    const advance = () => {
        if (edge === null) return;

        const variables = { productionOrderId: batch.id, lockVersion: batch.lockVersion };
        confirmBatch.reset();
        startBatch.reset();
        const onSuccess = settled(
            edge === 'confirm'
                ? 'kitchen:ops.production.confirmedToast'
                : 'kitchen:ops.production.startedToast',
        );

        if (edge === 'confirm') {
            confirmBatch.mutate(variables, { onSuccess });

            return;
        }

        startBatch.mutate(variables, { onSuccess });
    };

    const settlementFailure =
        settlement === 'abandon' ? toFailure(abandonBatch.error) : toFailure(completeBatch.error);
    const cancelFailure = toFailure(cancelBatch.error);
    // A refused Confirm or Start used to leave the batch as it was with nothing said — a recipe
    // line with no quantity answered 422 and the button simply did nothing.
    const confirmFailure = toFailure(confirmBatch.error);
    const startFailure = toFailure(startBatch.error);

    const figure = (value: string | null, unitCode: string | null = null): string =>
        ledgerQuantity(
            (parsed) => formatter.formatNumber(parsed, BATCH_QUANTITY_FORMAT),
            value,
            unitCode,
            noValue,
        );

    const history = steps(batch, formatter, t);

    const advanceFailure = confirmFailure ?? startFailure;

    return (
        <Cascade space="md" testID="kitchen-production-batch-screen">
            {/*
             * Why the batch was abandoned stays on the page: it is the batch's own record, what a
             * cook wrote, not something left to fix.
             */}
            {/*
             * A refused Confirm or Start, in the server's words: without it the button simply
             * did nothing. The batch page has no issue tray, so it is said here.
             */}
            {advanceFailure === null ? null : (
                <Callout
                    testID="kitchen-production-batch-advance-error"
                    tone="danger"
                    role="alert"
                    title={t(
                        confirmFailure === null
                            ? 'kitchen:ops.production.startFailedTitle'
                            : 'kitchen:ops.production.confirmFailedTitle',
                    )}
                    body={advanceFailure.message}
                />
            )}

            {batch.abandonReason === null ? null : (
                <Stack space="xs" testID="kitchen-production-batch-notices">
                    <Callout
                        testID="kitchen-production-batch-abandon-reason"
                        tone="warning"
                        title={t('kitchen:ops.production.abandonReasonLabel')}
                        body={batch.abandonReason}
                    />
                </Stack>
            )}

            {/*
             * The batch in one object: what it is and where it stands, its figures, then its
             * record and money. The trail names the batch, so there is no page header.
             */}
            <RecordLens
                testID="kitchen-production-batch-facts"
                label={t('kitchen:ops.production.summaryLabel')}
                noValue={noValue}
                heading={
                    <>
                        <Badge
                            testID="kitchen-production-batch-status"
                            tone={productionStatusTone(batch.status)}
                            label={t(productionStatusKey(batch.status))}
                        />
                        {batch.productionItemNameEn === null ? null : (
                            <Text
                                variant="strong"
                                numberOfLines={1}
                                testID="kitchen-production-batch-header-subtitle"
                            >
                                {batch.productionItemNameEn}
                            </Text>
                        )}
                    </>
                }
                steps={history}
                stepsLabel={t('kitchen:ops.production.historyLabel')}
                actions={
                    <>
                        {batch.confirmedAt === null ? null : (
                            <Button
                                testID="kitchen-production-batch-sheet"
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:ops.production.sheetLink')}
                                onPress={() => {
                                    router.push(
                                        `/kitchen/production-desk/${String(batch.id)}/sheet`,
                                    );
                                }}
                            />
                        )}
                        {/* The lot shows from start; the label waits for a use-by, its barcode's. */}
                        {batch.barcode === null ? null : (
                            <Button
                                testID="kitchen-production-batch-label"
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:ops.production.printLabel')}
                                onPress={() => {
                                    router.push(
                                        `/kitchen/production-desk/${String(batch.id)}/label`,
                                    );
                                }}
                            />
                        )}
                        {canManage && isCallableOff(batch) ? (
                            <Button
                                testID="kitchen-production-batch-cancel"
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:ops.production.cancelBatch')}
                                onPress={() => {
                                    cancelBatch.reset();
                                    setCancelling(true);
                                }}
                            />
                        ) : null}
                        {canManage && settling ? (
                            <Button
                                testID="kitchen-production-batch-abandon"
                                variant="danger"
                                size="sm"
                                label={t('kitchen:ops.production.abandon')}
                                onPress={() => {
                                    openSettlement('abandon');
                                }}
                            />
                        ) : null}
                        {canManage && settling ? (
                            <Button
                                testID="kitchen-production-batch-complete"
                                size="sm"
                                label={t('kitchen:ops.production.complete')}
                                onPress={() => {
                                    openSettlement('complete');
                                }}
                            />
                        ) : null}
                        {canManage && edge !== null ? (
                            <Button
                                testID={`kitchen-production-batch-${edge}`}
                                size="sm"
                                label={t(
                                    edge === 'confirm'
                                        ? 'kitchen:ops.production.confirm'
                                        : 'kitchen:ops.production.start',
                                )}
                                loading={confirmBatch.isPending || startBatch.isPending}
                                onPress={advance}
                            />
                        ) : null}
                    </>
                }
                figures={batchFigures(batch, detail.plan, figure, t)}
                note={batch.notes}
                facts={[
                    ...recordFacts(batch, formatter, noValue, t),
                    ...(detail.costsVisible
                        ? costFacts(batch, detail.plan, formatter, noValue, t)
                        : [costsHiddenFact(noValue, t)]),
                ]}
            />

            {/*
             * A draft shows its plan, in the plan's own sections; a confirmed batch shows what it
             * claimed, as the table alone straight under the lens.
             */}
            {detail.plan === null ? (
                <BatchLinesPanel
                    first
                    bare
                    testID="kitchen-production-batch-lines"
                    lines={detail.lines}
                    costsVisible={detail.costsVisible}
                    withOutcome={batch.producedQuantity !== null}
                />
            ) : (
                <BatchPlanPanel
                    first
                    testID="kitchen-production-batch-plan"
                    plan={detail.plan}
                    costsVisible={detail.costsVisible}
                />
            )}

            <BatchSettlementDialog
                testID="kitchen-production-batch-settlement"
                open={settlement !== null}
                mode={settlement ?? 'complete'}
                lines={detail.lines}
                yieldUnitCode={batch.plannedYieldUnitCode}
                shelfLifeDays={batch.recipeShelfLifeDays}
                draft={draft}
                onChange={setDraft}
                onSubmit={submitSettlement}
                onClose={() => {
                    setSettlement(null);
                }}
                submitting={completeBatch.isPending || abandonBatch.isPending}
                failureMessage={settlementFailure?.message ?? null}
            />

            <Dialog
                testID="kitchen-production-batch-cancel-dialog"
                open={cancelling}
                onClose={() => {
                    setCancelling(false);
                }}
                title={t('kitchen:ops.production.cancelTitle')}
                actions={
                    <>
                        <Button
                            testID="kitchen-production-batch-cancel-dismiss"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setCancelling(false);
                            }}
                        />
                        <Button
                            testID="kitchen-production-batch-cancel-submit"
                            variant="danger"
                            label={t('kitchen:ops.production.cancelSubmit')}
                            loading={cancelBatch.isPending}
                            onPress={() => {
                                cancelBatch.mutate(
                                    {
                                        productionOrderId: batch.id,
                                        lockVersion: batch.lockVersion,
                                    },
                                    {
                                        onSuccess: () => {
                                            setCancelling(false);
                                            toast.show({
                                                testID: 'kitchen-production-batch-toast',
                                                tone: 'success',
                                                message: t('kitchen:ops.production.cancelledToast'),
                                            });
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    <Text>{t('kitchen:ops.production.cancelBody')}</Text>
                    {/*
                     * Said before the press, not only after the refusal: a cook whose batch has
                     * already eaten flour needs to know that abandoning is the route, and finding
                     * that out from a red sentence under a button they have just pressed is finding
                     * it out late.
                     */}
                    {batch.status === 'in_production' ? (
                        <Text tone="secondary" testID="kitchen-production-batch-cancel-warning">
                            {t('kitchen:ops.production.cancelBlocked')}
                        </Text>
                    ) : null}
                    {/*
                     * Only the ledger knows whether stock has moved, so the refusal is surfaced as
                     * the server sends it rather than guessed at from the status. A batch in
                     * production that genuinely took nothing may still be called off.
                     */}
                    {cancelFailure === null ? null : (
                        <Text tone="danger" testID="kitchen-production-batch-cancel-error">
                            {cancelFailure.message}
                        </Text>
                    )}
                </Stack>
            </Dialog>
            <EditorGuardDialogs guard={guard} testID="kitchen-production-batch-screen" />
        </Cascade>
    );
}

type Formatter = ReturnType<typeof useFormatter>;
type FigureFormat = (value: string | null, unitCode?: string | null) => string;

/**
 * The batch's numbers: what it is meant to make and how many times over, how many shelves are
 * short while it is a draft, then what came out — the dash until something has — with Usable last,
 * set apart and carrying the brand dot, because it is what the batch is for.
 */
function batchFigures(
    batch: ProductionOrder,
    plan: ProductionPlan | null,
    figure: FigureFormat,
    t: TFunction,
): readonly RecordLensFigure[] {
    const unit = batch.plannedYieldUnitCode;
    const outcome = (key: string, labelKey: string, value: string | null): RecordLensFigure => ({
        key,
        label: t(labelKey),
        value: figure(value, unit),
        empty: value === null,
        testID: `kitchen-production-batch-yield-${key}`,
    });

    return [
        {
            key: 'planned',
            label: t('kitchen:ops.production.yieldPlanned'),
            value: figure(batch.plannedYield, unit),
            testID: 'kitchen-production-batch-yield-planned',
        },
        {
            key: 'runs',
            label: t('kitchen:ops.production.summaryRuns'),
            value:
                batch.batchFactor === null
                    ? t('kitchen:list.noValue')
                    : t('kitchen:ops.production.summaryRunsValue', {
                          factor: figure(batch.batchFactor),
                      }),
            empty: batch.batchFactor === null,
            testID: 'kitchen-production-batch-runs',
        },
        ...(plan === null
            ? []
            : [
                  {
                      key: 'short',
                      label: t('kitchen:ops.production.statShort'),
                      value: String(plan.shortLineCount),
                      // A dot only while a shelf is short: it blocks the batch.
                      ...(plan.shortLineCount > 0 ? { tone: 'danger' as const } : {}),
                      testID: 'kitchen-production-batch-short',
                  },
              ]),
        outcome('produced', 'kitchen:ops.production.yieldProduced', batch.producedQuantity),
        outcome('rejected', 'kitchen:ops.production.yieldRejected', batch.rejectedQuantity),
        outcome('variance', 'kitchen:ops.production.yieldVariance', batch.yieldVarianceQuantity),
        {
            ...outcome('usable', 'kitchen:ops.production.yieldUsable', batch.usableYieldQuantity),
            tone: 'brand',
            separated: true,
        },
    ];
}

/** The batch record — its lot, its dates and where it is kept — as the lens's facts. */
function recordFacts(
    batch: ProductionOrder,
    formatter: Formatter,
    noValue: string,
    t: TFunction,
): readonly RecordLensFact[] {
    const day = (value: string | null): string =>
        value === null ? noValue : formatter.formatDate(localDay(value), { dateStyle: 'medium' });
    const fact = (key: string, labelKey: string, display: string): RecordLensFact => ({
        key,
        label: t(labelKey),
        value: 0,
        display,
        testID: `kitchen-production-batch-${key}`,
    });

    return [
        fact('lot', 'kitchen:ops.production.lotLabel', formatLot(batch.lotNumber) ?? noValue),
        fact(
            'production-date',
            'kitchen:ops.production.productionDateLabel',
            day(batch.productionDate),
        ),
        {
            ...fact('expiry', 'kitchen:ops.production.expiryDateLabel', day(batch.expiryDate)),
            // Gone by: a warning dot on the date itself, the notice behind its (i).
            ...(batch.isExpired
                ? {
                      value: 1,
                      tone: 'warning' as const,
                      info: t('kitchen:ops.production.expiredNotice'),
                  }
                : {}),
        },
        fact(
            'storage',
            'kitchen:ops.production.storageLocationLabel',
            batch.storageLocation ?? noValue,
        ),
        // What a cook typed before lots were minted — only old batches have it.
        ...(batch.batchReference === null
            ? []
            : [
                  fact(
                      'reference',
                      'kitchen:ops.production.batchReferenceLabel',
                      batch.batchReference,
                  ),
              ]),
    ];
}

/**
 * What the batch costs, or why nobody can say.
 *
 * The estimate is the order's once confirm has priced it, and the live plan's until then. **Withheld
 * rather than partial**: an uncosted line or two currencies leave the unit cost null with the reason
 * behind its (i), because a total over the lines that happened to carry a price reads like a whole
 * one and is smaller.
 */
function costFacts(
    batch: ProductionOrder,
    plan: ProductionPlan | null,
    formatter: Formatter,
    noValue: string,
    t: TFunction,
): readonly RecordLensFact[] {
    const money = (amount: string | null | undefined, currency: string | null | undefined) =>
        amount === null || amount === undefined
            ? noValue
            : formatMoney(formatter, Number(amount), knownCurrency(currency));

    const status = batch.actualCostStatus ?? null;
    const fromPlan = batch.confirmedAt === null && plan !== null;
    const uncosted = fromPlan ? (plan.uncostedLineCount ?? 0) : 0;
    const conflict = fromPlan ? (plan.currencyConflict ?? false) : false;
    // Withheld unless the valuation is complete: a partial unit cost reads exactly like a whole one
    // and is smaller, which is the direction that misprices food.
    const withheld = status !== null && status !== 'complete';
    const estimateInfo = conflict
        ? t('kitchen:ops.production.currencyConflict')
        : uncosted > 0
          ? t('kitchen:ops.production.uncostedLines', { count: uncosted })
          : undefined;

    return [
        {
            key: 'cost-estimated',
            label: t('kitchen:ops.production.estimatedCostFact'),
            value: 0,
            display: fromPlan
                ? money(plan.estimatedCostAmount, plan.currencyCode)
                : money(batch.estimatedCostAmount, batch.estimatedCostCurrencyCode),
            separated: true,
            ...(estimateInfo === undefined ? {} : { info: estimateInfo }),
            testID: 'kitchen-production-batch-cost-estimated',
        },
        {
            key: 'cost-actual',
            label: t('kitchen:ops.production.actualCostFact'),
            value: 0,
            display: money(batch.actualCostAmount, batch.actualCostCurrencyCode),
            testID: 'kitchen-production-batch-cost-actual',
        },
        {
            key: 'cost-unit',
            label: t('kitchen:ops.production.unitCostLabel'),
            value: 1,
            display:
                status === 'complete'
                    ? money(batch.actualUnitCostAmount, batch.actualCostCurrencyCode)
                    : status === null
                      ? noValue
                      : t('kitchen:ops.production.costWithheld'),
            ...(withheld
                ? {
                      tone: 'warning' as const,
                      // The valuation's own reason, else what kind of gap it is.
                      info:
                          batch.valuationNote ??
                          t(
                              status === 'partial'
                                  ? 'kitchen:ops.production.costStatusPartial'
                                  : 'kitchen:ops.production.costStatusUnvalued',
                          ),
                  }
                : {}),
            testID: 'kitchen-production-batch-cost-unit',
        },
    ];
}

/**
 * Money this member may not see. The cost keys are missing from the payload, not null, so the page
 * says that much — behind the (i) of one quiet fact — rather than drawing a zero.
 */
function costsHiddenFact(noValue: string, t: TFunction): RecordLensFact {
    return {
        key: 'costs-hidden',
        label: t('kitchen:ops.production.headingCost'),
        value: 0,
        display: noValue,
        separated: true,
        info: t('kitchen:ops.production.costsHiddenTitle'),
        testID: 'kitchen-production-batch-costs-hidden',
    };
}

/**
 * Whether calling the batch off is worth offering at all.
 *
 * A draft or a confirmed batch always is. One in production **may** be, and only the ledger knows:
 * the server allows it exactly while no movement exists against the order. Offering it and letting
 * the refusal explain itself is better than hiding the control from a cook whose batch genuinely
 * took nothing, which would leave them with abandon as the only exit and a false loss on the books.
 */
function isCallableOff(batch: ProductionOrder): boolean {
    return (
        batch.status === 'draft' || batch.status === 'confirmed' || batch.status === 'in_production'
    );
}

/**
 * The batch's history as steps: confirmed, started, then how it ended — completed, or cancelled or
 * abandoned when that is what happened. A step not taken yet is a hollow dot and the dash, so a
 * draft shows the road ahead of it. A step on the same day as the one before it shows the time
 * alone.
 */
function steps(
    batch: ProductionOrder,
    formatter: Formatter,
    t: TFunction,
): readonly RecordLensStep[] {
    const ending =
        batch.cancelledAt !== null
            ? {
                  key: 'cancelled',
                  labelKey: 'kitchen:ops.production.cancelledAtLabel',
                  at: batch.cancelledAt,
              }
            : batch.abandonedAt !== null
              ? {
                    key: 'abandoned',
                    labelKey: 'kitchen:ops.production.abandonedAtLabel',
                    at: batch.abandonedAt,
                }
              : {
                    key: 'completed',
                    labelKey: 'kitchen:ops.production.completedAtLabel',
                    at: batch.completedAt,
                };
    const candidates: readonly { key: string; labelKey: string; at: string | null }[] = [
        {
            key: 'confirmed',
            labelKey: 'kitchen:ops.production.confirmedAtLabel',
            at: batch.confirmedAt,
        },
        { key: 'started', labelKey: 'kitchen:ops.production.startedAtLabel', at: batch.startedAt },
        ending,
    ];

    let previousDay: string | null = null;
    return candidates.map((candidate) => {
        if (candidate.at === null) {
            return { key: candidate.key, label: t(candidate.labelKey), at: null };
        }
        const day = formatter.formatDate(candidate.at, { dateStyle: 'medium' });
        const at =
            day === previousDay
                ? formatter.formatDate(candidate.at, { timeStyle: 'short' })
                : formatter.formatDate(candidate.at, { dateStyle: 'medium', timeStyle: 'short' });
        previousDay = day;
        return {
            key: candidate.key,
            label: t(candidate.labelKey),
            at,
            testID: `kitchen-production-batch-stamp-${candidate.key}`,
        };
    });
}
