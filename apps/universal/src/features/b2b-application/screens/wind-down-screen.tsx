import {
    Badge,
    Button,
    Callout,
    Card,
    Checkbox,
    Heading,
    Inline,
    Stack,
    Table,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import type {
    B2BOffboarding,
    OffboardingStatus,
    OtpChallenge,
    SettlementCheck,
} from '@healthy360/api-client/contracts';
import { OFFBOARDING_STATUSES } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useIssueSignoffChallengeMutation,
    useOffboardingQuery,
    useRunSettlementChecksMutation,
    useSignOffOffboardingMutation,
} from '../../../data/b2b-application-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { OtpChallengePanel } from '../../verification/otp-challenge-panel.tsx';

/**
 * `/corporate/account/wind-down` — the end of a commercial relationship, from the buyer's side.
 *
 * ## Mostly a report, and deliberately so
 *
 * Nine states, and a corporate signatory acts in exactly two of them: they re-run the settlement
 * checks, and once those clear they sign off. Everything after that — revoking their colleagues'
 * access, archiving the records, purging the personal data — is the platform's, and **there is no
 * control here for any of it**. That is not an omission to be filled in later: a company must not be
 * able to revoke its own users from a self-service screen, because the sole-membership rule means
 * revocation can strip access a person holds through an entirely unrelated relationship. The
 * timeline shows those states happening; it never offers to cause them.
 *
 * ## The settlement table does not flatten `not_applicable`
 *
 * Three of the four checks answer `not_applicable` today, because there is no invoicing module and
 * therefore no outstanding invoices, no credit balance and no deposit to look at. Printing a tick
 * beside them would be telling a company its account is clear on the strength of code nobody has
 * written — and it would keep saying so, wrongly, on the day invoicing ships. Each carries the
 * server's reason string and the table prints it.
 *
 * ## The sign-off is the same claim as the agreement's signature
 *
 * A name typed, a title claimed, wording that was on screen, the digest of the notice that was
 * read, and a one-time code that proves who typed it. `authorityConfirmed` is a separate checkbox
 * rather than something inferred from the name, because "this is my name" and "I may bind this
 * company" are two statements and only the second matters in a dispute.
 */

const TEST_ID = 'wind-down';

export interface WindDownScreenProps {
    /** The organisation whose relationship is ending. From the active corporate context. */
    readonly organisationId: string | undefined;
}

