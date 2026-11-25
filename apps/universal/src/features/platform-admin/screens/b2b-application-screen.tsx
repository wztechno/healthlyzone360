import type {
    ApiFailure,
    B2BAgreement,
    B2BApplicationSection,
    KycRejectionReason,
    PlatformB2bApplication,
    PlatformKycDocument,
} from '@healthy360/api-client/contracts';
import {
    apiFailure,
    B2B_APPLICATION_SECTIONS,
    KYC_REJECTION_REASONS,
} from '@healthy360/api-client/contracts';
import { Button, Callout, Cascade, Checkbox, cx, Dialog, ErrorState, Icon, RecordSkeleton, Select, Text, TextInputField, useContentWidth, useToast } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Text as RNText, View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useApproveApplicationMutation,
    useClaimApplicationMutation,
    useDeclineApplicationMutation,
    usePlatformB2bAgreementsQuery,
    usePlatformB2bApplicationQuery,
    usePlatformB2bInvitationsQuery,
    useProvisionApplicationMutation,
    useRequestInformationMutation,
    useResendInvitationMutation,
    useReviewDocumentMutation,
    useReviewerDocumentDownloadMutation,
    useReviseAgreementMutation,
    useSendAgreementMutation,
} from '../../../data/platform-b2b-hooks.ts';
import { useTrailLeaf } from '../../../shell/area-trail.tsx';
import { CataloguePageHeader } from '../../kitchen-admin/catalogue/catalogue-page-header.tsx';
import { SheetCard, SheetFacts } from '../../kitchen-admin/catalogue/record-sheet.tsx';
import type { SheetFact } from '../../kitchen-admin/catalogue/record-sheet.tsx';
import { DeskChip } from '../../kitchen-admin/desk-kit/desk-chip.tsx';
import { AgreementEditor } from '../agreement-editor.tsx';
import {
    REVIEW_STAGES,
    applicationStatusKey,
    applicationStatusTone,
    liveAgreement,
    nextReviewStep,
    reviewStage,
} from '../b2b-review.ts';
import type { ReviewStep } from '../b2b-review.ts';
import { platformB2bApplicationHref } from '../platform-admin-chrome.tsx';

const REVIEW = 'b2b_application.review_platform';
const DECIDE = 'b2b_application.decide_platform';
const PROVISION = 'b2b_application.provision_platform';
const KYC_VIEW = 'kyc_document.view_platform';

/** The side column's width beside the application, the board's 340px. */
const RAIL_WIDTH = 340;
/** Below this the side column runs under the application. */
const BESIDE_MIN_WIDTH = 900;

/**
 * `/platform-admin/b2b/{application}` — one application, from claim to provisioning. The Platform
 * admin canvas's minimal review board (2026-11-23), top to bottom:
 *
 * - **The opening:** the company and its status, the reference and country under them.
 * - **The step line:** Submitted › In review › Approved › Agreement sent › Signed › Account open,
 *   as numbered pills — green when done, amber for where it is now.
 * - **The next step:** what to do now and its buttons, in one band at the top. `nextReviewStep`
 *   (in `../b2b-review.ts`) is the table; each button is also gated on the permission its route
 *   demands, so a reviewer who may read the queue but not decide sees the state and not the button.
 * - **The application:** one card of only the facts the company gave, under hairlines; everything
 *   it left out goes in a single grey "Not given" box rather than rows of dashes.
 * - **Documents:** a row per document with its status, and a row for each required one missing.
 * - **Beside it:** the agreement, a short history, and — once the account is open — the invitations.
 *
 * ## The order is the owner's (2026-10-26)
 *
 * Approve → draft the agreement against a seller kitchen's negotiated price list → send it → the
 * applicant signs → provision. Provisioning is refused by the server until the agreement is signed,
 * and approval does **not** demand accepted documents: the approve dialog warns when the required
 * ones are not accepted and leaves the judgement to the reviewer.
 *
 * ## Every write re-reads the file
 *
 * The hooks invalidate the whole `platformB2b` root, so the lock version on screen is always the
 * one the next write sends. A stale write comes back as `resource.conflict` and the callout offers
 * a reload rather than retrying blind.
 */
export function PlatformB2bApplicationScreen() {
    return (
        <Gate
            area="platform-admin"
            requirement={{ allOf: ['b2b_application.view_platform'] }}
            testID="platform-b2b-application"
        >
            <ApplicationFile />
        </Gate>
    );
}

type OpenDialog =
    'request-information' | 'approve' | 'decline' | 'send' | 'revise' | 'provision' | null;

/** The kinds the server requires today. Shown as a warning on approval, never enforced here. */
const REQUIRED_KINDS = new Set(['commercial_registration', 'signatory_identification']);

