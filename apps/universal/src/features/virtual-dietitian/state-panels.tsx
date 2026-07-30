import type {
    PreparationMode,
    SendVdMessageRequest,
    VdSession,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Heading,
    Inline,
    ListItem,
    Skeleton,
    Spinner,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDietitianQuery } from '../../data/marketplace-hooks.ts';
import { PrototypeButton } from '../../prototype/prototype-notice.tsx';
import { OriginBadge } from './origin-badge.tsx';
import { AllergenReminder, SafetyNotices } from './safety-notices.tsx';
import { StructurePanel } from './structure-panel.tsx';
import { TargetsPanel } from './targets-panel.tsx';
import { VD_STATE_ICON, VD_STATE_TONE, vdStateTestId } from './state-presentation.ts';

/**
 * One panel per state, and a switch that cannot forget one.
 *
 * The four blocked outcomes get the same design attention as the four happy ones — that is the whole
 * argument for enumerating twelve states in the contract rather than three plus an error toast. A
 * person meets `restriction_conflict` or `safety_escalation` at the worst moment of their journey
 * (doc 17, RISK-03), and "something went wrong" is not an acceptable thing to say to them.
 *
 * Every panel is wrapped by {@link StatePanel}, which supplies the state's test id, its headline and
 * its tone-plus-icon header. That is what makes "each state is visually distinct and addressable" a
 * structural property rather than twelve independent promises.
 */

export interface StatePanelActions {
    readonly onSend: (request: SendVdMessageRequest) => void;
    readonly sending: boolean;
    readonly onAccept: (acknowledged: boolean) => void;
    readonly accepting: boolean;
    readonly acceptFailure: string | null;
    readonly onOverride: () => void;
    readonly onRequestReview: () => void;
    readonly requestingReview: boolean;
    readonly reviewFailure: string | null;
    readonly onGenerate: (preparationMode: PreparationMode) => void;
    readonly generating: boolean;
    readonly generateFailure: string | null;
    /** Moves an accepted proposal on to the meal structure — a real `sendMessage`. */
    readonly onContinue: () => void;
    /** Puts a question into the reply box — the missing-information panel's jump-to action. */
    readonly onAskFor: (question: string) => void;
}

export interface StatePanelProps {
    readonly session: VdSession;
    readonly actions: StatePanelActions;
}

function StatePanel({
    state,
    children,
}: {
    readonly state: VdSession['state'];
    readonly children: ReactNode;
}) {
    const { t } = useTranslation();

    return (
        <Stack space="md" testID={vdStateTestId(state)}>
            <Callout
                testID={`${vdStateTestId(state)}-headline`}
                role="note"
                tone={VD_STATE_TONE[state]}
                icon={VD_STATE_ICON[state]}
                title={t(`virtualDietitian:states.${state}.headline`)}
                body={t(`virtualDietitian:states.${state}.summary`)}
            />
            {children}
        </Stack>
    );
}

/* ── 1. initial interview ────────────────────────────────────────────────────────────────────── */

function InterviewPanel() {
    const { t } = useTranslation();

    return (
        <Stack space="sm" testID="vd-interview">
            <Heading level={2}>{t('virtualDietitian:interview.title')}</Heading>
            <Text tone="secondary">{t('virtualDietitian:interview.body')}</Text>
            <Heading level={3}>{t('virtualDietitian:interview.askingTitle')}</Heading>
            {(['askOne', 'askTwo', 'askThree'] as const).map((key) => (
                <ListItem
                    key={key}
                    testID={`vd-interview-${key}`}
                    title={t(`virtualDietitian:interview.${key}`)}
                    leading={<Text tone="secondary">{'•'}</Text>}
                />
            ))}
        </Stack>
    );
}

/* ── 2. analysing ────────────────────────────────────────────────────────────────────────────── */

