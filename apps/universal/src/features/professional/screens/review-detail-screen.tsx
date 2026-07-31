import {
    Badge,
    Button,
    Callout,
    Card,
    Dialog,
    Heading,
    Inline,
    NumberStepper,
    SegmentedControl,
    Stack,
    Table,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { REVIEW_PRIORITIES } from '@healthy360/api-client/contracts';
import type { MealPlanWeek, ReviewPriority } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { MacroTarget, NutritionConstraint } from '@healthy360/nutrition';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useApproveReviewMutation,
    useRequestChangesMutation,
    useReviewQuery,
    useSetDietitianNoteMutation,
    useSetOverrideMutation,
} from '../../../data/professional-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { PlannerAnnouncer, usePlannerAnnouncement } from '../../planner/announcer.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import {
    PRIORITY_ICON,
    PRIORITY_TONE,
    QUEUE_STATE_TONE,
    SEVERITY_TONE,
    declaredConstraints,
    enforcedConstraints,
    priorityKey,
    queueStateKey,
    reasonKey,
    restrictionKindKey,
    subjectKey,
    warningKey,
} from '../format.ts';

/**
 * `/dietitian/reviews/{review}` — everything a professional needs before deciding, and the decision.
 *
 * ## Four controls, three of which really change the world
 *
 * Approve, request changes, set an override and leave a note all exist on `ProfessionalRepository`
 * and all are honoured by the prototype store: approving a target marks it professionally approved
 * and stamps the approving dietitian on it; approving a plan writes a `professionally_approved`
 * event; an override re-runs the engine with a `ProfessionalOverride` attached rather than writing a
 * number in from nowhere. None of them is a prototype notice, because the rule is that a notice is
 * for capabilities that are genuinely absent (`src/prototype/prototype-action.ts`).
 *
 * ## `dietitian_enforced` restrictions are shown apart from everything else
 *
 * The client declared their own allergies, dislikes and observances; a professional set the enforced
 * ones, and only a professional may lift them. Merging the two lists would hide exactly the
 * distinction this screen exists to act on, so they are two blocks with two headings and the
 * enforced block states who may change it.
 *
 * ## The signature is collected, not defaulted
 *
 * `ApproveReviewRequest.signature` is recorded against the professional's registration and shown to
 * the client on the plan. Defaulting it to the signed-in display name would be the interface signing
 * on somebody's behalf, so approval is disabled until it is typed.
 */

export interface ReviewDetailScreenProps {
    readonly reviewId: string | undefined;
}

type OpenDialog = 'approve' | 'changes' | 'override' | 'note' | null;