function ApplicationFile() {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();
    const { width: contentWidth } = useContentWidth();
    const beside = contentWidth >= BESIDE_MIN_WIDTH;
    const params = useLocalSearchParams<{ application?: string }>();
    const applicationId = typeof params.application === 'string' ? params.application : undefined;

    const application = usePlatformB2bApplicationQuery(applicationId);
    const agreements = usePlatformB2bAgreementsQuery(applicationId);

    const [dialog, setDialog] = useState<OpenDialog>(null);
    const [editing, setEditing] = useState<B2BAgreement | 'new' | null>(null);

    const claim = useClaimApplicationMutation();
    const send = useSendAgreementMutation();
    const revise = useReviseAgreementMutation();
    const provision = useProvisionApplicationMutation();

    const canReview = useCan(REVIEW);
    const canDecide = useCan(DECIDE);
    const canProvision = useCan(PROVISION);

    const record = application.data;
    const company =
        record === undefined
            ? null
            : (record.legalName ?? record.tradingName ?? t('platformAdmin:b2b.unnamed'));
    useTrailLeaf(record === undefined ? null : record.reference);

    const versions = agreements.data ?? [];
    const loadFailure = toFailure(application.error);
    const writeFailure =
        toFailure(claim.error) ??
        toFailure(send.error) ??
        toFailure(revise.error) ??
        toFailure(provision.error);

    if (application.isPending) {
        return (
            <RecordSkeleton
                testID="platform-b2b-application-loading"
                partTestID="platform-b2b-application"
                tiles={0}
                rows={4}
            />
        );
    }

    if (loadFailure !== null || record === undefined || company === null) {
        return (
            <ErrorState
                testID="platform-b2b-application-error"
                failure={loadFailure ?? apiFailure('resource.not_found')}
                title={t('platformAdmin:b2b.detail.errorTitle')}
                onRetry={() => {
                    void application.refetch();
                }}
                retrying={application.isFetching}
            />
        );
    }

    const step = nextReviewStep(record, versions);
    const stage = reviewStage(record, versions);
    const stageIndex = stage === null ? -1 : REVIEW_STAGES.indexOf(stage);
    const unacceptedRequired =
        record.documents.filter(
            (document) =>
                REQUIRED_KINDS.has(document.kind) &&
                document.reviewStatus !== 'accepted' &&
                document.reviewStatus !== 'superseded',
        ).length + record.missingDocumentKinds.length;

    return (
        <Cascade space="md" testID="platform-b2b-application-screen">
            <View className="flex-col gap-1">
                <CataloguePageHeader
                    titleLook="board"
                    testID="platform-b2b-application-header"
                    titleTestID="platform-b2b-application-title"
                    title={company}
                    titleAside={
                        <DeskChip
                            testID="platform-b2b-application-status"
                            size="lg"
                            tone={applicationStatusTone(record.status)}
                            label={t(applicationStatusKey(record.status))}
                        />
                    }
                />
                <Text
                    tone="secondary"
                    variant="caption"
                    className="tabular-nums"
                    testID="platform-b2b-application-reference"
                >
                    {[record.reference, record.countryCode]
                        .filter((part): part is string => part !== null && part !== '')
                        .join(' · ')}
                </Text>
            </View>

            {stageIndex >= 0 ? (
                <StageLine
                    current={stageIndex}
                    finished={stage === 'provisioned'}
                    label={t('platformAdmin:b2b.stages.label')}
                />
            ) : null}

            {writeFailure === null ? null : (
                <FailureCallout
                    failure={writeFailure}
                    onReload={() => {
                        void application.refetch();
                        void agreements.refetch();
                    }}
                />
            )}

            <NextStepBand
                step={step}
                canReview={canReview}
                canDecide={canDecide}
                canProvision={canProvision}
                claiming={claim.isPending}
                onClaim={() => {
                    claim.mutate(
                        { applicationId: record.id, lockVersion: record.lockVersion },
                        {
                            onSuccess: () => {
                                toast.show({
                                    testID: 'platform-b2b-claimed-toast',
                                    tone: 'success',
                                    message: t('platformAdmin:b2b.toast.claimed'),
                                });
                            },
                        },
                    );
                }}
                onOpen={setDialog}
                onEditAgreement={setEditing}
            />

            {record.duplicateApplications.length === 0 ? null : (
                <Callout
                    testID="platform-b2b-application-duplicates"
                    tone="warning"
                    icon="warning"
                    title={t('platformAdmin:b2b.detail.duplicatesTitle', {
                        count: record.duplicateApplications.length,
                    })}
                    body={t('platformAdmin:b2b.detail.duplicatesBody')}
                    actions={
                        <View className="flex-row flex-wrap gap-2">
                            {record.duplicateApplications.map((duplicate) => (
                                <Button
                                    key={duplicate.id}
                                    testID={`platform-b2b-duplicate-${duplicate.id}`}
                                    size="sm"
                                    variant="secondary"
                                    label={duplicate.reference}
                                    onPress={() => {
                                        router.push(
                                            platformB2bApplicationHref(duplicate.id) as never,
                                        );
                                    }}
                                />
                            ))}
                        </View>
                    }
                />
            )}

            <View className={cx('z-auto gap-4', beside ? 'flex-row items-start' : 'flex-col')}>
                <View className="z-auto min-w-0 flex-1 flex-col gap-4">
                    <ApplicationCard application={record} />
                    <DocumentsCard application={record} />
                </View>
                <View
                    className="z-auto flex-col gap-4"
                    style={beside ? { width: RAIL_WIDTH } : undefined}
                >
                    <AgreementCard agreements={versions} />
                    <HistoryCard application={record} agreements={versions} />
                    {record.provisionedOrganisationId === null ? null : (
                        <InvitationsCard applicationId={record.id} canResend={canProvision} />
                    )}
                </View>
            </View>

            <RequestInformationDialog
                application={record}
                open={dialog === 'request-information'}
                onClose={() => {
                    setDialog(null);
                }}
            />
            <ApproveDialog
                application={record}
                unacceptedRequired={unacceptedRequired}
                open={dialog === 'approve'}
                onClose={() => {
                    setDialog(null);
                }}
            />
            <DeclineDialog
                application={record}
                open={dialog === 'decline'}
                onClose={() => {
                    setDialog(null);
                }}
            />

            <ConfirmDialog
                testID="platform-b2b-send-dialog"
                open={dialog === 'send'}
                title={t('platformAdmin:b2b.agreement.sendTitle')}
                body={t('platformAdmin:b2b.agreement.sendBody')}
                confirmLabel={t('platformAdmin:b2b.agreement.send')}
                loading={send.isPending}
                onClose={() => {
                    setDialog(null);
                }}
                onConfirm={() => {
                    const agreement = liveAgreement(versions);
                    if (agreement === null) return;
                    send.mutate(
                        { agreementId: agreement.id, lockVersion: agreement.lockVersion },
                        {
                            onSettled: () => {
                                setDialog(null);
                            },
                            onSuccess: () => {
                                toast.show({
                                    testID: 'platform-b2b-sent-toast',
                                    tone: 'success',
                                    message: t('platformAdmin:b2b.toast.sent'),
                                });
                            },
                        },
                    );
                }}
            />

            <ConfirmDialog
                testID="platform-b2b-revise-dialog"
                open={dialog === 'revise'}
                title={t('platformAdmin:b2b.agreement.reviseTitle')}
                body={t('platformAdmin:b2b.agreement.reviseBody')}
                confirmLabel={t('platformAdmin:b2b.agreement.revise')}
                loading={revise.isPending}
                onClose={() => {
                    setDialog(null);
                }}
                onConfirm={() => {
                    const agreement = liveAgreement(versions);
                    if (agreement === null) return;
                    revise.mutate(
                        { agreementId: agreement.id, lockVersion: agreement.lockVersion },
                        {
                            onSettled: () => {
                                setDialog(null);
                            },
                            onSuccess: (draft) => {
                                setEditing(draft);
                            },
                        },
                    );
                }}
            />

            <ConfirmDialog
                testID="platform-b2b-provision-dialog"
                open={dialog === 'provision'}
                title={t('platformAdmin:b2b.provision.title', { company })}
                body={t('platformAdmin:b2b.provision.body')}
                confirmLabel={t('platformAdmin:b2b.provision.confirm')}
                loading={provision.isPending}
                onClose={() => {
                    setDialog(null);
                }}
                onConfirm={() => {
                    provision.mutate(record.id, {
                        onSettled: () => {
                            setDialog(null);
                        },
                        onSuccess: (outcome) => {
                            toast.show({
                                testID: 'platform-b2b-provisioned-toast',
                                tone: 'success',
                                message: t('platformAdmin:b2b.toast.provisioned', {
                                    company: outcome.organisationName,
                                    count: outcome.invitationsIssued,
                                }),
                            });
                        },
                    });
                }}
            >
                <View testID="platform-b2b-provision-consequences" className="flex-col gap-2">
                    {[
                        t('platformAdmin:b2b.provision.organisation', { company }),
                        t('platformAdmin:b2b.provision.account'),
                        t('platformAdmin:b2b.provision.owner'),
                        t('platformAdmin:b2b.provision.invitations'),
                    ].map((line) => (
                        <View key={line} className="flex-row items-center gap-2.5">
                            <View
                                aria-hidden
                                className="h-6 w-6 items-center justify-center rounded-full bg-surface-brand-subtle"
                            >
                                <Icon
                                    name="check"
                                    size="sm"
                                    className="text-content-on-brand-subtle"
                                />
                            </View>
                            <Text variant="bodyStrong" className="min-w-0 flex-1">
                                {line}
                            </Text>
                        </View>
                    ))}
                </View>
            </ConfirmDialog>

            {editing === null ? null : (
                <AgreementEditor
                    key={editing === 'new' ? 'new' : `${editing.id}-${String(editing.lockVersion)}`}
                    application={record}
                    agreement={editing === 'new' ? null : editing}
                    open
                    onClose={() => {
                        setEditing(null);
                    }}
                />
            )}
        </Cascade>
    );
}