function AnalysingPanel() {
    const { t } = useTranslation();

    return (
        <Stack space="sm" testID="vd-analysing">
            <Inline space="sm" align="center">
                <Spinner
                    testID="vd-analysing-spinner"
                    label={t('virtualDietitian:analysing.title')}
                />
                <Heading level={2}>{t('virtualDietitian:analysing.title')}</Heading>
            </Inline>
            {(['considerOne', 'considerTwo', 'considerThree', 'considerFour'] as const).map(
                (key) => (
                    <ListItem
                        key={key}
                        testID={`vd-analysing-${key}`}
                        title={t(`virtualDietitian:analysing.${key}`)}
                        leading={<Text tone="secondary">{'•'}</Text>}
                    />
                ),
            )}
            <Stack space="xs" testID="vd-analysing-skeleton">
                <Skeleton heightClassName="h-4" variant="shimmer" />
                <Skeleton heightClassName="h-4" widthClassName="w-2/3" variant="shimmer" />
            </Stack>
            <Text variant="caption" tone="secondary">
                {t('virtualDietitian:analysing.note')}
            </Text>
        </Stack>
    );
}

/* ── 3. missing information ──────────────────────────────────────────────────────────────────── */

function MissingInformationPanel({ session, actions }: StatePanelProps) {
    const { t } = useTranslation();

    return (
        <Stack space="sm" testID="vd-missing">
            <Heading level={2}>{t('virtualDietitian:missing.title')}</Heading>
            <Text tone="secondary">{t('virtualDietitian:missing.body')}</Text>
            {session.missingInformation.map((item) => (
                <Card
                    key={item.field}
                    padding="sm"
                    tone="raised"
                    testID={`vd-missing-${item.field}`}
                >
                    <Stack space="xs">
                        <Inline space="xs" align="center">
                            <Badge
                                testID={`vd-missing-${item.field}-badge`}
                                tone={item.required ? 'warning' : 'neutral'}
                                icon={item.required ? 'warning' : 'info'}
                                label={
                                    item.required
                                        ? t('virtualDietitian:missing.required')
                                        : t('virtualDietitian:missing.optional')
                                }
                            />
                        </Inline>
                        <Text>{item.question}</Text>
                        <Button
                            testID={`vd-missing-${item.field}-jump`}
                            variant="secondary"
                            size="sm"
                            accessibilityHint={t('virtualDietitian:missing.jumpHint')}
                            label={t('virtualDietitian:missing.jump')}
                            onPress={() => {
                                actions.onAskFor(item.question);
                            }}
                        />
                    </Stack>
                </Card>
            ))}
        </Stack>
    );
}

/* ── 6. draft generated ──────────────────────────────────────────────────────────────────────── */