export function ReviewDetailScreen({ reviewId }: ReviewDetailScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { message, announce } = usePlannerAnnouncement();

    const query = useReviewQuery(reviewId ?? null);
    const detail = query.data;

    const [dialog, setDialog] = useState<OpenDialog>(null);
    const [signature, setSignature] = useState('');
    const [changeNote, setChangeNote] = useState('');
    const [changePriority, setChangePriority] = useState<ReviewPriority>('soon');
    const [overrideEnergy, setOverrideEnergy] = useState<number | null>(null);
    const [overrideReason, setOverrideReason] = useState('');
    const [planNote, setPlanNote] = useState('');

    const approve = useApproveReviewMutation();
    const requestChanges = useRequestChangesMutation();
    const setOverride = useSetOverrideMutation();
    const setNote = useSetDietitianNoteMutation();

    const failure =
        toFailure(approve.error) ??
        toFailure(requestChanges.error) ??
        toFailure(setOverride.error) ??
        toFailure(setNote.error);

    const close = () => {
        setDialog(null);
    };

    const backAction = (
        <Button
            testID="review-detail-back"
            variant="secondary"
            label={t('professional:review.back')}
            onPress={() => {
                router.push('/dietitian' as never);
            }}
        />
    );

    const constraints = detail?.target?.result.request.constraints;
    const enforced = enforcedConstraints(constraints);
    const declared = declaredConstraints(constraints);

    const macroColumns: readonly TableColumn<MacroTarget>[] = [
        {
            key: 'nutrient',
            header: t('professional:target.macro'),
            rowHeader: true,
            render: (macro) => (
                <Text>
                    {t(`nutrition:nutrients.${macro.nutrientId}`, {
                        defaultValue: macro.nutrientId,
                    })}
                </Text>
            ),
        },
        {
            key: 'grams',
            header: t('professional:target.grams'),
            render: (macro) => (
                <Text>
                    {t('professional:target.gramsValue', { value: Math.round(macro.grams) })}
                </Text>
            ),
        },
        {
            key: 'share',
            header: t('professional:target.share'),
            render: (macro) => (
                <Text>
                    {t('professional:target.shareValue', {
                        value: formatter.formatNumber(macro.percentageOfEnergy, {
                            maximumFractionDigits: 1,
                        }),
                    })}
                </Text>
            ),
        },
        {
            key: 'tolerance',
            header: t('professional:target.tolerance'),
            render: (macro) => (
                <Text>
                    {t('professional:target.toleranceValue', {
                        min: Math.round(macro.tolerance.min),
                        max: Math.round(macro.tolerance.max),
                    })}
                </Text>
            ),
        },
    ];

    return (
        <Stack space="lg" testID="review-detail-screen">
            <PlannerAnnouncer message={message} testID="review-announcer" />

            <QueryStates
                query={query}
                isEmpty={detail === undefined}
                emptyTitle={t('professional:review.notFoundTitle')}
                emptyBody={t('professional:review.notFoundBody')}
                emptyActions={backAction}
                skeletonCount={3}
                testID="review-detail"
            >
                {detail === undefined ? null : (
                    <Stack space="lg">
                        <Stack space="xs">
                            <Heading level={1} testID="review-detail-client">
                                {detail.item.clientDisplayName}
                            </Heading>
                            <Inline space="xs" wrap>
                                <Badge
                                    testID="review-detail-subject"
                                    tone="info"
                                    icon="info"
                                    label={t(subjectKey(detail.item.subject))}
                                />
                                <Badge
                                    testID="review-detail-state"
                                    tone={QUEUE_STATE_TONE[detail.item.state]}
                                    icon="dot"
                                    label={t(queueStateKey(detail.item.state))}
                                />
                                <Badge
                                    testID="review-detail-priority"
                                    tone={PRIORITY_TONE[detail.item.priority]}
                                    icon={PRIORITY_ICON[detail.item.priority]}
                                    label={t(priorityKey(detail.item.priority))}
                                />
                            </Inline>
                            <Text
                                tone="secondary"
                                variant="caption"
                                testID="review-detail-requested"
                            >
                                {t('professional:queue.requested', {
                                    date: formatter.formatDate(detail.item.requestedAt, {
                                        dateStyle: 'full',
                                    }),
                                })}
                            </Text>
                        </Stack>

                        <MedicalDisclaimer context={t('professional:review.disclaimerContext')} />

                        <Stack space="xs" testID="review-detail-reasons">
                            <Text variant="label">{t('professional:review.reasonsTitle')}</Text>
                            {detail.item.reasons.length === 0 ? (
                                <Text tone="secondary">{t('professional:queue.noReasons')}</Text>
                            ) : (
                                detail.item.reasons.map((code) => (
                                    <Text key={code} testID={`review-detail-reason-${code}`}>
                                        {t(reasonKey(code), { defaultValue: code })}
                                    </Text>
                                ))
                            )}
                        </Stack>

                        <Stack space="xs" testID="review-detail-context">
                            <Text variant="label">{t('professional:review.contextTitle')}</Text>
                            {detail.context.map((line, index) => (
                                <Text
                                    key={line}
                                    testID={`review-detail-context-${String(index + 1)}`}
                                >
                                    {line}
                                </Text>
                            ))}
                        </Stack>

                        {detail.clientNote === null ? null : (
                            <Callout
                                testID="review-detail-client-note"
                                role="note"
                                tone="info"
                                icon="info"
                                title={t('professional:review.clientNoteTitle')}
                                body={detail.clientNote}
                            />
                        )}

                        {detail.target === null ? (
                            <Text tone="secondary" testID="review-detail-no-target">
                                {t('professional:review.noTarget')}
                            </Text>
                        ) : (
                            <Stack space="sm" testID="review-detail-target">
                                <Text variant="label">{t('professional:target.title')}</Text>

                                <Text testID="review-detail-maintenance">
                                    {t('professional:target.maintenance', {
                                        value: Math.round(detail.target.result.maintenanceEnergy),
                                    })}
                                </Text>
                                <Text testID="review-detail-target-energy">
                                    {t('professional:target.energy', {
                                        value: Math.round(detail.target.result.targetEnergy),
                                    })}
                                </Text>
                                <Text
                                    testID="review-detail-target-tolerance"
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {t('professional:target.toleranceValue', {
                                        min: Math.round(detail.target.result.energyTolerance.min),
                                        max: Math.round(detail.target.result.energyTolerance.max),
                                    })}
                                </Text>

                                <Table
                                    testID="review-detail-macros"
                                    caption={t('professional:target.macrosCaption')}
                                    columns={macroColumns}
                                    rows={[...detail.target.result.macros]}
                                    rowKey={(macro) => macro.nutrientId}
                                    emptyLabel={t('professional:target.noMacros')}
                                />

                                <Text
                                    testID="review-detail-method"
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {t('professional:target.method', {
                                        method: t(
                                            `nutrition:methods.${detail.target.result.method}`,
                                            { defaultValue: detail.target.result.method },
                                        ),
                                    })}
                                </Text>

                                <Callout
                                    testID="review-detail-prototype-engine"
                                    role="note"
                                    tone="warning"
                                    icon="prototype"
                                    title={t('professional:target.prototypeTitle')}
                                    body={t('professional:target.prototypeBody')}
                                />

                                {detail.target.result.override === null ? (
                                    <Text
                                        testID="review-detail-no-override"
                                        tone="secondary"
                                        variant="caption"
                                    >
                                        {t('professional:target.noOverride')}
                                    </Text>
                                ) : (
                                    <Callout
                                        testID="review-detail-override"
                                        role="note"
                                        tone="info"
                                        icon="info"
                                        title={t('professional:target.overrideTitle')}
                                        body={detail.target.result.override.reason}
                                    />
                                )}

                                <Text
                                    testID="review-detail-approved"
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {detail.target.professionallyApproved
                                        ? t('professional:target.approved')
                                        : t('professional:target.notApproved')}
                                </Text>
                            </Stack>
                        )}

                        <Stack space="sm" testID="review-detail-enforced">
                            <Text variant="label">
                                {t('professional:restrictions.enforcedTitle')}
                            </Text>
                            <Text tone="secondary" variant="caption">
                                {t('professional:restrictions.enforcedBody')}
                            </Text>
                            {enforced.length === 0 ? (
                                <Text testID="review-detail-enforced-none" tone="secondary">
                                    {t('professional:restrictions.none')}
                                </Text>
                            ) : (
                                enforced.map((constraint) => (
                                    <ConstraintRow
                                        key={`${constraint.kind}-${constraint.code}`}
                                        constraint={constraint}
                                        testID={`review-detail-enforced-${constraint.code}`}
                                    />
                                ))
                            )}
                        </Stack>

                        <Stack space="sm" testID="review-detail-declared">
                            <Text variant="label">
                                {t('professional:restrictions.declaredTitle')}
                            </Text>
                            {declared.length === 0 ? (
                                <Text testID="review-detail-declared-none" tone="secondary">
                                    {t('professional:restrictions.none')}
                                </Text>
                            ) : (
                                declared.map((constraint) => (
                                    <ConstraintRow
                                        key={`${constraint.kind}-${constraint.code}`}
                                        constraint={constraint}
                                        testID={`review-detail-declared-${constraint.code}`}
                                    />
                                ))
                            )}
                        </Stack>

                        {detail.planWeek === null ? (
                            <Text tone="secondary" testID="review-detail-no-plan">
                                {t('professional:review.noPlan')}
                            </Text>
                        ) : (
                            <ProposedPlan
                                week={detail.planWeek}
                                clientId={String(detail.item.clientId)}
                            />
                        )}

                        {failure === null ? null : (
                            <Callout
                                testID="review-detail-failure"
                                role="alert"
                                tone="danger"
                                icon="warning"
                                title={t('professional:review.failedTitle')}
                                body={failure.message}
                            />
                        )}

                        <Stack space="sm" testID="review-detail-actions">
                            <Text variant="label">{t('professional:review.actionsTitle')}</Text>
                            <Inline space="sm" wrap>
                                <Button
                                    testID="review-approve"
                                    label={t('professional:review.approve')}
                                    onPress={() => {
                                        setDialog('approve');
                                    }}
                                />
                                <Button
                                    testID="review-request-changes"
                                    variant="secondary"
                                    label={t('professional:review.requestChanges')}
                                    onPress={() => {
                                        setDialog('changes');
                                    }}
                                />
                                {detail.target === null ? null : (
                                    <Button
                                        testID="review-set-override"
                                        variant="secondary"
                                        label={t('professional:review.setOverride')}
                                        onPress={() => {
                                            setOverrideEnergy(
                                                Math.round(detail.target?.result.targetEnergy ?? 0),
                                            );
                                            setDialog('override');
                                        }}
                                    />
                                )}
                                {detail.item.planId === null ? null : (
                                    <Button
                                        testID="review-set-note"
                                        variant="secondary"
                                        label={t('professional:review.setNote')}
                                        onPress={() => {
                                            setDialog('note');
                                        }}
                                    />
                                )}
                            </Inline>
                            <Text
                                tone="secondary"
                                variant="caption"
                                testID="review-detail-actions-note"
                            >
                                {t('professional:review.actionsNote')}
                            </Text>
                        </Stack>

                        <Inline space="sm" wrap>
                            {backAction}
                        </Inline>
                    </Stack>
                )}
            </QueryStates>

            {/* ── approve ────────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="review-approve-dialog"
                open={dialog === 'approve'}
                onClose={close}
                title={t('professional:review.approveDialogTitle')}
                description={t('professional:review.approveDialogBody')}
                actions={
                    <>
                        <Button
                            testID="review-approve-cancel"
                            variant="secondary"
                            label={t('professional:common.cancel')}
                            onPress={close}
                        />
                        <Button
                            testID="review-approve-confirm"
                            label={t('professional:review.approveConfirm')}
                            loading={approve.isPending}
                            disabled={signature.trim() === ''}
                            onPress={() => {
                                if (reviewId === undefined || signature.trim() === '') return;
                                approve.mutate(
                                    {
                                        reviewId,
                                        request: { signature: signature.trim() },
                                    },
                                    {
                                        onSuccess: () => {
                                            announce(t('professional:review.announceApproved'));
                                            close();
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    <TextInputField
                        testID="review-approve-signature"
                        id="review-approve-signature"
                        label={t('professional:review.signatureLabel')}
                        hint={t('professional:review.signatureHint')}
                        value={signature}
                        required
                        onChangeText={setSignature}
                    />
                    <Callout
                        testID="review-approve-consequence"
                        role="note"
                        tone="warning"
                        icon="info"
                        title={t('professional:review.approveConsequenceTitle')}
                        body={t('professional:review.approveConsequenceBody')}
                    />
                </Stack>
            </Dialog>

            {/* ── request changes ────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="review-changes-dialog"
                open={dialog === 'changes'}
                onClose={close}
                title={t('professional:review.changesDialogTitle')}
                description={t('professional:review.changesDialogBody')}
                actions={
                    <>
                        <Button
                            testID="review-changes-cancel"
                            variant="secondary"
                            label={t('professional:common.cancel')}
                            onPress={close}
                        />
                        <Button
                            testID="review-changes-confirm"
                            label={t('professional:review.changesConfirm')}
                            loading={requestChanges.isPending}
                            disabled={changeNote.trim() === ''}
                            onPress={() => {
                                if (reviewId === undefined || changeNote.trim() === '') return;
                                requestChanges.mutate(
                                    {
                                        reviewId,
                                        request: {
                                            note: changeNote.trim(),
                                            priority: changePriority,
                                        },
                                    },
                                    {
                                        onSuccess: () => {
                                            announce(t('professional:review.announceChanges'));
                                            close();
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    <TextInputField
                        testID="review-changes-note"
                        id="review-changes-note"
                        label={t('professional:review.changesNoteLabel')}
                        hint={t('professional:review.changesNoteHint')}
                        value={changeNote}
                        multiline
                        required
                        onChangeText={setChangeNote}
                    />
                    <SegmentedControl
                        testID="review-changes-priority"
                        label={t('professional:review.changesPriorityLabel')}
                        block
                        value={changePriority}
                        onChange={(next) => {
                            setChangePriority(next as ReviewPriority);
                        }}
                        items={REVIEW_PRIORITIES.map((priority) => ({
                            value: priority,
                            label: t(priorityKey(priority)),
                            testID: `review-changes-priority-${priority}`,
                        }))}
                    />
                </Stack>
            </Dialog>

            {/* ── professional override ──────────────────────────────────────────────────────── */}
            <Dialog
                testID="review-override-dialog"
                open={dialog === 'override'}
                onClose={close}
                title={t('professional:review.overrideDialogTitle')}
                description={t('professional:review.overrideDialogBody')}
                actions={
                    <>
                        <Button
                            testID="review-override-cancel"
                            variant="secondary"
                            label={t('professional:common.cancel')}
                            onPress={close}
                        />
                        <Button
                            testID="review-override-confirm"
                            label={t('professional:review.overrideConfirm')}
                            loading={setOverride.isPending}
                            disabled={overrideReason.trim() === ''}
                            onPress={() => {
                                if (
                                    detail?.target == null ||
                                    detail.target.id === null ||
                                    overrideReason.trim() === ''
                                ) {
                                    return;
                                }
                                setOverride.mutate(
                                    {
                                        clientId: detail.item.clientId,
                                        targetId: detail.target.id,
                                        reason: overrideReason.trim(),
                                        ...(overrideEnergy === null
                                            ? {}
                                            : { targetEnergy: overrideEnergy }),
                                    },
                                    {
                                        onSuccess: () => {
                                            announce(t('professional:review.announceOverride'));
                                            close();
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    <NumberStepper
                        testID="review-override-energy"
                        label={t('professional:review.overrideEnergyLabel')}
                        hint={t('professional:review.overrideEnergyHint')}
                        value={overrideEnergy}
                        min={800}
                        max={6000}
                        step={25}
                        unit="kcal"
                        onChange={setOverrideEnergy}
                    />
                    <TextInputField
                        testID="review-override-reason"
                        id="review-override-reason"
                        label={t('professional:review.overrideReasonLabel')}
                        hint={t('professional:review.overrideReasonHint')}
                        value={overrideReason}
                        multiline
                        required
                        onChangeText={setOverrideReason}
                    />
                </Stack>
            </Dialog>

            {/* ── dietitian note on the plan ─────────────────────────────────────────────────── */}
            <Dialog
                testID="review-note-dialog"
                open={dialog === 'note'}
                onClose={close}
                title={t('professional:review.noteDialogTitle')}
                description={t('professional:review.noteDialogBody')}
                actions={
                    <>
                        <Button
                            testID="review-note-cancel"
                            variant="secondary"
                            label={t('professional:common.cancel')}
                            onPress={close}
                        />
                        <Button
                            testID="review-note-confirm"
                            label={t('professional:review.noteConfirm')}
                            loading={setNote.isPending}
                            onPress={() => {
                                if (detail?.item.planId == null) return;
                                setNote.mutate(
                                    {
                                        planId: detail.item.planId,
                                        note: planNote.trim() === '' ? null : planNote.trim(),
                                    },
                                    {
                                        onSuccess: () => {
                                            announce(t('professional:review.announceNote'));
                                            close();
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <TextInputField
                    testID="review-note-input"
                    id="review-note-input"
                    label={t('professional:review.noteLabel')}
                    hint={t('professional:review.noteHint')}
                    value={planNote}
                    multiline
                    onChangeText={setPlanNote}
                />
            </Dialog>
        </Stack>
    );
}

interface ConstraintRowProps {
    readonly constraint: NutritionConstraint;
    readonly testID: string;
}

/** One restriction: what it is, how hard it bites, and who supplied it. All three, always. */
function ConstraintRow({ constraint, testID }: ConstraintRowProps) {
    const { t } = useTranslation();

    return (
        <Card testID={testID} padding="sm">
            <Stack space="xs">
                <Inline space="sm" align="center" justify="between">
                    <Text variant="bodyStrong">{constraint.label}</Text>
                    <Badge
                        testID={`${testID}-severity`}
                        tone={SEVERITY_TONE[constraint.severity]}
                        icon={constraint.severity === 'critical' ? 'warning' : 'info'}
                        label={t(`professional:severities.${constraint.severity}`)}
                    />
                </Inline>
                <Text tone="secondary" variant="caption" testID={`${testID}-kind`}>
                    {t(restrictionKindKey(constraint.kind))}
                </Text>
                <Text tone="secondary" variant="caption" testID={`${testID}-source`}>
                    {t(`professional:sources.${constraint.source}`)}
                </Text>
                {constraint.note === null ? null : (
                    <Text tone="secondary" variant="caption">
                        {constraint.note}
                    </Text>
                )}
            </Stack>
        </Card>
    );
}

interface ProposedPlanProps {
    readonly week: MealPlanWeek;
    readonly clientId: string;
}

/**
 * The week under review, summarised.
 *
 * A professional does not need twenty-eight cards here — they need to know which days carry a
 * warning and which entries a dietitian has already signed off. The full week, entry by entry, is
 * one link away on the client plan screen.
 */
function ProposedPlan({ week, clientId }: ProposedPlanProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const warnings = week.days.flatMap((day) => day.entries.flatMap((entry) => entry.warnings));
    const approvedEntries = week.days.flatMap((day) =>
        day.entries.filter((entry) => entry.approvedBy !== null),
    ).length;

    return (
        <Stack space="sm" testID="review-detail-plan">
            <Text variant="label">{t('professional:plan.proposedTitle')}</Text>

            <Text testID="review-detail-plan-week">
                {t('professional:plan.week', {
                    date: formatter.formatDate(week.weekStart, { dateStyle: 'full' }),
                })}
            </Text>

            <Text testID="review-detail-plan-entries" tone="secondary" variant="caption">
                {t('professional:plan.entryCount', {
                    count: week.days.reduce((running, day) => running + day.entries.length, 0),
                })}
            </Text>

            <Text testID="review-detail-plan-approved" tone="secondary" variant="caption">
                {t('professional:plan.approvedEntries', { count: approvedEntries })}
            </Text>

            {warnings.length === 0 ? (
                <Text testID="review-detail-plan-no-warnings" tone="secondary" variant="caption">
                    {t('professional:plan.noWarnings')}
                </Text>
            ) : (
                <Callout
                    testID="review-detail-plan-warnings"
                    role="note"
                    tone="warning"
                    icon="warning"
                    title={t('professional:plan.warningsTitle')}
                    body={[...new Set(warnings)]
                        .map((code) => t(warningKey(code), { defaultValue: code }))
                        .join(t('professional:common.listSeparator'))}
                />
            )}

            <Inline space="sm" wrap>
                <Button
                    testID="review-detail-open-plan"
                    size="sm"
                    variant="secondary"
                    label={t('professional:plan.open')}
                    onPress={() => {
                        router.push(
                            `/dietitian/clients/${clientId}/${String(week.planId)}/${week.weekStart}` as never,
                        );
                    }}
                />
            </Inline>
        </Stack>
    );
}
