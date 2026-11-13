import type {
    ApiFailure,
    B2BAgreement,
    B2BApplicationSection,
    B2BApplicationSections,
    KycRejectionReason,
    PlatformB2bApplication,
    PlatformKycDocument,
} from '@healthy360/api-client/contracts';
import {
    apiFailure,
    B2B_APPLICATION_SECTIONS,
    KYC_REJECTION_REASONS,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Checkbox,
    Dialog,
    ErrorState,
    Heading,
    Inline,
    RecordSkeleton,
    Select,
    Stack,
    StepProgress,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

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
import { PLATFORM_B2B_HREF, platformB2bApplicationHref } from '../platform-admin-chrome.tsx';

/**
 * `/platform-admin/b2b/{application}` — one application, from claim to provisioning.
 *
 * ## One next move, stated
 *
 * The card at the top names the single move the state allows and, beside it, who the application
 * is waiting on when it is not the reviewer. `nextReviewStep` (in `../b2b-review.ts`) is the table;
 * each control is also gated on the permission its route demands, so a reviewer who may read the
 * queue but not decide sees the state and not the button.
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

const REVIEW = 'b2b_application.review_platform';
const DECIDE = 'b2b_application.decide_platform';
const PROVISION = 'b2b_application.provision_platform';
const KYC_VIEW = 'kyc_document.view_platform';

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

function ApplicationFile() {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();
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

    if (loadFailure !== null || record === undefined) {
        return (
            <Stack space="md" testID="platform-b2b-application-error-screen">
                <BackButton />
                <ErrorState
                    testID="platform-b2b-application-error"
                    failure={loadFailure ?? apiFailure('resource.not_found')}
                    title={t('platformAdmin:b2b.detail.errorTitle')}
                    onRetry={() => {
                        void application.refetch();
                    }}
                    retrying={application.isFetching}
                />
            </Stack>
        );
    }

    const step = nextReviewStep(record, versions);
    const stage = reviewStage(record, versions);
    const stageIndex = stage === null ? -1 : REVIEW_STAGES.indexOf(stage);
    const company = record.legalName ?? record.tradingName ?? t('platformAdmin:b2b.unnamed');
    const unacceptedRequired =
        record.documents.filter(
            (document) =>
                REQUIRED_KINDS.has(document.kind) &&
                document.reviewStatus !== 'accepted' &&
                document.reviewStatus !== 'superseded',
        ).length + record.missingDocumentKinds.length;

    return (
        <Stack space="lg" testID="platform-b2b-application-screen">
            <BackButton />

            <Stack space="xs">
                <Inline space="sm" align="center" wrap>
                    <Heading level={1} testID="platform-b2b-application-title">
                        {company}
                    </Heading>
                    <Badge
                        testID="platform-b2b-application-status"
                        tone={applicationStatusTone(record.status)}
                        label={t(applicationStatusKey(record.status))}
                    />
                </Inline>
                <Text tone="secondary">
                    {t('platformAdmin:b2b.detail.reference', { reference: record.reference })}
                </Text>
            </Stack>

            {stageIndex >= 0 ? (
                <StepProgress
                    testID="platform-b2b-application-stages"
                    label={t('platformAdmin:b2b.stages.label')}
                    steps={REVIEW_STAGES.map((key) => ({
                        key,
                        label: t(`platformAdmin:b2b.stages.${key}`),
                    }))}
                    current={stageIndex}
                    completed={
                        new Set(
                            REVIEW_STAGES.map((_, index) => index).filter(
                                (index) => index < stageIndex || stage === 'provisioned',
                            ),
                        )
                    }
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

            <NextStepCard
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
                    title={t('platformAdmin:b2b.detail.duplicatesTitle', {
                        count: record.duplicateApplications.length,
                    })}
                    body={t('platformAdmin:b2b.detail.duplicatesBody')}
                    actions={
                        <Inline space="sm" wrap>
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
                        </Inline>
                    }
                />
            )}

            <DecisionCard application={record} />

            <AgreementCard agreements={versions} />

            {record.provisionedOrganisationId === null ? null : (
                <InvitationsCard applicationId={record.id} canResend={canProvision} />
            )}

            <SectionsCard sections={record.sections} />

            <ContactsCard application={record} />

            <LocationsCard application={record} />

            <DocumentsCard application={record} />

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
                <Stack space="xs" testID="platform-b2b-provision-consequences">
                    <Text>{t('platformAdmin:b2b.provision.organisation', { company })}</Text>
                    <Text>{t('platformAdmin:b2b.provision.account')}</Text>
                    <Text>{t('platformAdmin:b2b.provision.owner')}</Text>
                    <Text>{t('platformAdmin:b2b.provision.invitations')}</Text>
                </Stack>
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
        </Stack>
    );
}

/** The kinds the server requires today. Shown as a warning on approval, never enforced here. */
const REQUIRED_KINDS = new Set(['commercial_registration', 'signatory_identification']);

function BackButton() {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <Button
            testID="platform-b2b-application-back"
            variant="ghost"
            label={t('platformAdmin:b2b.detail.back')}
            onPress={() => {
                router.push(PLATFORM_B2B_HREF as never);
            }}
        />
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

function NextStepCard({
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

    let actions: ReactNode;

    switch (step.kind) {
        case 'claim':
            actions = canReview ? (
                <Button
                    testID="platform-b2b-claim"
                    label={t('platformAdmin:b2b.actions.claim')}
                    loading={claiming}
                    onPress={onClaim}
                />
            ) : null;
            break;
        case 'decide':
            actions = (
                <Inline space="sm" wrap>
                    {canDecide ? (
                        <Button
                            testID="platform-b2b-approve"
                            label={t('platformAdmin:b2b.actions.approve')}
                            onPress={() => {
                                onOpen('approve');
                            }}
                        />
                    ) : null}
                    {canReview ? (
                        <Button
                            testID="platform-b2b-request-information"
                            variant="secondary"
                            label={t('platformAdmin:b2b.actions.requestInformation')}
                            onPress={() => {
                                onOpen('request-information');
                            }}
                        />
                    ) : null}
                    {canDecide ? (
                        <Button
                            testID="platform-b2b-decline"
                            variant="danger"
                            label={t('platformAdmin:b2b.actions.decline')}
                            onPress={() => {
                                onOpen('decline');
                            }}
                        />
                    ) : null}
                </Inline>
            );
            break;
        case 'waiting_applicant':
            actions = canDecide ? (
                <Button
                    testID="platform-b2b-decline"
                    variant="danger"
                    label={t('platformAdmin:b2b.actions.decline')}
                    onPress={() => {
                        onOpen('decline');
                    }}
                />
            ) : null;
            break;
        case 'draft_agreement':
            actions = canDecide ? (
                <Button
                    testID="platform-b2b-draft-agreement"
                    label={t('platformAdmin:b2b.actions.draftAgreement')}
                    onPress={() => {
                        onEditAgreement('new');
                    }}
                />
            ) : null;
            break;
        case 'send_agreement':
            actions = canDecide ? (
                <Inline space="sm" wrap>
                    <Button
                        testID="platform-b2b-send-agreement"
                        label={t('platformAdmin:b2b.agreement.send')}
                        onPress={() => {
                            onOpen('send');
                        }}
                    />
                    <Button
                        testID="platform-b2b-edit-agreement"
                        variant="secondary"
                        label={t('platformAdmin:b2b.agreement.edit')}
                        onPress={() => {
                            onEditAgreement(step.agreement);
                        }}
                    />
                </Inline>
            ) : null;
            break;
        case 'waiting_signature':
            actions = canDecide ? (
                <Button
                    testID="platform-b2b-revise-agreement"
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
                    label={t('platformAdmin:b2b.provision.confirm')}
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
        <Card padding="md" testID="platform-b2b-next-step">
            <Stack space="sm">
                <Text variant="bodyStrong" testID="platform-b2b-next-step-title">
                    {t(`platformAdmin:b2b.next.${step.kind}.title`)}
                </Text>
                <Text tone="secondary">{t(`platformAdmin:b2b.next.${step.kind}.body`)}</Text>
                {actions}
            </Stack>
        </Card>
    );
}

function DecisionCard({ application }: { readonly application: PlatformB2bApplication }) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const rows: readonly [string, string | null][] = [
        [
            t('platformAdmin:b2b.decision.submitted'),
            application.submittedAt === null ? null : formatter.formatDate(application.submittedAt),
        ],
        [
            t('platformAdmin:b2b.decision.decided'),
            application.decidedAt === null ? null : formatter.formatDate(application.decidedAt),
        ],
        [t('platformAdmin:b2b.decision.informationRequest'), application.informationRequest],
        [t('platformAdmin:b2b.decision.applicantMessage'), application.applicantMessage],
        [t('platformAdmin:b2b.decision.internalNote'), application.decisionNote],
    ];

    return (
        <Card padding="md" testID="platform-b2b-decision">
            <Stack space="sm">
                <Heading level={2}>{t('platformAdmin:b2b.decision.title')}</Heading>
                <FieldRows rows={rows} />
            </Stack>
        </Card>
    );
}

function AgreementCard({ agreements }: { readonly agreements: readonly B2BAgreement[] }) {
    const { t, i18n } = useTranslation();
    const formatter = useFormatter();

    return (
        <Card padding="md" testID="platform-b2b-agreement">
            <Stack space="sm">
                <Heading level={2}>{t('platformAdmin:b2b.agreement.title')}</Heading>
                {agreements.length === 0 ? (
                    <Text tone="secondary">{t('platformAdmin:b2b.agreement.none')}</Text>
                ) : (
                    agreements.map((agreement) => {
                        const money = (minor: number | null) =>
                            minor === null || agreement.terms.currencyCode === null
                                ? null
                                : formatter.formatCurrency(
                                      minor / 100,
                                      agreement.terms.currencyCode,
                                  );
                        const seller =
                            agreement.seller === null
                                ? null
                                : `${agreement.seller.organisationName} — ${
                                      i18n.language === 'ar' &&
                                      agreement.seller.priceListNameAr !== null
                                          ? agreement.seller.priceListNameAr
                                          : agreement.seller.priceListNameEn
                                  }`;

                        return (
                            <Stack
                                key={agreement.id}
                                space="xs"
                                testID={`platform-b2b-agreement-${agreement.version}`}
                            >
                                <Inline space="sm" align="center" wrap>
                                    <Text variant="bodyStrong">
                                        {t('platformAdmin:b2b.agreement.version', {
                                            version: agreement.version,
                                            title: agreement.title,
                                        })}
                                    </Text>
                                    <Badge
                                        testID={`platform-b2b-agreement-${agreement.version}-status`}
                                        tone={
                                            agreement.status === 'active'
                                                ? 'success'
                                                : agreement.status === 'terminated'
                                                  ? 'neutral'
                                                  : 'info'
                                        }
                                        label={t(
                                            `platformAdmin:b2b.agreementStatus.${agreement.status}`,
                                        )}
                                    />
                                </Inline>
                                <FieldRows
                                    rows={[
                                        [t('platformAdmin:b2b.agreement.seller'), seller],
                                        [
                                            t('platformAdmin:b2b.agreement.paymentTerms'),
                                            agreement.terms.paymentTerms === null
                                                ? null
                                                : t(
                                                      `b2bApplication:paymentTerms.${agreement.terms.paymentTerms}`,
                                                  ),
                                        ],
                                        [
                                            t('platformAdmin:b2b.agreement.creditLimit'),
                                            money(agreement.terms.creditLimitMinor),
                                        ],
                                        [
                                            t('platformAdmin:b2b.agreement.minimumOrder'),
                                            money(agreement.terms.minimumOrderMinor),
                                        ],
                                        [
                                            t('platformAdmin:b2b.agreement.signedBy'),
                                            agreement.signature === null
                                                ? null
                                                : `${agreement.signature.typedName}, ${agreement.signature.signatoryTitle}`,
                                        ],
                                    ]}
                                />
                            </Stack>
                        );
                    })
                )}
            </Stack>
        </Card>
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

    return (
        <Card padding="md" testID="platform-b2b-invitations">
            <Stack space="sm">
                <Heading level={2}>{t('platformAdmin:b2b.invitations.title')}</Heading>
                <Text tone="secondary">{t('platformAdmin:b2b.invitations.body')}</Text>
                {(invitations.data ?? []).length === 0 ? (
                    <Text tone="secondary">{t('platformAdmin:b2b.invitations.none')}</Text>
                ) : (
                    (invitations.data ?? []).map((invitation) => (
                        <Inline key={invitation.id} space="sm" align="center" wrap>
                            <Text testID={`platform-b2b-invitation-${invitation.id}`}>
                                {invitation.email}
                            </Text>
                            <Badge
                                tone={
                                    invitation.status === 'accepted'
                                        ? 'success'
                                        : invitation.status === 'live'
                                          ? 'info'
                                          : 'neutral'
                                }
                                label={t(
                                    `platformAdmin:b2b.invitations.status.${invitation.status}`,
                                )}
                            />
                            {canResend &&
                            (invitation.status === 'live' || invitation.status === 'expired') ? (
                                <Button
                                    testID={`platform-b2b-invitation-${invitation.id}-resend`}
                                    size="sm"
                                    variant="secondary"
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
                                                            {
                                                                email: invitation.email,
                                                            },
                                                        ),
                                                    });
                                                },
                                            },
                                        );
                                    }}
                                />
                            ) : null}
                        </Inline>
                    ))
                )}
            </Stack>
        </Card>
    );
}

