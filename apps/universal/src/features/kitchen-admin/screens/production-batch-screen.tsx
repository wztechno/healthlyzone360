import type { ProductionOrder } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Dialog,
    EmptyState,
    ErrorState,
    Heading,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import { ProductionOrderId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
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
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
import { nextProductionEdge, productionStatusKey, productionStatusTone } from '../ops-format.ts';
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
        return <Skeleton testID="kitchen-production-batch-loading" heightClassName="h-64" />;
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

    return (
        <Stack space="lg" testID="kitchen-production-batch-screen">
            <KitchenPageHeader
                testID="kitchen-production-batch-header"
                title={
                    batch.reference === null
                        ? t('kitchen:ops.production.batchFallbackTitle')
                        : t('kitchen:ops.production.batchTitle', { reference: batch.reference })
                }
                subtitle={batch.productionItemNameEn ?? undefined}
                statusChip={
                    <Badge
                        testID="kitchen-production-batch-status"
                        tone={productionStatusTone(batch.status)}
                        label={t(productionStatusKey(batch.status))}
                    />
                }
                back={
                    <View className="flex-row">
                        <Button
                            testID="kitchen-production-batch-back"
                            variant="ghost"
                            size="sm"
                            label={t('kitchen:ops.production.backToDesk')}
                            onPress={() => {
                                router.push('/kitchen/production-desk');
                            }}
                        />
                    </View>
                }
                actions={
                    <View className="flex-row flex-wrap items-center gap-2">
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
                        {canManage && isCallableOff(batch) ? (
                            <Button
                                testID="kitchen-production-batch-cancel"
                                variant="quiet"
                                size="sm"
                                label={t('kitchen:ops.production.cancelBatch')}
                                onPress={() => {
                                    cancelBatch.reset();
                                    setCancelling(true);
                                }}
                            />
                        ) : null}
                    </View>
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

            {batch.producedQuantity === null ? null : (
                <Stack space="sm" testID="kitchen-production-batch-yield">
                    <Heading level={2}>{t('kitchen:ops.production.headingYield')}</Heading>
                    <View className="flex-row flex-wrap gap-x-8 gap-y-3">
                        <Figure
                            testID="kitchen-production-batch-yield-planned"
                            label={t('kitchen:ops.production.yieldPlanned')}
                            value={withUnit(
                                batch.plannedYield,
                                batch.plannedYieldUnitCode,
                                noValue,
                            )}
                        />
                        <Figure
                            testID="kitchen-production-batch-yield-produced"
                            label={t('kitchen:ops.production.yieldProduced')}
                            value={withUnit(
                                batch.producedQuantity,
                                batch.plannedYieldUnitCode,
                                noValue,
                            )}
                        />
                        <Figure
                            testID="kitchen-production-batch-yield-rejected"
                            label={t('kitchen:ops.production.yieldRejected')}
                            value={withUnit(
                                batch.rejectedQuantity,
                                batch.plannedYieldUnitCode,
                                noValue,
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
                            value={withUnit(
                                batch.usableYieldQuantity,
                                batch.plannedYieldUnitCode,
                                noValue,
                            )}
                            strong
                        />
                        <Figure
                            testID="kitchen-production-batch-yield-variance"
                            label={t('kitchen:ops.production.yieldVariance')}
                            value={withUnit(
                                batch.yieldVarianceQuantity,
                                batch.plannedYieldUnitCode,
                                noValue,
                            )}
                            caption={varianceCaption(batch, t)}
                        />
                    </View>
                </Stack>
            )}

            {detail.costsVisible ? (
                <CostBlock batch={batch} formatter={formatter} />
            ) : (
                <Callout
                    testID="kitchen-production-batch-costs-hidden"
                    tone="info"
                    title={t('kitchen:ops.production.costsHiddenTitle')}
                    body={t('kitchen:ops.production.costsHiddenBody')}
                />
            )}

            <Stack space="sm" testID="kitchen-production-batch-record">
                <Heading level={2}>{t('kitchen:ops.production.headingRecord')}</Heading>
                <View className="flex-row flex-wrap gap-x-8 gap-y-3">
                    <Figure
                        testID="kitchen-production-batch-production-date"
                        label={t('kitchen:ops.production.productionDateLabel')}
                        value={batch.productionDate ?? noValue}
                    />
                    <Figure
                        testID="kitchen-production-batch-reference"
                        label={t('kitchen:ops.production.batchReferenceLabel')}
                        value={batch.batchReference ?? noValue}
                    />
                    <Figure
                        testID="kitchen-production-batch-storage"
                        label={t('kitchen:ops.production.storageLocationLabel')}
                        value={batch.storageLocation ?? noValue}
                    />
                    <Figure
                        testID="kitchen-production-batch-expiry"
                        label={t('kitchen:ops.production.expiryDateLabel')}
                        value={batch.expiryDate ?? t('kitchen:ops.production.noExpiry')}
                    />
                </View>
                {/*
                 * The stamps, and only the ones that happened. A row of five labels with four em
                 * dashes under them says nothing about a draft; the batch's own history is what
                 * this block is for, and a batch that was never cancelled has no cancellation.
                 */}
                <View className="flex-row flex-wrap gap-x-8 gap-y-3">
                    {stamps(batch).map((stamp) => (
                        <Figure
                            key={stamp.key}
                            testID={`kitchen-production-batch-stamp-${stamp.key}`}
                            label={t(stamp.labelKey)}
                            value={formatter.formatDate(stamp.at, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                            })}
                        />
                    ))}
                </View>
                {batch.notes === null ? null : (
                    <Text tone="secondary" testID="kitchen-production-batch-notes">
                        {batch.notes}
                    </Text>
                )}
            </Stack>

            {detail.plan === null ? (
                <BatchLinesPanel
                    testID="kitchen-production-batch-lines"
                    lines={detail.lines}
                    costsVisible={detail.costsVisible}
                    withOutcome={batch.producedQuantity !== null}
                />
            ) : (
                <BatchPlanPanel
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

/** A labelled figure. Four words and a number — the unit of every read-only block on this page. */
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

function CostBlock({
    batch,
    formatter,
}: {
    readonly batch: ProductionOrder;
    readonly formatter: ReturnType<typeof useFormatter>;
}) {
    const { t } = useTranslation();
    const noValue = t('kitchen:list.noValue');

    const money = (amount: string | null | undefined, currency: string | null | undefined) =>
        amount === null || amount === undefined
            ? noValue
            : formatMoney(formatter, Number(amount), knownCurrency(currency));

    const status = batch.actualCostStatus ?? null;

    return (
        <Stack space="sm" testID="kitchen-production-batch-cost">
            <Heading level={2}>{t('kitchen:ops.production.headingCost')}</Heading>
            <View className="flex-row flex-wrap gap-x-8 gap-y-3">
                <Figure
                    testID="kitchen-production-batch-cost-estimated"
                    label={t('kitchen:ops.production.estimatedCost')}
                    value={money(batch.estimatedCostAmount, batch.estimatedCostCurrencyCode)}
                    caption={t('kitchen:ops.production.estimatedCostCaption')}
                />
                <Figure
                    testID="kitchen-production-batch-cost-actual"
                    label={t('kitchen:ops.production.actualCost')}
                    value={money(batch.actualCostAmount, batch.actualCostCurrencyCode)}
                    caption={t('kitchen:ops.production.actualCostCaption')}
                />
                <Figure
                    testID="kitchen-production-batch-cost-unit"
                    label={t('kitchen:ops.production.unitCostLabel')}
                    // Withheld unless the valuation is complete: a partial unit cost reads exactly
                    // like a whole one and is smaller, which is the direction that misprices food.
                    value={
                        status === 'complete'
                            ? money(batch.actualUnitCostAmount, batch.actualCostCurrencyCode)
                            : status === null
                              ? noValue
                              : t('kitchen:ops.production.costWithheld')
                    }
                    strong
                />
            </View>
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
        </Stack>
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

function withUnit(value: string | null, unitCode: string | null, fallback: string): string {
    if (value === null) return fallback;

    return `${value}${unitCode === null ? '' : ` ${unitCode}`}`;
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