function DraftPanel({ session, actions }: StatePanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const slots = session.proposal?.mealStructure ?? [];
    const kitchenSlots = slots.filter((slot) => slot.preparationMode === 'kitchen_prepared').length;
    const homeSlots = slots.length - kitchenSlots;

    return (
        <Stack space="sm" testID="vd-draft">
            <Inline space="sm" align="center">
                <Heading level={2}>{t('virtualDietitian:draft.title')}</Heading>
                <OriginBadge kind="ai" testID="vd-draft-origin" />
            </Inline>
            <Text tone="secondary">{t('virtualDietitian:draft.body')}</Text>

            <Card padding="sm" tone="raised" testID="vd-draft-summary">
                <Stack space="xs">
                    <Inline space="xs" align="center" justify="between">
                        <Text variant="caption" tone="secondary">
                            {t('virtualDietitian:draft.planReference')}
                        </Text>
                        <Text variant="mono" testID="vd-draft-plan-id">
                            {session.draftPlanId === null ? '—' : String(session.draftPlanId)}
                        </Text>
                    </Inline>
                    <Inline space="xs" align="center" justify="between">
                        <Text variant="caption" tone="secondary">
                            {t('virtualDietitian:draft.mealsPerDay')}
                        </Text>
                        <Text testID="vd-draft-meals">{formatter.formatNumber(slots.length)}</Text>
                    </Inline>
                    <Inline space="xs" align="center" justify="between">
                        <Text variant="caption" tone="secondary">
                            {t('virtualDietitian:draft.mix')}
                        </Text>
                        <Text testID="vd-draft-mix">
                            {t('virtualDietitian:draft.mixValue', {
                                kitchen: formatter.formatNumber(kitchenSlots),
                                home: formatter.formatNumber(homeSlots),
                            })}
                        </Text>
                    </Inline>
                </Stack>
            </Card>

            <SafetyNotices notices={session.safetyNotices} testID="vd-draft-safety" />
            <AllergenReminder testID="vd-draft-allergen-reminder" />

            <Text variant="caption" tone="secondary">
                {t('virtualDietitian:draft.reviewHint')}
            </Text>

            <Inline space="sm" wrap>
                <Button
                    testID="vd-draft-request-review"
                    variant="primary"
                    loading={actions.requestingReview}
                    label={
                        actions.requestingReview
                            ? t('virtualDietitian:draft.requesting')
                            : t('virtualDietitian:draft.requestReview')
                    }
                    onPress={actions.onRequestReview}
                />
                {/*
                 * The planner at `/customer/planner` is a later wave's route and reads
                 * `GET /api/v1/meal-plans/{plan}`. A link to it would land on "not found", so the
                 * control discloses the destination and the contract instead (plan §5).
                 */}
                <PrototypeButton
                    label={t('virtualDietitian:draft.openInPlanner')}
                    contract="GET /api/v1/meal-plans/{plan} → /customer/planner"
                    message={t('virtualDietitian:draft.openInPlannerMessage')}
                />
            </Inline>

            {actions.reviewFailure === null ? null : (
                <Text testID="vd-draft-error" tone="danger" role="alert" aria-live="assertive">
                    {actions.reviewFailure}
                </Text>
            )}
        </Stack>
    );
}

/* ── 7. review requested ─────────────────────────────────────────────────────────────────────── */

function ReviewRequestedPanel({ session }: StatePanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Stack space="sm" testID="vd-review">
            <Heading level={2}>{t('virtualDietitian:review.title')}</Heading>
            <Text tone="secondary">{t('virtualDietitian:review.body')}</Text>
            {session.reviewRequestedAt === null ? null : (
                <Text testID="vd-review-requested-at" variant="caption" tone="secondary">
                    {t('virtualDietitian:review.requestedAt', {
                        date: formatter.formatDate(session.reviewRequestedAt, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                        }),
                    })}
                </Text>
            )}

            <Callout
                testID="vd-review-queue"
                role="note"
                tone="info"
                icon="prototype"
                title={t('virtualDietitian:review.queueTitle')}
                body={t('virtualDietitian:review.queueBody')}
            />

            <Heading level={3}>{t('virtualDietitian:review.checksTitle')}</Heading>
            {(['checkOne', 'checkTwo', 'checkThree', 'checkFour'] as const).map((key) => (
                <ListItem
                    key={key}
                    testID={`vd-review-${key}`}
                    title={t(`virtualDietitian:review.${key}`)}
                    leading={<Text tone="secondary">{'•'}</Text>}
                />
            ))}

            <SafetyNotices notices={session.safetyNotices} testID="vd-review-safety" />
        </Stack>
    );
}

/* ── 8. professionally approved ──────────────────────────────────────────────────────────────── */