export function WindDownScreen({ organisationId }: WindDownScreenProps) {
    const { t } = useTranslation();

    const query = useOffboardingQuery(organisationId ?? null);
    const offboarding = query.data ?? null;

    const runChecks = useRunSettlementChecksMutation();
    const issueChallenge = useIssueSignoffChallengeMutation();
    const signOff = useSignOffOffboardingMutation();

    const [typedName, setTypedName] = useState('');
    const [signatoryTitle, setSignatoryTitle] = useState('');
    const [authorityConfirmed, setAuthorityConfirmed] = useState(false);

    const challenge: OtpChallenge | null = issueChallenge.data ?? null;
    const failure =
        toFailure(runChecks.error) ?? toFailure(issueChallenge.error) ?? toFailure(signOff.error);

    return (
        <Stack space="lg" testID={`${TEST_ID}-screen`}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-title`}>
                    {t('b2bApplication:windDown.title')}
                </Heading>
                <Text tone="secondary">{t('b2bApplication:windDown.subtitle')}</Text>
            </Stack>

            <QueryStates
                query={query}
                isEmpty={offboarding === null}
                emptyTitle={t('b2bApplication:windDown.noneTitle')}
                emptyBody={t('b2bApplication:windDown.noneBody')}
                skeletonCount={2}
                testID={TEST_ID}
            >
                {offboarding === null ? null : (
                    <Stack space="lg">
                        <OffboardingSummary offboarding={offboarding} />

                        <OffboardingTimeline status={offboarding.status} />

                        <SettlementTable
                            checks={offboarding.settlement.checks}
                            status={offboarding.settlement.status}
                        />

                        {failure === null ? null : (
                            <Callout
                                testID={`${TEST_ID}-error`}
                                role="alert"
                                tone="danger"
                                icon="warning"
                                title={t('b2bApplication:windDown.failedTitle')}
                                body={failure.message}
                            />
                        )}

                        {/*
                         * Re-running the checks is available while the settlement is still open —
                         * `allowedTransitions` is the server's own table, so the control exists
                         * exactly when the server would accept it.
                         */}
                        {offboarding.allowedTransitions.includes('settlement_pending') ? (
                            <Inline space="sm" wrap>
                                <Button
                                    testID={`${TEST_ID}-run-checks`}
                                    label={t('b2bApplication:windDown.runChecks')}
                                    loading={runChecks.isPending}
                                    onPress={() => {
                                        runChecks.mutate({
                                            offboardingId: offboarding.id,
                                            lockVersion: offboarding.lockVersion,
                                        });
                                    }}
                                />
                                <Text tone="secondary" variant="caption">
                                    {t('b2bApplication:windDown.runChecksNote')}
                                </Text>
                            </Inline>
                        ) : null}

                        {offboarding.status === 'awaiting_signoff' ? (
                            <Card padding="md" testID={`${TEST_ID}-signoff`}>
                                <Stack space="md">
                                    <Text variant="label">
                                        {t('b2bApplication:windDown.signoffTitle')}
                                    </Text>

                                    {/* The exact wording the signature ties itself to. */}
                                    <Callout
                                        testID={`${TEST_ID}-consent`}
                                        role="note"
                                        tone="info"
                                        icon="info"
                                        title={t('b2bApplication:windDown.consentTitle')}
                                        body={offboarding.consentStatement}
                                    />

                                    <TextInputField
                                        testID={`${TEST_ID}-name`}
                                        label={t('b2bApplication:windDown.nameLabel')}
                                        value={typedName}
                                        onChangeText={setTypedName}
                                    />
                                    <TextInputField
                                        testID={`${TEST_ID}-role`}
                                        label={t('b2bApplication:windDown.titleLabel')}
                                        value={signatoryTitle}
                                        onChangeText={setSignatoryTitle}
                                    />
                                    <Checkbox
                                        testID={`${TEST_ID}-authority`}
                                        label={t('b2bApplication:windDown.authorityLabel')}
                                        checked={authorityConfirmed}
                                        onChange={setAuthorityConfirmed}
                                    />

                                    {challenge === null ? (
                                        <Button
                                            testID={`${TEST_ID}-request-code`}
                                            label={t('b2bApplication:windDown.requestCode')}
                                            loading={issueChallenge.isPending}
                                            disabled={
                                                typedName.trim().length === 0 ||
                                                signatoryTitle.trim().length === 0 ||
                                                !authorityConfirmed
                                            }
                                            onPress={() => {
                                                issueChallenge.mutate({
                                                    offboardingId: offboarding.id,
                                                });
                                            }}
                                        />
                                    ) : (
                                        <OtpChallengePanel
                                            testID={`${TEST_ID}-otp`}
                                            challenge={challenge}
                                            failure={toFailure(signOff.error)}
                                            fallbackMessage={t(
                                                'b2bApplication:windDown.signoffFailed',
                                            )}
                                            verifying={signOff.isPending}
                                            onVerify={(code) => {
                                                signOff.mutate({
                                                    offboardingId: offboarding.id,
                                                    typedName: typedName.trim(),
                                                    signatoryTitle: signatoryTitle.trim(),
                                                    authorityConfirmed,
                                                    documentSha256: offboarding.documentSha256,
                                                    // `challengeId:code` — the same convention the
                                                    // agreement signature uses. The panel hands
                                                    // back digits and stays ignorant of what a
                                                    // signature needs; pairing happens here.
                                                    verificationToken: `${challenge.id}:${code}`,
                                                    lockVersion: offboarding.lockVersion,
                                                });
                                            }}
                                            onResend={() => {
                                                issueChallenge.mutate({
                                                    offboardingId: offboarding.id,
                                                });
                                            }}
                                        />
                                    )}
                                </Stack>
                            </Card>
                        ) : (
                            <Callout
                                testID={`${TEST_ID}-read-only`}
                                role="note"
                                tone="info"
                                icon="info"
                                title={t('b2bApplication:windDown.readOnlyTitle')}
                                body={t(`b2bApplication:windDown.readOnly.${offboarding.status}`, {
                                    defaultValue: t('b2bApplication:windDown.readOnlyBody'),
                                })}
                            />
                        )}

                        {/*
                         * Said out loud rather than left to be inferred from an absence of buttons.
                         * A company reading this screen needs to know that the next steps happen,
                         * that they cannot start them, and that they cannot stop them either.
                         */}
                        <Text
                            tone="secondary"
                            variant="caption"
                            testID={`${TEST_ID}-platform-note`}
                        >
                            {t('b2bApplication:windDown.platformNote')}
                        </Text>
                    </Stack>
                )}
            </QueryStates>
        </Stack>
    );
}

interface SummaryProps {
    readonly offboarding: B2BOffboarding;
}

function OffboardingSummary({ offboarding }: SummaryProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Card padding="md" testID={`${TEST_ID}-summary`}>
            <Stack space="sm">
                <Inline space="sm" align="center" justify="between">
                    <Text variant="bodyStrong">
                        {t(`b2bApplication:windDown.triggers.${offboarding.trigger}`)}
                    </Text>
                    <Badge
                        tone={offboarding.status === 'cancelled' ? 'neutral' : 'warning'}
                        label={t(`b2bApplication:windDown.statuses.${offboarding.status}`)}
                        testID={`${TEST_ID}-status`}
                    />
                </Inline>

                <Text testID={`${TEST_ID}-effective`}>
                    {offboarding.effectiveOn === null
                        ? t('b2bApplication:windDown.noEffectiveDate')
                        : t('b2bApplication:windDown.effectiveOn', {
                              date: formatter.formatDate(offboarding.effectiveOn, {
                                  dateStyle: 'full',
                              }),
                          })}
                </Text>

                <Text tone="secondary" variant="caption" testID={`${TEST_ID}-notice`}>
                    {t('b2bApplication:windDown.noticePeriod', {
                        count: offboarding.noticePeriodDays,
                    })}
                </Text>

                {offboarding.reasonNote === null ? null : (
                    <Text tone="secondary" variant="caption" testID={`${TEST_ID}-reason`}>
                        {offboarding.reasonNote}
                    </Text>
                )}

                {offboarding.signoff.signedOffAt === null ? null : (
                    <Text tone="secondary" variant="caption" testID={`${TEST_ID}-signed`}>
                        {t('b2bApplication:windDown.signedBy', {
                            name: offboarding.signoff.signatoryName ?? '',
                            role: offboarding.signoff.signatoryTitle ?? '',
                            date: formatter.formatDate(offboarding.signoff.signedOffAt, {
                                dateStyle: 'medium',
                            }),
                        })}
                    </Text>
                )}
            </Stack>
        </Card>
    );
}

/** `cancelled` is not a stage of the timeline — it is where a wind-down goes instead of finishing. */
const TIMELINE_STATUSES: readonly OffboardingStatus[] = OFFBOARDING_STATUSES.filter(
    (status) => status !== 'cancelled',
);

interface TimelineProps {
    readonly status: OffboardingStatus;
}

function OffboardingTimeline({ status }: TimelineProps) {
    const { t } = useTranslation();
    const reached = TIMELINE_STATUSES.indexOf(status);

    return (
        <Stack space="sm" testID={`${TEST_ID}-timeline`}>
            <Text variant="label">{t('b2bApplication:windDown.timelineTitle')}</Text>

            {status === 'cancelled' ? (
                <Callout
                    testID={`${TEST_ID}-cancelled`}
                    role="status"
                    tone="info"
                    title={t('b2bApplication:windDown.statuses.cancelled')}
                    body={t('b2bApplication:windDown.cancelledBody')}
                />
            ) : (
                <Stack space="xs">
                    {TIMELINE_STATUSES.map((candidate, index) => (
                        <Inline
                            key={candidate}
                            space="sm"
                            align="center"
                            testID={`${TEST_ID}-timeline-${candidate}`}
                        >
                            <Badge
                                tone={
                                    index < reached
                                        ? 'success'
                                        : index === reached
                                          ? 'warning'
                                          : 'neutral'
                                }
                                icon="dot"
                                label={t(
                                    index < reached
                                        ? 'b2bApplication:windDown.stageDone'
                                        : index === reached
                                          ? 'b2bApplication:windDown.stageNow'
                                          : 'b2bApplication:windDown.stageAhead',
                                )}
                            />
                            <Text tone={index <= reached ? 'primary' : 'secondary'}>
                                {t(`b2bApplication:windDown.statuses.${candidate}`)}
                            </Text>
                        </Inline>
                    ))}
                </Stack>
            )}
        </Stack>
    );
}

interface SettlementTableProps {
    readonly checks: readonly SettlementCheck[];
    readonly status: B2BOffboarding['settlement']['status'];
}

function SettlementTable({ checks, status }: SettlementTableProps) {
    const { t } = useTranslation();

    const columns: readonly TableColumn<SettlementCheck>[] = [
        {
            key: 'check',
            header: t('b2bApplication:windDown.settlement.columns.check'),
            rowHeader: true,
            render: (row) => <Text>{t(`b2bApplication:windDown.checks.${row.check}`)}</Text>,
        },
        {
            key: 'outcome',
            header: t('b2bApplication:windDown.settlement.columns.outcome'),
            render: (row) => (
                <Badge
                    tone={
                        row.outcome === 'clear'
                            ? 'success'
                            : row.outcome === 'outstanding'
                              ? 'danger'
                              : 'neutral'
                    }
                    label={t(`b2bApplication:windDown.outcomes.${row.outcome}`)}
                    testID={`${TEST_ID}-check-${row.check}`}
                />
            ),
        },
        {
            key: 'reason',
            header: t('b2bApplication:windDown.settlement.columns.reason'),
            // The sentence that stops a neutral badge reading as a pass.
            render: (row) => (
                <Text tone="secondary" variant="caption">
                    {row.reason === null
                        ? (row.detail ?? '')
                        : t(`b2bApplication:windDown.reasons.${row.reason}`, {
                              defaultValue: row.reason,
                          })}
                </Text>
            ),
        },
    ];

    return (
        <Stack space="sm" testID={`${TEST_ID}-settlement`}>
            <Inline space="sm" align="center" justify="between">
                <Text variant="label">{t('b2bApplication:windDown.settlement.title')}</Text>
                <Badge
                    tone={status === 'pending' ? 'warning' : 'success'}
                    label={t(`b2bApplication:windDown.settlementStatuses.${status}`)}
                    testID={`${TEST_ID}-settlement-status`}
                />
            </Inline>

            {checks.length === 0 ? (
                <Text tone="secondary" testID={`${TEST_ID}-settlement-empty`}>
                    {t('b2bApplication:windDown.settlement.notRun')}
                </Text>
            ) : (
                <Table
                    testID={`${TEST_ID}-settlement-table`}
                    caption={t('b2bApplication:windDown.settlement.caption')}
                    captionHidden
                    columns={columns}
                    rows={[...checks]}
                    rowKey={(row) => row.check}
                />
            )}
        </Stack>
    );
}
