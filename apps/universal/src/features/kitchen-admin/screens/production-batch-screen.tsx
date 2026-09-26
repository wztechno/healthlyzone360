import type { ProductionOrder, ProductionPlan } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Dialog,
    EmptyState,
    ErrorState,
    Inline,
    RecordSkeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import { ProductionOrderId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useAbandonProductionOrderMutation,
    useCancelProductionOrderMutation,
    useCompleteProductionOrderMutation,
    useConfirmProductionOrderMutation,
    useProductionOrderQuery,
    useStartProductionOrderMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { todayIso } from '../../commerce/dates.ts';
import { PRODUCTION_MANAGE_PERMISSION, PRODUCTION_VIEW_PERMISSION } from '../entity-registry.ts';
import { formatMoney, knownCurrency } from '../format.ts';
import { CataloguePageHeader } from '../catalogue/catalogue-page-header.tsx';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { BATCH_QUANTITY_FORMAT } from '../operations/batch-sheet.tsx';
import {
    ledgerQuantity,
    nextProductionEdge,
    productionStatusKey,
    productionStatusTone,
} from '../ops-format.ts';
import { BatchLinesPanel } from '../production-desk/batch-lines-panel.tsx';
import { BatchPlanPanel } from '../production-desk/batch-plan-panel.tsx';
import { BatchSettlementDialog } from '../production-desk/batch-settlement-dialog.tsx';
import type { CompletionDraft } from '../production-desk/completion-model.ts';
import {
    abandonRequest,
    completionRequest,
    emptyCompletionDraft,
} from '../production-desk/completion-model.ts';

/**
 * `/kitchen/production-desk/{order}` — one batch, and every edge it has left (PROD1).
 *
 * ```
 * Kitchen workspace › Production › Batch B-0012        ← the trail; Production is the way back
 * Batch B-0012 [DRAFT] Classic Burger Sauce    [Technical sheet] [Call it off] [Confirm]
 * ┌ PLANNED ┐ ┌ RUNS ┐ ┌ SHELVES SHORT ┐ ┌ USABLE (once made) ┐
 * ┌ WHAT CAME OUT (once made) ─────────────┐   ┌ STATUS ── what it means · stamps · notes ┐
 * ┌ WHAT IT NEEDS / WHAT IT CLAIMED ───────┐   ┌ COST ── estimated · actual · per unit    ┐
 * │ Ingredients table · Packaging table    │   ┌ BATCH RECORD ── made on · label · …      ┐
 * └────────────────────────────────────────┘   beside from xl, under below it
 * ```
 *
 * The record page's shape (`record-view-page.tsx`): the work in a wide column, the batch's status,
 * money and record in a rail beside it, and the figures that say where the batch stands above both.
 * How many shelves are short is said once, in the figures, rather than again as a banner over the
 * table that shows which.
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

    const detail = record.data;
    const failure = toFailure(record.error);

    const title =
        detail === undefined
            ? null
            : detail.order.reference === null
              ? t('kitchen:ops.production.batchFallbackTitle')
              : t('kitchen:ops.production.batchTitle', { reference: detail.order.reference });
    // The trail names the batch and its Production crumb is the way back to the desk.
    useKitchenTrailLeaf(title, () => {
        router.push('/kitchen/production-desk');
    });

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

    const figure = (value: string | null, unitCode: string | null = null): string =>
        ledgerQuantity(
            (parsed) => formatter.formatNumber(parsed, BATCH_QUANTITY_FORMAT),
            value,
            unitCode,
            noValue,
        );

    const statusCaptionKey = STATUS_CAPTION[batch.status];
    const history = stamps(batch);

    return (
        <Stack space="md" testID="kitchen-production-batch-screen">
            {/*
             * The trail is the way back — `… › Production › Batch` with Production as the link —
             * so the header carries the batch, its state and every edge it has left, and nothing
             * that repeats the trail.
             */}
            <CataloguePageHeader
                testID="kitchen-production-batch-header"
                title={title ?? undefined}
                titleAside={
                    <>
                        <Badge
                            testID="kitchen-production-batch-status"
                            tone={productionStatusTone(batch.status)}
                            label={t(productionStatusKey(batch.status))}
                        />
                        {batch.productionItemNameEn === null ? null : (
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID="kitchen-production-batch-header-subtitle"
                            >
                                {batch.productionItemNameEn}
                            </Text>
                        )}
                    </>
                }
                primaryAction={
                    <Inline space="xs" align="center" wrap>
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
                    </Inline>
                }
            />

            {batch.isExpired ? (
                <Callout
                    testID="kitchen-production-batch-expired"
                    tone="danger"
                    role="alert"
                    title={t('kitchen:ops.production.expiredNotice')}
                />
            ) : null}

            {batch.abandonReason === null ? null : (
                <Callout
                    testID="kitchen-production-batch-abandon-reason"
                    tone="warning"
                    title={t('kitchen:ops.production.abandonReasonLabel')}
                    body={batch.abandonReason}
                />
            )}

            {/* The batch in four figures: what it is meant to make, and where it stands. */}
            <CatalogueStatCards
                testID="kitchen-production-batch-facts"
                cards={batchFacts(batch, detail.plan, detail.lines.length, figure, t)}
            />

            {/*
             * The work beside the record. Below `xl` the rail drops under the main column: with the
             * admin rail open, `lg` leaves it narrower than a field.
             */}
            <View
                testID="kitchen-production-batch-body"
                className="flex-col gap-base xl:flex-row xl:items-start"
            >
                <View className="min-w-0 flex-col gap-base xl:flex-[21]">
                    {batch.producedQuantity === null ? null : (
                        <Card
                            testID="kitchen-production-batch-yield"
                            tone="raised"
                            padding="md"
                            title={t('kitchen:ops.production.headingYield')}
                        >
                            <View className="flex-row flex-wrap gap-x-8 gap-y-3">
                                <Figure
                                    testID="kitchen-production-batch-yield-planned"
                                    label={t('kitchen:ops.production.yieldPlanned')}
                                    value={figure(batch.plannedYield, batch.plannedYieldUnitCode)}
                                />
                                <Figure
                                    testID="kitchen-production-batch-yield-produced"
                                    label={t('kitchen:ops.production.yieldProduced')}
                                    value={figure(
                                        batch.producedQuantity,
                                        batch.plannedYieldUnitCode,
                                    )}
                                />
                                <Figure
                                    testID="kitchen-production-batch-yield-rejected"
                                    label={t('kitchen:ops.production.yieldRejected')}
                                    value={figure(
                                        batch.rejectedQuantity,
                                        batch.plannedYieldUnitCode,
                                    )}
                                    caption={
                                        Number(batch.rejectedQuantity ?? '0') > 0
                                            ? t('kitchen:ops.production.yieldRejectedCaption')
                                            : undefined
                                    }
                                />
                                <Figure
                                    testID="kitchen-production-batch-yield-usable"
                                    label={t('kitchen:ops.production.yieldUsable')}
                                    value={figure(
                                        batch.usableYieldQuantity,
                                        batch.plannedYieldUnitCode,
                                    )}
                                    strong
                                />
                                <Figure
                                    testID="kitchen-production-batch-yield-variance"
                                    label={t('kitchen:ops.production.yieldVariance')}
                                    value={figure(
                                        batch.yieldVarianceQuantity,
                                        batch.plannedYieldUnitCode,
                                    )}
                                    caption={varianceCaption(batch, t)}
                                />
                            </View>
                        </Card>
                    )}

                    <Card
                        testID="kitchen-production-batch-needs"
                        tone="raised"
                        padding="md"
                        title={t(
                            detail.plan === null
                                ? 'kitchen:ops.production.headingLines'
                                : 'kitchen:ops.production.headingPlan',
                        )}
                        subtitle={
                            detail.plan === null
                                ? undefined
                                : t('kitchen:ops.production.planLiveCaption')
                        }
                    >
                        {detail.plan === null ? (
                            <BatchLinesPanel
                                headless
                                testID="kitchen-production-batch-lines"
                                lines={detail.lines}
                                costsVisible={detail.costsVisible}
                                withOutcome={batch.producedQuantity !== null}
                            />
                        ) : (
                            <BatchPlanPanel
                                headless
                                testID="kitchen-production-batch-plan"
                                plan={detail.plan}
                                costsVisible={detail.costsVisible}
                            />
                        )}
                    </Card>
                </View>

                <View
                    testID="kitchen-production-batch-rail"
                    className="min-w-0 flex-col gap-base xl:flex-[10]"
                >
                    <Card
                        testID="kitchen-production-batch-state"
                        tone="brand"
                        padding="md"
                        title={t('kitchen:ops.production.statusTitle')}
                    >
                        {statusCaptionKey === undefined ? null : (
                            <Text variant="caption" tone="secondary">
                                {t(statusCaptionKey)}
                            </Text>
                        )}
                        {/*
                         * The stamps, and only the ones that happened. A row of five labels with
                         * four em dashes under them says nothing about a draft; the batch's own
                         * history is what this card is for, and a batch that was never cancelled
                         * has no cancellation.
                         */}
                        {history.map((stamp) => (
                            <RailRow
                                key={stamp.key}
                                testID={`kitchen-production-batch-stamp-${stamp.key}`}
                                label={t(stamp.labelKey)}
                                value={formatter.formatDate(stamp.at, {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                })}
                            />
                        ))}
                        {batch.notes === null ? null : (
                            <Text tone="secondary" testID="kitchen-production-batch-notes">
                                {batch.notes}
                            </Text>
                        )}
                    </Card>

                    {detail.costsVisible ? (
                        <CostCard batch={batch} plan={detail.plan} formatter={formatter} />
                    ) : (
                        <Callout
                            testID="kitchen-production-batch-costs-hidden"
                            tone="info"
                            title={t('kitchen:ops.production.costsHiddenTitle')}
                            body={t('kitchen:ops.production.costsHiddenBody')}
                        />
                    )}

                    <Card
                        testID="kitchen-production-batch-record"
                        tone="raised"
                        padding="md"
                        title={t('kitchen:ops.production.headingRecord')}
                    >
                        <RailRow
                            testID="kitchen-production-batch-production-date"
                            label={t('kitchen:ops.production.productionDateLabel')}
                            value={batch.productionDate ?? noValue}
                        />
                        <RailRow
                            testID="kitchen-production-batch-reference"
                            label={t('kitchen:ops.production.batchReferenceLabel')}
                            value={batch.batchReference ?? noValue}
                        />
                        <RailRow
                            testID="kitchen-production-batch-storage"
                            label={t('kitchen:ops.production.storageLocationLabel')}
                            value={batch.storageLocation ?? noValue}
                        />
                        <RailRow
                            testID="kitchen-production-batch-expiry"
                            label={t('kitchen:ops.production.expiryDateLabel')}
                            value={batch.expiryDate ?? t('kitchen:ops.production.noExpiry')}
                        />
                    </Card>
                </View>
            </View>

            <BatchSettlementDialog
                testID="kitchen-production-batch-settlement"
                open={settlement !== null}
                mode={settlement ?? 'complete'}
                lines={detail.lines}
                yieldUnitCode={batch.plannedYieldUnitCode}
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
        </Stack>
    );
}

