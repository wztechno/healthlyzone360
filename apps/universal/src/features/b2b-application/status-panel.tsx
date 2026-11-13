import type {
    B2BApplication,
    B2BApplicationSection,
    B2BApplicationState,
    B2BDocumentKind,
    ReviewerRequest,
} from '@healthy360/api-client/contracts';
import { Icon, cx } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { ExtraButton, ExtraCard, ExtraSmallButton } from '../account/account-extra.tsx';

import { stepForSection } from './sections.ts';
import type { B2BStepSlug } from './sections.ts';

/**
 * One component, eleven states.
 *
 * ## Why one component rather than eleven screens
 *
 * The states differ in *what is true*, not in what the panel is for: a person opens this to find out
 * where their application stands and what, if anything, they have to do. Eleven screens would be
 * eleven copies of the same layout that drift apart, and the two states most likely to be
 * confused — `approved` and `agreement_pending` — would be the two most likely to end up
 * inconsistent. Keeping them in one table makes the difference between them a line of copy rather
 * than a file.
 *
 * ## The states this panel refuses to collapse
 *
 * `approved` is not `agreement_pending`. Approved means a reviewer said yes; agreement pending means
 * the terms are drafted and the next move is the applicant's. A panel showing "approved" for both
 * leaves somebody waiting for an email that is never coming.
 *
 * `declined` is not `withdrawn`. One is the platform's decision and the other is the applicant's,
 * and a person who withdrew their own application should not be told they were turned down.
 *
 * `provisioning` is not `provisioned`. Only the second means the buying surfaces exist.
 *
 * ## Reviewer requests link at the thing they are about
 *
 * A request naming `trade_terms` gets a control that goes to the trade-terms step; one naming a
 * document kind gets a control that goes to the documents step. A status panel that said "we need
 * more information" and left the person to find where would be making them re-read a form they
 * have already filled in.
 */

/** The tone each state is drawn in. Never colour alone — the label carries the meaning too. */
const STATE_TONE: Readonly<
    Record<B2BApplicationState, 'neutral' | 'info' | 'warning' | 'success' | 'danger'>
> = {
    draft: 'neutral',
    submitted: 'info',
    in_review: 'info',
    info_requested: 'warning',
    approved: 'success',
    agreement_pending: 'warning',
    agreement_signed: 'info',
    provisioning: 'info',
    provisioned: 'success',
    declined: 'danger',
    withdrawn: 'neutral',
};

export interface StatusPanelProps {
    readonly application: B2BApplication;
    /** Sends the person to a wizard step. Absent on surfaces where the wizard is unreachable. */
    readonly onOpenStep?: ((slug: B2BStepSlug) => void) | undefined;
    /** Sends the person to the agreement. Only meaningful while one is waiting to be accepted. */
    readonly onOpenAgreement?: (() => void) | undefined;
    readonly onOpenProvisioning?: (() => void) | undefined;
    readonly testID?: string | undefined;
}