const SECTION_VOCABULARY: Readonly<Record<string, string>> = {
    businessType: 'businessTypes',
    requestedPaymentTerms: 'paymentTerms',
    expectedVolumeBand: 'volumeBands',
    expectedOrderFrequency: 'orderFrequencies',
    preferredDeliveryWindow: 'deliveryWindows',
};

function SectionsCard({ sections }: { readonly sections: B2BApplicationSections }) {
    const { t } = useTranslation();
    const formatter = useFormatter();

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

    return (
        <Card padding="md" testID="platform-b2b-sections">
            <Stack space="lg">
                {B2B_APPLICATION_SECTIONS.map((section) => (
                    <Stack key={section} space="sm" testID={`platform-b2b-section-${section}`}>
                        <Heading level={2}>{t(`b2bApplication:sections.${section}.title`)}</Heading>
                        <FieldRows
                            rows={Object.entries(sections[section]).map(([key, value]) => [
                                t(`b2bApplication:fields.${key}`),
                                display(key, value),
                            ])}
                        />
                    </Stack>
                ))}
            </Stack>
        </Card>
    );
}

function ContactsCard({ application }: { readonly application: PlatformB2bApplication }) {
    const { t } = useTranslation();

    return (
        <Card padding="md" testID="platform-b2b-contacts">
            <Stack space="sm">
                <Heading level={2}>{t('platformAdmin:b2b.contacts.title')}</Heading>
                {application.contacts.length === 0 ? (
                    <Text tone="secondary">{t('platformAdmin:b2b.contacts.none')}</Text>
                ) : (
                    application.contacts.map((contact, index) => (
                        <Stack key={`${contact.role}-${String(index)}`} space="none">
                            <Inline space="sm" align="center" wrap>
                                <Text variant="bodyStrong">{contact.name}</Text>
                                <Badge
                                    tone="neutral"
                                    label={t(`platformAdmin:b2b.contacts.roles.${contact.role}`)}
                                />
                            </Inline>
                            <Text tone="secondary">
                                {[contact.title, contact.email, contact.phone]
                                    .filter((part) => part !== null)
                                    .join(' · ')}
                            </Text>
                        </Stack>
                    ))
                )}
            </Stack>
        </Card>
    );
}