/** A labelled figure. Four words and a number — the unit of the yield card. */
function Figure({
    testID,
    label,
    value,
    caption,
    strong = false,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
    readonly caption?: string | undefined;
    readonly strong?: boolean;
}) {
    return (
        <View className="min-w-32 flex-col gap-0.5">
            <Text variant="caption" tone="secondary">
                {label}
            </Text>
            <Text variant={strong ? 'bodyStrong' : 'body'} testID={testID}>
                {value}
            </Text>
            {caption === undefined ? null : (
                <Text variant="caption" tone="secondary" className="max-w-64">
                    {caption}
                </Text>
            )}
        </View>
    );
}

/** One fact in a rail card: the label at the start, the value at the end, on one line. */
function RailRow({
    testID,
    label,
    value,
    caption,
    strong = false,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
    readonly caption?: string | undefined;
    readonly strong?: boolean;
}) {
    return (
        <View className="flex-col gap-hair">
            <View className="flex-row items-baseline justify-between gap-tight">
                <Text variant="caption" tone="secondary">
                    {label}
                </Text>
                <Text
                    variant={strong ? 'bodyStrong' : 'body'}
                    testID={testID}
                    numberOfLines={1}
                    className="text-end"
                >
                    {value}
                </Text>
            </View>
            {caption === undefined ? null : (
                <Text variant="caption" tone="secondary">
                    {caption}
                </Text>
            )}
        </View>
    );
}