function ApprovedPanel({ session }: StatePanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const reviewerId = session.reviewedBy;
    const reviewer = useDietitianQuery(reviewerId);

    const overrides = (session.proposal?.rationale ?? []).filter((line) =>
        line.startsWith('Human override:'),
    );
    const dietitianNotes = session.messages.filter((message) => message.origin === 'dietitian');

    return (
        <Stack space="sm" testID="vd-approved">
            <Inline space="sm" align="center">
                <Heading level={2}>{t('virtualDietitian:approved.title')}</Heading>
                <OriginBadge kind="dietitian" testID="vd-approved-origin" />
            </Inline>
            <Text tone="secondary">{t('virtualDietitian:approved.body')}</Text>
            {session.approvedAt === null ? null : (
                <Text testID="vd-approved-at" variant="caption" tone="secondary">
                    {t('virtualDietitian:approved.approvedAt', {
                        date: formatter.formatDate(session.approvedAt, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                        }),
                    })}
                </Text>
            )}

            <Card padding="sm" tone="raised" testID="vd-approved-approver">
                <Stack space="xs">
                    <Heading level={3}>{t('virtualDietitian:approved.approverTitle')}</Heading>
                    {reviewerId === null ? (
                        <Text testID="vd-approved-approver-unknown" tone="secondary">
                            {t('virtualDietitian:approved.approverUnknown')}
                        </Text>
                    ) : (
                        <>
                            <Text testID="vd-approved-approver-name">
                                {reviewer.data?.displayName ?? String(reviewerId)}
                            </Text>
                            {reviewer.data === undefined
                                ? null
                                : reviewer.data.credentials.map((credential) => (
                                      <Text key={credential} variant="caption" tone="secondary">
                                          {credential}
                                      </Text>
                                  ))}
                            <Text variant="caption" tone="warning">
                                {t('virtualDietitian:approved.approverSynthetic')}
                            </Text>
                        </>
                    )}
                </Stack>
            </Card>

            <Stack space="xs" testID="vd-approved-changes">
                <Heading level={3}>{t('virtualDietitian:approved.changedTitle')}</Heading>
                {overrides.length === 0 && dietitianNotes.length === 0 ? (
                    <Text testID="vd-approved-changes-none" tone="secondary">
                        {t('virtualDietitian:approved.changedNone')}
                    </Text>
                ) : (
                    <>
                        {session.proposal?.overriddenAt == null ? null : (
                            <Text variant="caption" tone="secondary">
                                {t('virtualDietitian:approved.overriddenAt', {
                                    date: formatter.formatDate(session.proposal.overriddenAt, {
                                        dateStyle: 'medium',
                                        timeStyle: 'short',
                                    }),
                                })}
                            </Text>
                        )}
                        {overrides.map((line) => (
                            <Text key={line} variant="caption">
                                {line}
                            </Text>
                        ))}
                        {dietitianNotes.map((message) => (
                            <Card
                                key={String(message.id)}
                                padding="sm"
                                tone="raised"
                                testID={`vd-approved-note-${String(message.id)}`}
                            >
                                <Stack space="xs">
                                    <OriginBadge kind="dietitian" />
                                    <Text variant="caption">{message.body}</Text>
                                </Stack>
                            </Card>
                        ))}
                    </>
                )}
            </Stack>

            <SafetyNotices notices={session.safetyNotices} testID="vd-approved-safety" />
        </Stack>
    );
}

/* ── 9. generation failed ────────────────────────────────────────────────────────────────────── */

function GenerationFailedPanel({ actions }: StatePanelProps) {
    const { t } = useTranslation();

    return (
        <Stack space="sm" testID="vd-failed">
            <Heading level={2}>{t('virtualDietitian:failed.title')}</Heading>
            <Text tone="secondary">{t('virtualDietitian:failed.body')}</Text>

            <Inline space="sm" wrap>
                <Button
                    testID="vd-failed-retry"
                    variant="primary"
                    loading={actions.generating}
                    label={
                        actions.generating
                            ? t('virtualDietitian:failed.retrying')
                            : t('virtualDietitian:failed.retry')
                    }
                    onPress={() => {
                        actions.onGenerate('mixed');
                    }}
                />
                <Button
                    testID="vd-failed-request-review"
                    variant="secondary"
                    loading={actions.requestingReview}
                    label={t('virtualDietitian:draft.requestReview')}
                    onPress={actions.onRequestReview}
                />
            </Inline>

            <Callout
                testID="vd-failed-alternative"
                role="note"
                tone="info"
                title={t('virtualDietitian:failed.alternativeTitle')}
                body={t('virtualDietitian:failed.alternativeBody')}
            />

            {actions.generateFailure === null ? null : (
                <Text testID="vd-failed-error" tone="danger" role="alert" aria-live="assertive">
                    {actions.generateFailure}
                </Text>
            )}
        </Stack>
    );
}