export function StatusPanel({
    application,
    onOpenStep,
    onOpenAgreement,
    onOpenProvisioning,
    testID = 'b2b-status',
}: StatusPanelProps) {
    const { t } = useTranslation();

    const state = application.state;
    const open = application.reviewerRequests.filter((request) => request.resolvedAt === null);

    return (
        <View testID={testID} className="flex-col">
            {/* The board's "Now" card: the stage, what it means, the reference and the last change. */}
            <View className="relative overflow-hidden rounded-[28px] bg-surface-canopy px-7 py-8">
                <View
                    aria-hidden
                    className="absolute -end-[120px] -top-[170px] h-[460px] w-[460px] rounded-full bg-stage-green opacity-15"
                />
                <RNText className="text-xs font-bold uppercase tracking-widest text-stage-green text-start">
                    {t('b2bApplication:status.now')}
                </RNText>
                <View className="mt-1.5 flex-row items-center gap-2.5">
                    <View
                        aria-hidden
                        className={cx('h-2.5 w-2.5 rounded-full', STATE_DOT[STATE_TONE[state]])}
                    />
                    <RNText
                        testID={`${testID}-badge`}
                        accessibilityRole="header"
                        aria-level={2}
                        className="min-w-0 flex-1 font-display text-3xl font-bold leading-[36px] text-content-on-canopy text-start"
                    >
                        {t(`b2bApplication:status.${state}.label`)}
                    </RNText>
                </View>
                <RNText
                    testID={`${testID}-body`}
                    className="mt-2 max-w-[620px] text-base font-medium leading-6 text-content-on-canopy-muted text-start"
                >
                    {t(`b2bApplication:status.${state}.body`)}
                </RNText>
                <View className="mt-4 flex-row flex-wrap gap-2">
                    <View className="h-[30px] justify-center rounded-full bg-content-on-canopy/10 px-3">
                        <RNText
                            testID={`${testID}-reference`}
                            className="text-xs font-semibold text-content-on-canopy"
                        >
                            {t('b2bApplication:reference', { reference: application.reference })}
                        </RNText>
                    </View>
                </View>
            </View>

            {/*
             * The half of a decision the applicant is shown. The reviewer's internal note is a
             * different column and never reaches this client (§4.8 denylist).
             */}
            {application.applicantMessage === null ? null : (
                <ExtraCard
                    testID={`${testID}-message`}
                    title={t('b2bApplication:status.messageFromUs')}
                >
                    <View className="mt-3 rounded-[18px] border border-stroke-subtle bg-surface-base px-[18px] py-4">
                        <RNText className="text-base font-medium leading-6 text-content-primary text-start">
                            {application.applicantMessage}
                        </RNText>
                    </View>
                </ExtraCard>
            )}

            {open.length > 0 ? (
                <ExtraCard
                    testID={`${testID}-requests`}
                    title={t('b2bApplication:status.reviewerRequestsTitle')}
                >
                    <View role="status" aria-live="polite">
                        <RNText className="text-sm text-content-secondary text-start">
                            {t('b2bApplication:status.reviewerRequests', { count: open.length })}
                        </RNText>
                    </View>
                    <View className="mt-2">
                        {open.map((request) => (
                            <RequestRow
                                key={request.id}
                                request={request}
                                testID={`${testID}-request-${request.id}`}
                                {...(onOpenStep === undefined ? {} : { onOpenStep })}
                            />
                        ))}
                    </View>
                </ExtraCard>
            ) : null}

            <View className="mt-5 flex-row flex-wrap items-center gap-2.5">
                {state === 'agreement_pending' && onOpenAgreement !== undefined ? (
                    <ExtraButton
                        testID={`${testID}-open-agreement`}
                        label={t('b2bApplication:agreement.title')}
                        icon="arrowForward"
                        onPress={onOpenAgreement}
                    />
                ) : null}

                {(state === 'agreement_signed' ||
                    state === 'provisioning' ||
                    state === 'provisioned') &&
                onOpenProvisioning !== undefined ? (
                    <ExtraButton
                        testID={`${testID}-open-provisioning`}
                        tone="secondary"
                        label={t('b2bApplication:provisioning.title')}
                        onPress={onOpenProvisioning}
                    />
                ) : null}

                {state === 'draft' && onOpenStep !== undefined ? (
                    <ExtraButton
                        testID={`${testID}-resume`}
                        label={t('b2bApplication:entry.resume')}
                        icon="arrowForward"
                        onPress={() => {
                            onOpenStep('company');
                        }}
                    />
                ) : null}
            </View>
        </View>
    );
}

const STATE_DOT: Readonly<Record<'neutral' | 'info' | 'warning' | 'success' | 'danger', string>> = {
    neutral: 'bg-content-on-canopy-muted',
    info: 'bg-info-subtle',
    warning: 'bg-warning-strong',
    success: 'bg-stage-green',
    danger: 'bg-danger-strong',
};