/** What a status means for the shelves, in the words the desk's own figures use. */
const STATUS_CAPTION: Readonly<Partial<Record<ProductionOrder['status'], string>>> = {
    draft: 'kitchen:ops.production.statDraftCaption',
    confirmed: 'kitchen:ops.production.statConfirmedCaption',
    in_production: 'kitchen:ops.production.statInProductionCaption',
    completed: 'kitchen:ops.production.statCompletedCaption',
};

/**
 * The batch in figures: what it is meant to make, how many times over, and where the shelves stand
 * — against the live plan while it is a draft, against its own claims once confirmed — then what
 * came out, once something has.
 */
function batchFacts(
    batch: ProductionOrder,
    plan: ProductionPlan | null,
    lineCount: number,
    figure: (value: string | null, unitCode?: string | null) => string,
    t: TFunction,
): readonly CatalogueStatCard[] {
    const cards: CatalogueStatCard[] = [
        {
            key: 'planned',
            label: t('kitchen:ops.production.yieldPlanned'),
            value: figure(batch.plannedYield),
            ...(batch.plannedYieldUnitCode === null ? {} : { unit: batch.plannedYieldUnitCode }),
            caption: batch.productionItemNameEn ?? t('kitchen:ops.production.plannedCaption'),
            mark: 'package',
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
            caption: t('kitchen:ops.production.runsCaption'),
            mark: 'cookingPot',
        },
        plan === null
            ? {
                  key: 'lines',
                  label: t('kitchen:ops.production.statLines'),
                  value: String(lineCount),
                  caption: t('kitchen:ops.production.statLinesCaption'),
                  mark: 'clipboardList',
              }
            : {
                  key: 'short',
                  label: t('kitchen:ops.production.statShort'),
                  value: String(plan.shortLineCount),
                  caption:
                      plan.shortLineCount === 0
                          ? t('kitchen:ops.production.planReady')
                          : t('kitchen:ops.production.planShort', {
                                count: plan.shortLineCount,
                            }),
                  mark: 'alert',
                  tone: plan.shortLineCount === 0 ? 'default' : 'danger',
              },
    ];

    if (batch.usableYieldQuantity !== null) {
        cards.push({
            key: 'usable',
            label: t('kitchen:ops.production.yieldUsable'),
            value: figure(batch.usableYieldQuantity),
            ...(batch.plannedYieldUnitCode === null ? {} : { unit: batch.plannedYieldUnitCode }),
            caption: t('kitchen:ops.production.usableCaption'),
            mark: 'packageCheck',
            tone: 'brand',
        });
    }

    return cards;
}