/* ── 10. restriction conflict ────────────────────────────────────────────────────────────────── */

function RestrictionConflictPanel({ session, actions }: StatePanelProps) {
    const { t } = useTranslation();

    return (
        <Stack space="sm" testID="vd-conflict">
            <Heading level={2}>{t('virtualDietitian:conflict.title')}</Heading>
            <Text tone="secondary">{t('virtualDietitian:conflict.body')}</Text>

            {session.conflicts.map((conflict) => (
                <Card
                    key={conflict.constraintId}
                    padding="sm"
                    tone="raised"
                    testID={`vd-conflict-${conflict.constraintId}`}
                >
                    <Stack space="xs">
                        <Inline space="xs" align="center">
                            <Badge
                                testID={`vd-conflict-${conflict.constraintId}-badge`}
                                tone={conflict.requiresProfessional ? 'warning' : 'info'}
                                icon={conflict.requiresProfessional ? 'warning' : 'info'}
                                label={
                                    conflict.requiresProfessional
                                        ? t('virtualDietitian:conflict.requiresProfessional')
                                        : t('virtualDietitian:conflict.userResolvable')
                                }
                            />
                        </Inline>
                        <Text variant="label">{conflict.label}</Text>
                        <Text variant="caption" tone="secondary">
                            {conflict.explanation}
                        </Text>
                    </Stack>
                </Card>
            ))}

            <Heading level={3}>{t('virtualDietitian:conflict.resolveTitle')}</Heading>
            <Callout
                testID="vd-conflict-adjust"
                role="note"
                tone="info"
                title={t('virtualDietitian:conflict.adjustTitle')}
                body={t('virtualDietitian:conflict.adjustBody')}
            />
            <Callout
                testID="vd-conflict-review"
                role="note"
                tone="info"
                title={t('virtualDietitian:conflict.reviewTitle')}
                body={t('virtualDietitian:conflict.reviewBody')}
                actions={
                    <Button
                        testID="vd-conflict-request-review"
                        variant="secondary"
                        size="sm"
                        loading={actions.requestingReview}
                        label={t('virtualDietitian:draft.requestReview')}
                        onPress={actions.onRequestReview}
                    />
                }
            />
        </Stack>
    );
}

/* ── 11. no suitable meals ───────────────────────────────────────────────────────────────────── */

function NoSuitableMealsPanel({ actions }: StatePanelProps) {
    const { t } = useTranslation();

    return (
        <Stack space="sm" testID="vd-no-meals">
            <Heading level={2}>{t('virtualDietitian:noMeals.title')}</Heading>
            <Text tone="secondary">{t('virtualDietitian:noMeals.body')}</Text>

            <Heading level={3}>{t('virtualDietitian:noMeals.whyTitle')}</Heading>
            {(['whyOne', 'whyTwo', 'whyThree'] as const).map((key) => (
                <ListItem
                    key={key}
                    testID={`vd-no-meals-${key}`}
                    title={t(`virtualDietitian:noMeals.${key}`)}
                    leading={<Text tone="secondary">{'•'}</Text>}
                />
            ))}

            <Heading level={3}>{t('virtualDietitian:noMeals.widenTitle')}</Heading>
            {(['widenOne', 'widenTwo', 'widenThree'] as const).map((key) => (
                <ListItem
                    key={key}
                    testID={`vd-no-meals-${key}`}
                    title={t(`virtualDietitian:noMeals.${key}`)}
                    leading={<Text tone="secondary">{'•'}</Text>}
                />
            ))}

            <Button
                testID="vd-no-meals-request-review"
                variant="secondary"
                loading={actions.requestingReview}
                label={t('virtualDietitian:draft.requestReview')}
                onPress={actions.onRequestReview}
            />
        </Stack>
    );
}