/**
 * Where the application is, as numbered pills: green with a tick once a step is done, amber for
 * the step it is on, grey for the steps still to come.
 */
function StageLine({
    current,
    finished,
    label,
}: {
    readonly current: number;
    readonly finished: boolean;
    readonly label: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    return (
        <View
            testID="platform-b2b-application-stages"
            role="list"
            aria-label={label}
            className="flex-row flex-wrap items-center gap-1.5"
        >
            {REVIEW_STAGES.map((key, index) => {
                const done = index < current || finished;
                const now = !done && index === current;
                return (
                    <View
                        key={key}
                        testID={`platform-b2b-stage-${key}`}
                        role="listitem"
                        aria-current={now ? 'step' : undefined}
                        className={cx(
                            'h-8 flex-row items-center gap-2 rounded-full pe-3.5 ps-1.5',
                            done
                                ? 'bg-surface-brand-subtle'
                                : now
                                  ? 'bg-warning-subtle'
                                  : 'bg-surface-sunken',
                        )}
                    >
                        <View
                            aria-hidden
                            className={cx(
                                'h-[22px] w-[22px] items-center justify-center rounded-full',
                                done
                                    ? 'bg-surface-brand'
                                    : now
                                      ? 'bg-warning-strong'
                                      : 'bg-surface-raised',
                            )}
                        >
                            {done ? (
                                <Icon name="check" size="sm" className="text-content-on-brand" />
                            ) : (
                                <RNText
                                    className={cx(
                                        'text-[11px] font-bold tabular-nums',
                                        now ? 'text-content-on-brand' : 'text-content-secondary',
                                    )}
                                >
                                    {formatter.formatNumber(index + 1)}
                                </RNText>
                            )}
                        </View>
                        <RNText
                            className={cx(
                                'text-[13px] font-semibold',
                                done
                                    ? 'text-content-on-brand-subtle'
                                    : now
                                      ? 'text-warning-on-subtle'
                                      : 'text-content-secondary',
                            )}
                        >
                            {t(`platformAdmin:b2b.stages.${key}`)}
                        </RNText>
                    </View>
                );
            })}
        </View>
    );
}

function FailureCallout({
    failure,
    onReload,
}: {
    readonly failure: ApiFailure;
    readonly onReload: () => void;
}) {
    const { t } = useTranslation();
    const conflict = failure.code === 'resource.conflict';

    return (
        <Callout
            testID="platform-b2b-application-write-error"
            role="alert"
            tone={conflict ? 'warning' : 'danger'}
            icon="warning"
            title={conflict ? t('platformAdmin:b2b.detail.conflictTitle') : failure.message}
            {...(conflict ? { body: t('platformAdmin:b2b.detail.conflictBody') } : {})}
            actions={
                conflict ? (
                    <Button
                        testID="platform-b2b-application-reload"
                        size="sm"
                        variant="secondary"
                        label={t('platformAdmin:b2b.detail.reload')}
                        onPress={onReload}
                    />
                ) : undefined
            }
        />
    );
}

type BandTone = 'act' | 'wait' | 'done' | 'closed';

const BAND: Readonly<
    Record<BandTone, { readonly icon: IconName; readonly box: string; readonly ink: string }>
> = {
    act: { icon: 'pen', box: 'bg-warning-subtle', ink: 'text-warning-on-subtle' },
    wait: { icon: 'clock', box: 'bg-info-subtle', ink: 'text-info-on-subtle' },
    done: { icon: 'check', box: 'bg-surface-brand-subtle', ink: 'text-content-on-brand-subtle' },
    closed: { icon: 'ban', box: 'bg-surface-sunken', ink: 'text-content-secondary' },
};

function bandTone(step: ReviewStep): BandTone {
    switch (step.kind) {
        case 'claim':
        case 'waiting_applicant':
        case 'waiting_signature':
            return 'wait';
        case 'provisioned':
            return 'done';
        case 'closed':
            return 'closed';
        default:
            return 'act';
    }
}

/** What to do now: the step's title and one line, with its buttons at the end of the band. */
function NextStepBand({
    step,
    canReview,
    canDecide,
    canProvision,
    claiming,
    onClaim,
    onOpen,
    onEditAgreement,
}: {
    readonly step: ReviewStep;
    readonly canReview: boolean;
    readonly canDecide: boolean;
    readonly canProvision: boolean;
    readonly claiming: boolean;
    readonly onClaim: () => void;
    readonly onOpen: (dialog: OpenDialog) => void;
    readonly onEditAgreement: (agreement: B2BAgreement | 'new') => void;
}) {
    const { t } = useTranslation();
    const tone = BAND[bandTone(step)];

    const decline = canDecide ? (
        <Button
            testID="platform-b2b-decline"
            size="sm"
            variant="dangerOutline"
            label={t('platformAdmin:b2b.actions.decline')}
            onPress={() => {
                onOpen('decline');
            }}
        />
    ) : null;

    let actions: ReactNode;
    switch (step.kind) {
        case 'claim':
            actions = canReview ? (
                <Button
                    testID="platform-b2b-claim"
                    size="sm"
                    label={t('platformAdmin:b2b.actions.claim')}
                    iconStart={<Icon name="handshake" size="sm" />}
                    loading={claiming}
                    onPress={onClaim}
                />
            ) : null;
            break;
        case 'decide':
            actions = (
                <>
                    {decline}
                    {canReview ? (
                        <Button
                            testID="platform-b2b-request-information"
                            size="sm"
                            variant="secondary"
                            label={t('platformAdmin:b2b.actions.requestInformation')}
                            onPress={() => {
                                onOpen('request-information');
                            }}
                        />
                    ) : null}
                    {canDecide ? (
                        <Button
                            testID="platform-b2b-approve"
                            size="sm"
                            label={t('platformAdmin:b2b.actions.approve')}
                            iconStart={<Icon name="check" size="sm" />}
                            onPress={() => {
                                onOpen('approve');
                            }}
                        />
                    ) : null}
                </>
            );
            break;
        case 'waiting_applicant':
            actions = decline;
            break;
        case 'draft_agreement':
            actions = canDecide ? (
                <Button
                    testID="platform-b2b-draft-agreement"
                    size="sm"
                    label={t('platformAdmin:b2b.actions.draftAgreement')}
                    iconStart={<Icon name="fileText" size="sm" />}
                    onPress={() => {
                        onEditAgreement('new');
                    }}
                />
            ) : null;
            break;
        case 'send_agreement':
            actions = canDecide ? (
                <>
                    <Button
                        testID="platform-b2b-edit-agreement"
                        size="sm"
                        variant="secondary"
                        label={t('platformAdmin:b2b.agreement.edit')}
                        onPress={() => {
                            onEditAgreement(step.agreement);
                        }}
                    />
                    <Button
                        testID="platform-b2b-send-agreement"
                        size="sm"
                        label={t('platformAdmin:b2b.agreement.send')}
                        iconStart={<Icon name="send" size="sm" />}
                        onPress={() => {
                            onOpen('send');
                        }}
                    />
                </>
            ) : null;
            break;
        case 'waiting_signature':
            actions = canDecide ? (
                <Button
                    testID="platform-b2b-revise-agreement"
                    size="sm"
                    variant="secondary"
                    label={t('platformAdmin:b2b.agreement.revise')}
                    onPress={() => {
                        onOpen('revise');
                    }}
                />
            ) : null;
            break;
        case 'provision':
            actions = canProvision ? (
                <Button
                    testID="platform-b2b-provision"
                    size="sm"
                    label={t('platformAdmin:b2b.provision.confirm')}
                    iconStart={<Icon name="building" size="sm" />}
                    onPress={() => {
                        onOpen('provision');
                    }}
                />
            ) : null;
            break;
        default:
            actions = null;
    }

    return (
        <View
            testID="platform-b2b-next-step"
            role="region"
            aria-label={t('platformAdmin:b2b.next.label')}
            className="flex-row flex-wrap items-center gap-4 rounded-[20px] border border-stroke-subtle bg-surface-raised px-4 py-4"
        >
            <View
                aria-hidden
                className={cx('h-11 w-11 items-center justify-center rounded-[14px]', tone.box)}
            >
                <Icon name={tone.icon} size="md" className={tone.ink} />
            </View>
            <View className="min-w-[220px] flex-1 flex-col">
                <Text variant="bodyStrong" testID="platform-b2b-next-step-title">
                    {t(`platformAdmin:b2b.next.${step.kind}.title`)}
                </Text>
                <Text variant="caption" tone="secondary">
                    {t(`platformAdmin:b2b.next.${step.kind}.body`)}
                </Text>
            </View>
            {actions === null ? null : (
                <View className="flex-row flex-wrap items-center justify-end gap-2">{actions}</View>
            )}
        </View>
    );
}

const SECTION_VOCABULARY: Readonly<Record<string, string>> = {
    businessType: 'businessTypes',
    requestedPaymentTerms: 'paymentTerms',
    expectedVolumeBand: 'volumeBands',
    expectedOrderFrequency: 'orderFrequencies',
    preferredDeliveryWindow: 'deliveryWindows',
};

/**
 * The application as one card: a group per section with only the fields the company filled, the
 * people and places it named, and one grey box listing everything it left out.
 */
function ApplicationCard({ application }: { readonly application: PlatformB2bApplication }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const sections = application.sections;

    const display = (key: string, value: unknown): string | null => {
        if (value === null || value === undefined || value === '') return null;
        const vocabulary = SECTION_VOCABULARY[key];
        if (vocabulary !== undefined && typeof value === 'string') {
            return t(`b2bApplication:${vocabulary}.${value}`);
        }
        if (Array.isArray(value)) {
            return value.length === 0
                ? null
                : value
                      .map((item: string) => t(`b2bApplication:productCategories.${item}`))
                      .join(', ');
        }
        if (typeof value === 'boolean') {
            return value ? t('platformAdmin:b2b.yes') : t('platformAdmin:b2b.no');
        }
        if (key === 'requestedCreditLimitMinor' && typeof value === 'number') {
            const currency = sections.trade_terms.currencyCode;
            return currency === null
                ? String(value / 100)
                : formatter.formatCurrency(value / 100, currency);
        }
        return String(value);
    };

    const missing: string[] = [];
    const groups = B2B_APPLICATION_SECTIONS.map((section) => {
        const facts: SheetFact[] = [];
        for (const [key, value] of Object.entries(sections[section])) {
            const label = t(`b2bApplication:fields.${key}`);
            const shown = display(key, value);
            if (shown === null) missing.push(label);
            else facts.push({ key, label, value: shown });
        }
        return { section, facts };
    });
    if (application.contacts.length === 0) missing.push(t('platformAdmin:b2b.contacts.title'));
    if (application.locations.length === 0) missing.push(t('platformAdmin:b2b.locations.title'));

    return (
        <SheetCard testID="platform-b2b-sections" title={t('platformAdmin:b2b.detail.application')}>
            {groups
                .filter((group) => group.facts.length > 0)
                .map((group) => (
                    <View
                        key={group.section}
                        testID={`platform-b2b-section-${group.section}`}
                        className="mt-1 flex-col"
                    >
                        <GroupLabel label={t(`b2bApplication:sections.${group.section}.title`)} />
                        <SheetFacts
                            testID={`platform-b2b-section-${group.section}-field`}
                            facts={group.facts}
                        />
                    </View>
                ))}

            {application.contacts.length === 0 ? null : (
                <View testID="platform-b2b-contacts" className="mt-1 flex-col">
                    <GroupLabel label={t('platformAdmin:b2b.contacts.title')} />
                    <SheetFacts
                        testID="platform-b2b-contacts-field"
                        facts={application.contacts.map((contact, index) => ({
                            key: `${contact.role}-${String(index)}`,
                            label: t(`platformAdmin:b2b.contacts.roles.${contact.role}`),
                            value: [contact.name, contact.title, contact.email, contact.phone]
                                .filter((part) => part !== null && part !== '')
                                .join(' · '),
                        }))}
                    />
                </View>
            )}

            {application.locations.length === 0 ? null : (
                <View testID="platform-b2b-locations" className="mt-1 flex-col">
                    <GroupLabel label={t('platformAdmin:b2b.locations.title')} />
                    <SheetFacts
                        testID="platform-b2b-locations-field"
                        facts={application.locations.map((location, index) => ({
                            key: `${location.label}-${String(index)}`,
                            label: [
                                location.label,
                                location.isPrimary ? t('platformAdmin:b2b.locations.primary') : '',
                                location.isBillingAddress
                                    ? t('platformAdmin:b2b.locations.billing')
                                    : '',
                            ]
                                .filter((part) => part !== '')
                                .join(' · '),
                            value: [
                                location.addressLine1,
                                location.addressLine2,
                                location.city,
                                location.countryCode,
                            ]
                                .filter((part) => part !== null && part !== '')
                                .join(', '),
                        }))}
                    />
                </View>
            )}

            {missing.length === 0 ? null : (
                <View
                    testID="platform-b2b-not-given"
                    className="mt-2 flex-col gap-0.5 rounded-[14px] bg-surface-sunken px-3.5 py-3"
                >
                    <Text variant="caption" className="font-bold">
                        {t('platformAdmin:b2b.detail.notGiven')}
                    </Text>
                    <Text variant="caption" tone="secondary">
                        {missing.join(t('platformAdmin:common.listSeparator'))}
                    </Text>
                </View>
            )}
        </SheetCard>
    );
}

function GroupLabel({ label }: { readonly label: string }) {
    return (
        <RNText className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-content-secondary text-start">
            {label}
        </RNText>
    );
}

/** The agreement as it stands: its version, status and the terms set so far. */
function AgreementCard({ agreements }: { readonly agreements: readonly B2BAgreement[] }) {
    const { t, i18n } = useTranslation();
    const formatter = useFormatter();
    const agreement = liveAgreement(agreements);
    const earlier = agreements.filter((candidate) => candidate.id !== agreement?.id).length;

    if (agreement === null) {
        return (
            <SheetCard
                testID="platform-b2b-agreement"
                title={t('platformAdmin:b2b.agreement.title')}
            >
                <Text tone="secondary">{t('platformAdmin:b2b.agreement.none')}</Text>
            </SheetCard>
        );
    }

    const money = (minor: number | null) =>
        minor === null || agreement.terms.currencyCode === null
            ? null
            : formatter.formatCurrency(minor / 100, agreement.terms.currencyCode);
    const seller =
        agreement.seller === null
            ? null
            : `${agreement.seller.organisationName} — ${
                  i18n.language === 'ar' && agreement.seller.priceListNameAr !== null
                      ? agreement.seller.priceListNameAr
                      : agreement.seller.priceListNameEn
              }`;
    const terms: readonly (readonly [string, string, string | null])[] = [
        ['seller', t('platformAdmin:b2b.agreement.seller'), seller],
        [
            'payment',
            t('platformAdmin:b2b.agreement.paymentTerms'),
            agreement.terms.paymentTerms === null
                ? null
                : t(`b2bApplication:paymentTerms.${agreement.terms.paymentTerms}`),
        ],
        [
            'credit',
            t('platformAdmin:b2b.agreement.creditLimit'),
            money(agreement.terms.creditLimitMinor),
        ],
        [
            'minimum',
            t('platformAdmin:b2b.agreement.minimumOrder'),
            money(agreement.terms.minimumOrderMinor),
        ],
        [
            'signed',
            t('platformAdmin:b2b.agreement.signedBy'),
            agreement.signature === null
                ? null
                : `${agreement.signature.typedName}, ${agreement.signature.signatoryTitle}`,
        ],
    ];
    const set = terms.filter(([, , value]) => value !== null);
    const unset = terms.filter(([, , value]) => value === null).map(([, label]) => label);

    return (
        <SheetCard
            testID="platform-b2b-agreement"
            title={t('platformAdmin:b2b.agreement.title')}
            trailing={
                <Text tone="secondary" variant="label">
                    {t('platformAdmin:b2b.agreement.versionShort', { version: agreement.version })}
                </Text>
            }
        >
            <View
                testID={`platform-b2b-agreement-${String(agreement.version)}`}
                className="flex-col gap-2"
            >
                <View className="flex-row flex-wrap items-center justify-between gap-2">
                    <Text variant="bodyStrong" className="min-w-0 flex-1">
                        {agreement.title}
                    </Text>
                    <DeskChip
                        testID={`platform-b2b-agreement-${String(agreement.version)}-status`}
                        tone={
                            agreement.status === 'active'
                                ? 'success'
                                : agreement.status === 'terminated'
                                  ? 'neutral'
                                  : 'info'
                        }
                        label={t(`platformAdmin:b2b.agreementStatus.${agreement.status}`)}
                    />
                </View>
                {set.length === 0 ? null : (
                    <SheetFacts
                        testID="platform-b2b-agreement-terms"
                        facts={set.map(([key, label, value]) => ({
                            key,
                            label,
                            value: value ?? '',
                        }))}
                    />
                )}
                {unset.length === 0 ? null : (
                    <Text variant="caption" tone="secondary">
                        {t('platformAdmin:b2b.agreement.notSet', {
                            fields: unset.join(t('platformAdmin:common.listSeparator')),
                        })}
                    </Text>
                )}
                {earlier === 0 ? null : (
                    <Text variant="caption" tone="secondary">
                        {t('platformAdmin:b2b.agreement.earlier', { count: earlier })}
                    </Text>
                )}
            </View>
        </SheetCard>
    );
}

/** What has happened to the application, oldest first, with the words that went with it. */
function HistoryCard({
    application,
    agreements,
}: {
    readonly application: PlatformB2bApplication;
    readonly agreements: readonly B2BAgreement[];
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const date = (value: string) => formatter.formatDate(value, { dateStyle: 'medium' });
    const signature = liveAgreement(agreements)?.signature ?? null;

    const events: {
        readonly key: string;
        readonly label: string;
        readonly at: string | null;
        readonly note: string | null;
    }[] = [];
    if (application.submittedAt !== null) {
        events.push({
            key: 'submitted',
            label: t('platformAdmin:b2b.history.submitted'),
            at: date(application.submittedAt),
            note: null,
        });
    }
    if (application.informationRequest !== null) {
        events.push({
            key: 'information',
            label: t('platformAdmin:b2b.decision.informationRequest'),
            at: null,
            note: application.informationRequest,
        });
    }
    if (application.decidedAt !== null) {
        events.push({
            key: 'decided',
            label: t(`platformAdmin:b2b.history.decided.${application.status}`, {
                defaultValue: t('platformAdmin:b2b.decision.decided'),
            }),
            at: date(application.decidedAt),
            note: application.applicantMessage,
        });
    }
    if (application.decisionNote !== null) {
        events.push({
            key: 'note',
            label: t('platformAdmin:b2b.decision.internalNote'),
            at: null,
            note: application.decisionNote,
        });
    }
    if (signature !== null) {
        events.push({
            key: 'signed',
            label: t('platformAdmin:b2b.history.signed', { name: signature.typedName }),
            at: date(signature.signedAt),
            note: null,
        });
    }
    if (application.provisionedOrganisationId !== null) {
        events.push({
            key: 'opened',
            label: t('platformAdmin:b2b.history.opened'),
            at: null,
            note: null,
        });
    }

    return (
        <SheetCard testID="platform-b2b-decision" title={t('platformAdmin:b2b.history.title')}>
            <View role="list" className="flex-col">
                {events.map((event, index) => (
                    <View
                        key={event.key}
                        testID={`platform-b2b-history-${event.key}`}
                        role="listitem"
                        className="flex-row gap-3"
                    >
                        <View aria-hidden className="w-2 items-center">
                            <View className="mt-1.5 h-2 w-2 rounded-full bg-surface-brand" />
                            {index === events.length - 1 ? null : (
                                <View className="mt-1 w-0.5 flex-1 rounded-full bg-stroke-subtle" />
                            )}
                        </View>
                        <View
                            className={cx(
                                'min-w-0 flex-1 flex-col',
                                index === events.length - 1 ? null : 'pb-3.5',
                            )}
                        >
                            <View className="flex-row items-baseline justify-between gap-2">
                                <Text variant="bodyStrong" className="min-w-0 flex-1">
                                    {event.label}
                                </Text>
                                {event.at === null ? null : (
                                    <Text
                                        variant="caption"
                                        tone="secondary"
                                        className="tabular-nums"
                                    >
                                        {event.at}
                                    </Text>
                                )}
                            </View>
                            {event.note === null ? null : (
                                <Text variant="caption" tone="secondary">
                                    {event.note}
                                </Text>
                            )}
                        </View>
                    </View>
                ))}
            </View>
        </SheetCard>
    );
}

function InvitationsCard({
    applicationId,
    canResend,
}: {
    readonly applicationId: string;
    readonly canResend: boolean;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const invitations = usePlatformB2bInvitationsQuery(applicationId);
    const resend = useResendInvitationMutation();
    const rows = invitations.data ?? [];

    return (
        <SheetCard
            testID="platform-b2b-invitations"
            title={t('platformAdmin:b2b.invitations.title')}
        >
            {rows.length === 0 ? (
                <Text tone="secondary">{t('platformAdmin:b2b.invitations.none')}</Text>
            ) : (
                rows.map((invitation) => (
                    <View
                        key={invitation.id}
                        className="flex-row flex-wrap items-center gap-2 border-t border-stroke-subtle py-2.5"
                    >
                        <Text
                            testID={`platform-b2b-invitation-${invitation.id}`}
                            numberOfLines={1}
                            className="min-w-0 flex-1"
                        >
                            {invitation.email}
                        </Text>
                        <DeskChip
                            tone={
                                invitation.status === 'accepted'
                                    ? 'success'
                                    : invitation.status === 'live'
                                      ? 'info'
                                      : 'neutral'
                            }
                            label={t(`platformAdmin:b2b.invitations.status.${invitation.status}`)}
                        />
                        {canResend &&
                        (invitation.status === 'live' || invitation.status === 'expired') ? (
                            <Button
                                testID={`platform-b2b-invitation-${invitation.id}-resend`}
                                size="sm"
                                variant="quiet"
                                label={t('platformAdmin:b2b.invitations.resend')}
                                loading={
                                    resend.isPending &&
                                    resend.variables?.invitationId === invitation.id
                                }
                                onPress={() => {
                                    resend.mutate(
                                        { applicationId, invitationId: invitation.id },
                                        {
                                            onSuccess: () => {
                                                toast.show({
                                                    testID: 'platform-b2b-resent-toast',
                                                    tone: 'success',
                                                    message: t(
                                                        'platformAdmin:b2b.invitations.resent',
                                                        { email: invitation.email },
                                                    ),
                                                });
                                            },
                                        },
                                    );
                                }}
                            />
                        ) : null}
                    </View>
                ))
            )}
        </SheetCard>
    );
}

/** A row per document with its status, and a row for each required one not uploaded. */
function DocumentsCard({ application }: { readonly application: PlatformB2bApplication }) {
    const { t } = useTranslation();
    const canView = useCan(KYC_VIEW);
    const canReview = useCan([KYC_VIEW, REVIEW]);
    const download = useReviewerDocumentDownloadMutation();
    const review = useReviewDocumentMutation();
    const [rejecting, setRejecting] = useState<PlatformKycDocument | null>(null);
    const [reason, setReason] = useState<KycRejectionReason | null>(null);
    const [note, setNote] = useState('');

    const failure = toFailure(download.error) ?? toFailure(review.error);
    const current = application.documents.filter(
        (document) => document.reviewStatus !== 'superseded',
    );
    const accepted = current.filter((document) => document.reviewStatus === 'accepted').length;
    const total = current.length + application.missingDocumentKinds.length;

    return (
        <SheetCard
            testID="platform-b2b-documents"
            title={t('b2bApplication:documents.title')}
            trailing={
                total === 0 ? undefined : (
                    <Text tone="secondary" variant="label">
                        {t('platformAdmin:b2b.documents.acceptedCount', {
                            accepted,
                            total,
                        })}
                    </Text>
                )
            }
        >
            {failure === null ? null : (
                <Callout
                    testID="platform-b2b-documents-error"
                    role="alert"
                    tone="danger"
                    icon="warning"
                    title={failure.message}
                />
            )}

            {total === 0 ? (
                <Text tone="secondary">{t('platformAdmin:b2b.documents.none')}</Text>
            ) : (
                <View className="flex-col">
                    {current.map((document, index) => (
                        <View
                            key={document.id}
                            testID={`platform-b2b-document-${document.id}`}
                            className={cx(
                                'flex-row flex-wrap items-center gap-3 py-3',
                                index === 0 ? null : 'border-t border-stroke-subtle',
                            )}
                        >
                            <View className="min-w-[180px] flex-1 flex-col">
                                <Text variant="bodyStrong">
                                    {t(`b2bApplication:documents.kinds.${document.kind}`)}
                                </Text>
                                <Text variant="caption" tone="secondary" numberOfLines={1}>
                                    {document.fileName}
                                </Text>
                            </View>
                            <View className="flex-row flex-wrap items-center gap-1.5">
                                <DeskChip
                                    testID={`platform-b2b-document-${document.id}-status`}
                                    tone={
                                        document.reviewStatus === 'accepted'
                                            ? 'success'
                                            : document.reviewStatus === 'rejected'
                                              ? 'danger'
                                              : 'info'
                                    }
                                    label={t(
                                        `b2bApplication:documents.reviewStatus.${document.reviewStatus}`,
                                    )}
                                />
                                {document.mediaTypeMismatch ? (
                                    <DeskChip
                                        tone="warning"
                                        label={t('platformAdmin:b2b.documents.mismatch')}
                                    />
                                ) : null}
                                {document.hasExpired ? (
                                    <DeskChip
                                        tone="warning"
                                        label={t('platformAdmin:b2b.documents.expired')}
                                    />
                                ) : null}
                            </View>
                            <View className="flex-row items-center gap-1">
                                {canView ? (
                                    <Button
                                        testID={`platform-b2b-document-${document.id}-view`}
                                        size="sm"
                                        variant="quiet"
                                        label={t('platformAdmin:b2b.documents.view')}
                                        loading={
                                            download.isPending &&
                                            download.variables?.documentId === document.id
                                        }
                                        onPress={() => {
                                            download.mutate(
                                                {
                                                    applicationId: application.id,
                                                    documentId: document.id,
                                                },
                                                {
                                                    onSuccess: (link) => {
                                                        void Linking.openURL(link.url);
                                                    },
                                                },
                                            );
                                        }}
                                    />
                                ) : null}
                                {canReview && document.reviewStatus === 'pending' ? (
                                    <>
                                        <Button
                                            testID={`platform-b2b-document-${document.id}-reject`}
                                            size="sm"
                                            variant="quiet"
                                            label={t('platformAdmin:b2b.documents.reject')}
                                            onPress={() => {
                                                setRejecting(document);
                                                setReason(null);
                                                setNote('');
                                            }}
                                        />
                                        <Button
                                            testID={`platform-b2b-document-${document.id}-accept`}
                                            size="sm"
                                            variant="secondary"
                                            label={t('platformAdmin:b2b.documents.accept')}
                                            loading={
                                                review.isPending &&
                                                review.variables?.documentId === document.id
                                            }
                                            onPress={() => {
                                                review.mutate({
                                                    documentId: document.id,
                                                    verdict: 'accepted',
                                                });
                                            }}
                                        />
                                    </>
                                ) : null}
                            </View>
                        </View>
                    ))}
                    {application.missingDocumentKinds.map((kind, index) => (
                        <View
                            key={kind}
                            testID={`platform-b2b-document-missing-${kind}`}
                            className={cx(
                                'flex-row flex-wrap items-center gap-3 py-3',
                                current.length === 0 && index === 0
                                    ? null
                                    : 'border-t border-stroke-subtle',
                            )}
                        >
                            <View className="min-w-[180px] flex-1 flex-col">
                                <Text variant="bodyStrong">
                                    {t(`b2bApplication:documents.kinds.${kind}`)}
                                </Text>
                                <Text variant="caption" tone="secondary">
                                    {t('platformAdmin:b2b.documents.notUploaded')}
                                </Text>
                            </View>
                            <DeskChip
                                tone="warning"
                                label={t('platformAdmin:b2b.documents.missingChip')}
                            />
                        </View>
                    ))}
                </View>
            )}

            <Dialog
                testID="platform-b2b-reject-dialog"
                open={rejecting !== null}
                look="card"
                onClose={() => {
                    setRejecting(null);
                }}
                title={t('platformAdmin:b2b.documents.rejectTitle')}
                description={t('platformAdmin:b2b.documents.rejectBody')}
                actions={
                    <>
                        <Button
                            testID="platform-b2b-reject-cancel"
                            variant="quiet"
                            label={t('platformAdmin:b2b.cancel')}
                            onPress={() => {
                                setRejecting(null);
                            }}
                        />
                        <Button
                            testID="platform-b2b-reject-confirm"
                            variant="danger"
                            label={t('platformAdmin:b2b.documents.reject')}
                            disabled={reason === null}
                            loading={review.isPending}
                            onPress={() => {
                                if (rejecting === null || reason === null) return;
                                review.mutate(
                                    {
                                        documentId: rejecting.id,
                                        verdict: 'rejected',
                                        rejectionReason: reason,
                                        ...(note.trim() === '' ? {} : { note: note.trim() }),
                                    },
                                    {
                                        onSuccess: () => {
                                            setRejecting(null);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <View className="flex-col gap-3.5">
                    <Select<KycRejectionReason>
                        testID="platform-b2b-reject-reason"
                        label={t('platformAdmin:b2b.documents.reason')}
                        value={reason}
                        options={KYC_REJECTION_REASONS.map((value) => ({
                            value,
                            label: t(`b2bApplication:documents.rejection.${value}`),
                        }))}
                        onChange={setReason}
                    />
                    <TextInputField
                        testID="platform-b2b-reject-note"
                        id="platform-b2b-reject-note"
                        size="sm"
                        label={t('platformAdmin:b2b.documents.note')}
                        value={note}
                        onChangeText={setNote}
                        multiline
                    />
                </View>
            </Dialog>
        </SheetCard>
    );
}

function RequestInformationDialog({
    application,
    open,
    onClose,
}: {
    readonly application: PlatformB2bApplication;
    readonly open: boolean;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const request = useRequestInformationMutation();
    const [message, setMessage] = useState('');
    const [sections, setSections] = useState<readonly B2BApplicationSection[]>([]);
    const failure = toFailure(request.error);

    return (
        <Dialog
            testID="platform-b2b-request-dialog"
            open={open}
            look="card"
            onClose={onClose}
            title={t('platformAdmin:b2b.request.title')}
            description={t('platformAdmin:b2b.request.body')}
            actions={
                <>
                    <Button
                        testID="platform-b2b-request-cancel"
                        variant="quiet"
                        label={t('platformAdmin:b2b.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="platform-b2b-request-confirm"
                        label={t('platformAdmin:b2b.request.confirm')}
                        disabled={message.trim() === ''}
                        loading={request.isPending}
                        onPress={() => {
                            request.mutate(
                                {
                                    applicationId: application.id,
                                    lockVersion: application.lockVersion,
                                    message: message.trim(),
                                    sections,
                                },
                                { onSuccess: onClose },
                            );
                        }}
                    />
                </>
            }
        >
            <View className="flex-col gap-3.5">
                {failure === null ? null : (
                    <Callout role="alert" tone="danger" icon="warning" title={failure.message} />
                )}
                <TextInputField
                    testID="platform-b2b-request-message"
                    id="platform-b2b-request-message"
                    size="sm"
                    label={t('platformAdmin:b2b.request.message')}
                    hint={t('platformAdmin:b2b.request.messageHint')}
                    value={message}
                    onChangeText={setMessage}
                    multiline
                    required
                />
                <View className="flex-col gap-1">
                    <Text variant="caption" className="font-semibold" tone="secondary">
                        {t('platformAdmin:b2b.request.sections')}
                    </Text>
                    {B2B_APPLICATION_SECTIONS.map((section) => (
                        <Checkbox
                            key={section}
                            testID={`platform-b2b-request-section-${section}`}
                            label={t(`b2bApplication:sections.${section}.title`)}
                            checked={sections.includes(section)}
                            onChange={(checked) => {
                                setSections((current) =>
                                    checked
                                        ? [...current, section]
                                        : current.filter((item) => item !== section),
                                );
                            }}
                        />
                    ))}
                </View>
            </View>
        </Dialog>
    );
}

function ApproveDialog({
    application,
    unacceptedRequired,
    open,
    onClose,
}: {
    readonly application: PlatformB2bApplication;
    readonly unacceptedRequired: number;
    readonly open: boolean;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const approve = useApproveApplicationMutation();
    const [applicantMessage, setApplicantMessage] = useState('');
    const [internalNote, setInternalNote] = useState('');
    const failure = toFailure(approve.error);

    return (
        <Dialog
            testID="platform-b2b-approve-dialog"
            open={open}
            look="card"
            onClose={onClose}
            title={t('platformAdmin:b2b.approve.title')}
            description={t('platformAdmin:b2b.approve.body')}
            actions={
                <>
                    <Button
                        testID="platform-b2b-approve-cancel"
                        variant="quiet"
                        label={t('platformAdmin:b2b.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="platform-b2b-approve-confirm"
                        label={t('platformAdmin:b2b.actions.approve')}
                        loading={approve.isPending}
                        onPress={() => {
                            approve.mutate(
                                {
                                    applicationId: application.id,
                                    lockVersion: application.lockVersion,
                                    ...(applicantMessage.trim() === ''
                                        ? {}
                                        : { applicantMessage: applicantMessage.trim() }),
                                    ...(internalNote.trim() === ''
                                        ? {}
                                        : { internalNote: internalNote.trim() }),
                                },
                                { onSuccess: onClose },
                            );
                        }}
                    />
                </>
            }
        >
            <View className="flex-col gap-3.5">
                {unacceptedRequired === 0 ? null : (
                    <Callout
                        testID="platform-b2b-approve-documents-warning"
                        tone="warning"
                        icon="warning"
                        title={t('platformAdmin:b2b.approve.documentsWarning', {
                            count: unacceptedRequired,
                        })}
                    />
                )}
                {failure === null ? null : (
                    <Callout role="alert" tone="danger" icon="warning" title={failure.message} />
                )}
                <TextInputField
                    testID="platform-b2b-approve-applicant-message"
                    id="platform-b2b-approve-applicant-message"
                    size="sm"
                    label={t('platformAdmin:b2b.decision.applicantMessage')}
                    hint={t('platformAdmin:b2b.approve.applicantMessageHint')}
                    value={applicantMessage}
                    onChangeText={setApplicantMessage}
                    multiline
                />
                <TextInputField
                    testID="platform-b2b-approve-internal-note"
                    id="platform-b2b-approve-internal-note"
                    size="sm"
                    label={t('platformAdmin:b2b.decision.internalNote')}
                    hint={t('platformAdmin:b2b.internalNoteHint')}
                    value={internalNote}
                    onChangeText={setInternalNote}
                    multiline
                />
            </View>
        </Dialog>
    );
}

function DeclineDialog({
    application,
    open,
    onClose,
}: {
    readonly application: PlatformB2bApplication;
    readonly open: boolean;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const decline = useDeclineApplicationMutation();
    const [applicantMessage, setApplicantMessage] = useState('');
    const [internalNote, setInternalNote] = useState('');
    const failure = toFailure(decline.error);

    return (
        <Dialog
            testID="platform-b2b-decline-dialog"
            open={open}
            look="card"
            onClose={onClose}
            title={t('platformAdmin:b2b.decline.title')}
            description={t('platformAdmin:b2b.decline.body')}
            actions={
                <>
                    <Button
                        testID="platform-b2b-decline-cancel"
                        variant="quiet"
                        label={t('platformAdmin:b2b.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="platform-b2b-decline-confirm"
                        variant="danger"
                        label={t('platformAdmin:b2b.actions.decline')}
                        disabled={applicantMessage.trim() === ''}
                        loading={decline.isPending}
                        onPress={() => {
                            decline.mutate(
                                {
                                    applicationId: application.id,
                                    lockVersion: application.lockVersion,
                                    applicantMessage: applicantMessage.trim(),
                                    ...(internalNote.trim() === ''
                                        ? {}
                                        : { internalNote: internalNote.trim() }),
                                },
                                { onSuccess: onClose },
                            );
                        }}
                    />
                </>
            }
        >
            <View className="flex-col gap-3.5">
                {failure === null ? null : (
                    <Callout role="alert" tone="danger" icon="warning" title={failure.message} />
                )}
                <TextInputField
                    testID="platform-b2b-decline-applicant-message"
                    id="platform-b2b-decline-applicant-message"
                    size="sm"
                    label={t('platformAdmin:b2b.decision.applicantMessage')}
                    hint={t('platformAdmin:b2b.decline.applicantMessageHint')}
                    value={applicantMessage}
                    onChangeText={setApplicantMessage}
                    multiline
                    required
                />
                <TextInputField
                    testID="platform-b2b-decline-internal-note"
                    id="platform-b2b-decline-internal-note"
                    size="sm"
                    label={t('platformAdmin:b2b.decision.internalNote')}
                    hint={t('platformAdmin:b2b.internalNoteHint')}
                    value={internalNote}
                    onChangeText={setInternalNote}
                    multiline
                />
            </View>
        </Dialog>
    );
}

function ConfirmDialog({
    testID,
    open,
    title,
    body,
    confirmLabel,
    loading,
    onClose,
    onConfirm,
    children,
}: {
    readonly testID: string;
    readonly open: boolean;
    readonly title: string;
    readonly body: string;
    readonly confirmLabel: string;
    readonly loading: boolean;
    readonly onClose: () => void;
    readonly onConfirm: () => void;
    readonly children?: ReactNode;
}) {
    const { t } = useTranslation();

    return (
        <Dialog
            testID={testID}
            open={open}
            look="card"
            onClose={onClose}
            title={title}
            description={body}
            actions={
                <>
                    <Button
                        testID={`${testID}-cancel`}
                        variant="quiet"
                        label={t('platformAdmin:b2b.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID={`${testID}-confirm`}
                        label={confirmLabel}
                        loading={loading}
                        onPress={onConfirm}
                    />
                </>
            }
        >
            {children}
        </Dialog>
    );
}