/**
 * What the batch costs, or why nobody can say.
 *
 * The estimate is the order's once confirm has priced it, and the live plan's until then — one
 * figure in one place, where the page used to state a draft's estimate twice. **Withheld rather
 * than partial**: an uncosted line or two currencies leave it null with the reason beside it,
 * because a total over the lines that happened to carry a price reads like a whole one and is
 * smaller.
 */
function CostCard({
    batch,
    plan,
    formatter,
}: {
    readonly batch: ProductionOrder;
    readonly plan: ProductionPlan | null;
    readonly formatter: ReturnType<typeof useFormatter>;
}) {
    const { t } = useTranslation();
    const noValue = t('kitchen:list.noValue');

    const money = (amount: string | null | undefined, currency: string | null | undefined) =>
        amount === null || amount === undefined
            ? noValue
            : formatMoney(formatter, Number(amount), knownCurrency(currency));

    const status = batch.actualCostStatus ?? null;
    const fromPlan = batch.confirmedAt === null && plan !== null;
    const uncosted = fromPlan ? (plan.uncostedLineCount ?? 0) : 0;
    const conflict = fromPlan ? (plan.currencyConflict ?? false) : false;

    return (
        <Card
            testID="kitchen-production-batch-cost"
            tone="raised"
            padding="md"
            title={t('kitchen:ops.production.headingCost')}
        >
            <RailRow
                testID="kitchen-production-batch-cost-estimated"
                label={t('kitchen:ops.production.estimatedCost')}
                value={
                    fromPlan
                        ? money(plan.estimatedCostAmount, plan.currencyCode)
                        : money(batch.estimatedCostAmount, batch.estimatedCostCurrencyCode)
                }
                caption={
                    conflict
                        ? t('kitchen:ops.production.currencyConflict')
                        : uncosted > 0
                          ? t('kitchen:ops.production.uncostedLines', { count: uncosted })
                          : fromPlan
                            ? t('kitchen:ops.production.estimatedLiveCaption')
                            : t('kitchen:ops.production.estimatedCostCaption')
                }
            />
            <RailRow
                testID="kitchen-production-batch-cost-actual"
                label={t('kitchen:ops.production.actualCost')}
                value={money(batch.actualCostAmount, batch.actualCostCurrencyCode)}
                caption={t('kitchen:ops.production.actualCostCaption')}
            />
            <RailRow
                testID="kitchen-production-batch-cost-unit"
                label={t('kitchen:ops.production.unitCostLabel')}
                // Withheld unless the valuation is complete: a partial unit cost reads exactly like
                // a whole one and is smaller, which is the direction that misprices food.
                value={
                    status === 'complete'
                        ? money(batch.actualUnitCostAmount, batch.actualCostCurrencyCode)
                        : status === null
                          ? noValue
                          : t('kitchen:ops.production.costWithheld')
                }
                strong
            />
            {status === 'partial' || status === 'unvalued' ? (
                <Callout
                    testID="kitchen-production-batch-cost-status"
                    tone="warning"
                    title={t(
                        status === 'partial'
                            ? 'kitchen:ops.production.costStatusPartial'
                            : 'kitchen:ops.production.costStatusUnvalued',
                    )}
                    body={
                        batch.valuationNote ??
                        t(
                            status === 'partial'
                                ? 'kitchen:ops.production.costStatusPartialBody'
                                : 'kitchen:ops.production.costStatusUnvaluedBody',
                        )
                    }
                />
            ) : null}
        </Card>
    );
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
 * The lifecycle stamps a batch actually carries, in the order they happen.
 *
 * Only the ones that happened: five labels with four em dashes under them is a row that says
 * nothing about a draft, and this block exists to say what the batch's history is.
 */
function stamps(batch: ProductionOrder): readonly { key: string; labelKey: string; at: string }[] {
    const candidates: readonly { key: string; labelKey: string; at: string | null }[] = [
        {
            key: 'confirmed',
            labelKey: 'kitchen:ops.production.confirmedAtLabel',
            at: batch.confirmedAt,
        },
        { key: 'started', labelKey: 'kitchen:ops.production.startedAtLabel', at: batch.startedAt },
        {
            key: 'completed',
            labelKey: 'kitchen:ops.production.completedAtLabel',
            at: batch.completedAt,
        },
        {
            key: 'cancelled',
            labelKey: 'kitchen:ops.production.cancelledAtLabel',
            at: batch.cancelledAt,
        },
        {
            key: 'abandoned',
            labelKey: 'kitchen:ops.production.abandonedAtLabel',
            at: batch.abandonedAt,
        },
    ];

    return candidates.flatMap((candidate) =>
        candidate.at === null
            ? []
            : [{ key: candidate.key, labelKey: candidate.labelKey, at: candidate.at }],
    );
}

function varianceCaption(batch: ProductionOrder, t: (key: string) => string): string | undefined {
    if (batch.yieldVarianceQuantity === null) return undefined;

    const variance = Number(batch.yieldVarianceQuantity);
    if (variance === 0) return undefined;

    return t(
        variance < 0
            ? 'kitchen:ops.production.yieldVarianceLossCaption'
            : 'kitchen:ops.production.yieldVarianceOverCaption',
    );
}