/* ── 12. safety escalation ───────────────────────────────────────────────────────────────────── */

/**
 * The stop state.
 *
 * No proposal, no draft affordance, no reply box and no machine-authored content of any kind — the
 * copy below is fixed, translated, and written by people. The only thing this screen does is hand
 * over. `VD_REPLY_STATES.safety_escalation` is `false` for the same reason, so there is no path back
 * into generation from here.
 */
function SafetyEscalationPanel({ session }: StatePanelProps) {
    const { t } = useTranslation();

    return (
        <Stack space="sm" testID="vd-safety">
            <Heading level={2}>{t('virtualDietitian:safety.title')}</Heading>
            <Text>{t('virtualDietitian:safety.body')}</Text>

            <SafetyNotices notices={session.safetyNotices} testID="vd-safety-notices" />

            <Card padding="md" tone="raised" testID="vd-safety-contact">
                <Stack space="xs">
                    <Heading level={3}>{t('virtualDietitian:safety.contactTitle')}</Heading>
                    <Text>{t('virtualDietitian:safety.contactBody')}</Text>
                    <Text testID="vd-safety-contact-placeholder" variant="caption" tone="secondary">
                        {t('virtualDietitian:safety.contactPlaceholder')}
                    </Text>
                </Stack>
            </Card>

            <Text testID="vd-safety-no-actions" variant="caption" tone="secondary">
                {t('virtualDietitian:safety.noActions')}
            </Text>
        </Stack>
    );
}

/* ── the switch ──────────────────────────────────────────────────────────────────────────────── */

export function VdStatePanel({ session, actions }: StatePanelProps) {
    const body = renderState({ session, actions });
    return <StatePanel state={session.state}>{body}</StatePanel>;
}

function renderState({ session, actions }: StatePanelProps) {
    switch (session.state) {
        case 'initial_interview':
            return <InterviewPanel />;
        case 'analysing':
            return <AnalysingPanel />;
        case 'missing_information':
            return <MissingInformationPanel session={session} actions={actions} />;
        case 'suggested_targets':
            return session.proposal === null ? null : (
                <TargetsPanel
                    proposal={session.proposal}
                    onAccept={actions.onAccept}
                    accepting={actions.accepting}
                    acceptFailure={actions.acceptFailure}
                    onOverride={actions.onOverride}
                    onRequestReview={actions.onRequestReview}
                    requestingReview={actions.requestingReview}
                    onContinue={actions.onContinue}
                    continuing={actions.sending}
                />
            );
        case 'suggested_meal_structure':
            return session.proposal === null ? null : (
                <StructurePanel
                    proposal={session.proposal}
                    safetyNotices={session.safetyNotices}
                    onRecordPreferences={actions.onSend}
                    recording={actions.sending}
                    onGenerate={actions.onGenerate}
                    generating={actions.generating}
                    failure={actions.generateFailure}
                />
            );
        case 'draft_generated':
            return <DraftPanel session={session} actions={actions} />;
        case 'review_requested':
            return <ReviewRequestedPanel session={session} actions={actions} />;
        case 'professionally_approved':
            return <ApprovedPanel session={session} actions={actions} />;
        case 'generation_failed':
            return <GenerationFailedPanel session={session} actions={actions} />;
        case 'restriction_conflict':
            return <RestrictionConflictPanel session={session} actions={actions} />;
        case 'no_suitable_meals':
            return <NoSuitableMealsPanel session={session} actions={actions} />;
        case 'safety_escalation':
            return <SafetyEscalationPanel session={session} actions={actions} />;
    }
}