/** One thing the reviewers asked for: when, what they said, and the way to each part named. */
function RequestRow({
    request,
    onOpenStep,
    testID,
}: {
    readonly request: ReviewerRequest;
    readonly onOpenStep?: ((slug: B2BStepSlug) => void) | undefined;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View
            testID={testID}
            role="note"
            className="flex-row items-start gap-3 border-t border-stroke-subtle py-3.5 first:border-t-0"
        >
            <View className="h-10 w-10 items-center justify-center rounded-[13px] bg-warning-subtle">
                <Icon name="alert" size="md" className="text-warning-on-subtle" />
            </View>
            <View className="min-w-0 flex-1">
                <RNText className="text-base font-semibold text-content-primary text-start">
                    {request.message}
                </RNText>
                <RNText className="mt-0.5 text-sm text-content-secondary text-start">
                    {t('b2bApplication:status.requestAskedOn', {
                        date: formatter.formatDate(request.requestedAt),
                    })}
                </RNText>
                {onOpenStep === undefined ? null : (
                    <View className="mt-2.5 flex-row flex-wrap gap-2">
                        {request.sections.map((section: B2BApplicationSection) => (
                            <ExtraSmallButton
                                key={section}
                                testID={`${testID}-section-${section}`}
                                tone="secondary"
                                label={t('b2bApplication:status.goToSection', {
                                    section: t(`b2bApplication:sections.${section}.title`),
                                })}
                                onPress={() => {
                                    onOpenStep(stepForSection(section));
                                }}
                            />
                        ))}
                        {request.documentKinds.map((kind: B2BDocumentKind) => (
                            <ExtraSmallButton
                                key={kind}
                                testID={`${testID}-document-${kind}`}
                                tone="secondary"
                                label={t('b2bApplication:status.goToDocuments', {
                                    kind: t(`b2bApplication:documents.kinds.${kind}`),
                                })}
                                onPress={() => {
                                    onOpenStep('documents');
                                }}
                            />
                        ))}
                    </View>
                )}
            </View>
        </View>
    );
}

/** The application's journey, in order — the stages the board's "Every stage" rail lists. */
export const STAGES: readonly B2BApplicationState[] = [
    'draft',
    'submitted',
    'in_review',
    'info_requested',
    'approved',
    'agreement_pending',
    'agreement_signed',
    'provisioning',
    'provisioned',
];

/**
 * "Every stage": each stage a dot and its name — the ones behind ticked, the current one marked —
 * so the person can see what comes next. A request for information is a detour, not a stage
 * everybody passes, so it is only drawn while the application is in it.
 */
export function StageRail({
    state,
    testID,
}: {
    readonly state: B2BApplicationState;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const stages = STAGES.filter(
        (stage) => stage !== 'info_requested' || state === 'info_requested',
    );
    const at = stages.indexOf(state);
    if (at === -1) return null;
    return (
        <ExtraCard testID={testID} title={t('b2bApplication:status.everyStage')}>
            <RNText className="text-sm text-content-secondary text-start">
                {t('b2bApplication:status.everyStageBody')}
            </RNText>
            <View className="mt-3">
                {stages.map((stage, index) => {
                    const done = index < at;
                    const now = index === at;
                    return (
                        <View key={stage} className="relative flex-row items-center gap-3 py-2">
                            {index < stages.length - 1 ? (
                                <View
                                    aria-hidden
                                    className="absolute bottom-[-8px] start-[13px] top-9 w-0.5 bg-stroke-subtle"
                                />
                            ) : null}
                            <View
                                className={cx(
                                    'h-7 w-7 items-center justify-center rounded-full border-2',
                                    done
                                        ? 'border-surface-brand bg-surface-brand'
                                        : now
                                          ? 'border-warning-strong bg-warning-subtle'
                                          : 'border-stroke bg-surface-raised',
                                )}
                            >
                                {done ? (
                                    <Icon
                                        name="check"
                                        size="sm"
                                        className="text-content-on-brand"
                                    />
                                ) : now ? (
                                    <View className="h-2 w-2 rounded-full bg-warning-strong" />
                                ) : null}
                            </View>
                            <RNText
                                className={cx(
                                    'text-sm font-semibold text-start',
                                    done
                                        ? 'text-content-primary'
                                        : now
                                          ? 'text-warning-on-subtle'
                                          : 'text-content-secondary',
                                )}
                            >
                                {t(`b2bApplication:status.${stage}.label`)}
                            </RNText>
                        </View>
                    );
                })}
            </View>
        </ExtraCard>
    );
}