function LocationsCard({ application }: { readonly application: PlatformB2bApplication }) {
    const { t } = useTranslation();

    return (
        <Card padding="md" testID="platform-b2b-locations">
            <Stack space="sm">
                <Heading level={2}>{t('platformAdmin:b2b.locations.title')}</Heading>
                {application.locations.length === 0 ? (
                    <Text tone="secondary">{t('platformAdmin:b2b.locations.none')}</Text>
                ) : (
                    application.locations.map((location, index) => (
                        <Stack key={`${location.label}-${String(index)}`} space="none">
                            <Inline space="sm" align="center" wrap>
                                <Text variant="bodyStrong">{location.label}</Text>
                                {location.isPrimary ? (
                                    <Badge
                                        tone="info"
                                        label={t('platformAdmin:b2b.locations.primary')}
                                    />
                                ) : null}
                                {location.isBillingAddress ? (
                                    <Badge
                                        tone="neutral"
                                        label={t('platformAdmin:b2b.locations.billing')}
                                    />
                                ) : null}
                            </Inline>
                            <Text tone="secondary">
                                {[
                                    location.addressLine1,
                                    location.addressLine2,
                                    location.city,
                                    location.countryCode,
                                ]
                                    .filter((part) => part !== null && part !== '')
                                    .join(', ')}
                            </Text>
                        </Stack>
                    ))
                )}
            </Stack>
        </Card>
    );
}

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

    return (
        <Card padding="md" testID="platform-b2b-documents">
            <Stack space="sm">
                <Heading level={2}>{t('b2bApplication:documents.title')}</Heading>

                {application.missingDocumentKinds.length === 0 ? null : (
                    <Callout
                        testID="platform-b2b-documents-missing"
                        tone="warning"
                        title={t('platformAdmin:b2b.documents.missing', {
                            kinds: application.missingDocumentKinds
                                .map((kind) => t(`b2bApplication:documents.kinds.${kind}`))
                                .join(', '),
                        })}
                    />
                )}

                {failure === null ? null : (
                    <Callout
                        testID="platform-b2b-documents-error"
                        role="alert"
                        tone="danger"
                        title={failure.message}
                    />
                )}

                {current.length === 0 ? (
                    <Text tone="secondary">{t('platformAdmin:b2b.documents.none')}</Text>
                ) : (
                    current.map((document) => (
                        <Stack
                            key={document.id}
                            space="xs"
                            testID={`platform-b2b-document-${document.id}`}
                        >
                            <Inline space="sm" align="center" wrap>
                                <Text variant="bodyStrong">
                                    {t(`b2bApplication:documents.kinds.${document.kind}`)}
                                </Text>
                                <Badge
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
                                    <Badge
                                        tone="warning"
                                        icon="warning"
                                        label={t('platformAdmin:b2b.documents.mismatch')}
                                    />
                                ) : null}
                                {document.hasExpired ? (
                                    <Badge
                                        tone="warning"
                                        label={t('platformAdmin:b2b.documents.expired')}
                                    />
                                ) : null}
                            </Inline>
                            <Text tone="secondary">{document.fileName}</Text>
                            <Inline space="sm" wrap>
                                {canView ? (
                                    <Button
                                        testID={`platform-b2b-document-${document.id}-view`}
                                        size="sm"
                                        variant="secondary"
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
                                            testID={`platform-b2b-document-${document.id}-accept`}
                                            size="sm"
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
                                        <Button
                                            testID={`platform-b2b-document-${document.id}-reject`}
                                            size="sm"
                                            variant="danger"
                                            label={t('platformAdmin:b2b.documents.reject')}
                                            onPress={() => {
                                                setRejecting(document);
                                                setReason(null);
                                                setNote('');
                                            }}
                                        />
                                    </>
                                ) : null}
                            </Inline>
                        </Stack>
                    ))
                )}
            </Stack>

            <Dialog
                testID="platform-b2b-reject-dialog"
                open={rejecting !== null}
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
                <Stack space="sm">
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
                        label={t('platformAdmin:b2b.documents.note')}
                        value={note}
                        onChangeText={setNote}
                        multiline
                    />
                </Stack>
            </Dialog>
        </Card>
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
            <Stack space="sm">
                {failure === null ? null : (
                    <Callout role="alert" tone="danger" title={failure.message} />
                )}
                <TextInputField
                    testID="platform-b2b-request-message"
                    label={t('platformAdmin:b2b.request.message')}
                    hint={t('platformAdmin:b2b.request.messageHint')}
                    value={message}
                    onChangeText={setMessage}
                    multiline
                    required
                />
                <Text variant="bodyStrong">{t('platformAdmin:b2b.request.sections')}</Text>
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
            </Stack>
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
            <Stack space="sm">
                {unacceptedRequired === 0 ? null : (
                    <Callout
                        testID="platform-b2b-approve-documents-warning"
                        tone="warning"
                        title={t('platformAdmin:b2b.approve.documentsWarning', {
                            count: unacceptedRequired,
                        })}
                    />
                )}
                {failure === null ? null : (
                    <Callout role="alert" tone="danger" title={failure.message} />
                )}
                <TextInputField
                    testID="platform-b2b-approve-applicant-message"
                    label={t('platformAdmin:b2b.decision.applicantMessage')}
                    hint={t('platformAdmin:b2b.approve.applicantMessageHint')}
                    value={applicantMessage}
                    onChangeText={setApplicantMessage}
                    multiline
                />
                <TextInputField
                    testID="platform-b2b-approve-internal-note"
                    label={t('platformAdmin:b2b.decision.internalNote')}
                    hint={t('platformAdmin:b2b.internalNoteHint')}
                    value={internalNote}
                    onChangeText={setInternalNote}
                    multiline
                />
            </Stack>
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
            <Stack space="sm">
                {failure === null ? null : (
                    <Callout role="alert" tone="danger" title={failure.message} />
                )}
                <TextInputField
                    testID="platform-b2b-decline-applicant-message"
                    label={t('platformAdmin:b2b.decision.applicantMessage')}
                    hint={t('platformAdmin:b2b.decline.applicantMessageHint')}
                    value={applicantMessage}
                    onChangeText={setApplicantMessage}
                    multiline
                    required
                />
                <TextInputField
                    testID="platform-b2b-decline-internal-note"
                    label={t('platformAdmin:b2b.decision.internalNote')}
                    hint={t('platformAdmin:b2b.internalNoteHint')}
                    value={internalNote}
                    onChangeText={setInternalNote}
                    multiline
                />
            </Stack>
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

/** Label/value pairs; an empty value reads as a dash rather than vanishing. */
function FieldRows({ rows }: { readonly rows: readonly (readonly [string, string | null])[] }) {
    return (
        <Stack space="xs">
            {rows.map(([label, value]) => (
                <Inline key={label} space="sm" wrap>
                    <Text tone="secondary" className="min-w-40">
                        {label}
                    </Text>
                    <Text>{value ?? '—'}</Text>
                </Inline>
            ))}
        </Stack>
    );
}
