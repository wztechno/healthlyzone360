import {
    Badge,
    Button,
    Callout,
    Card,
    Checkbox,
    Heading,
    Inline,
    Select,
    SegmentedControl,
    Stack,
    Stepper,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type {
    ClosureBlocker,
    ClosureReasonCode,
    ClosureScope,
    ClosureTicket,
} from '@healthy360/api-client/contracts';
import { CLOSURE_REASON_CODES } from '@healthy360/api-client/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useClosurePreconditionsQuery,
    useLiveClosureRequestQuery,
    useRequestClosureMutation,
    useVerifyClosureMutation,
} from '../../../data/account-hooks.ts';
import { OtpChallengePanel } from '../../verification/otp-challenge-panel.tsx';

/**
 * `/customer/account/close/{step}` — leaving, in four steps and one short-circuit.
 *
 * ## The short-circuit is the point of step two
 *
 * Most people who reach a closure screen want the marketing emails to stop. Closing an account to
 * achieve that costs them their order history, their saved addresses and their allergy declaration —
 * a far worse outcome for them than for the business. So the scope step offers "stop the marketing"
 * first, it **completes immediately** when chosen, and it needs no one-time code because nothing is
 * destroyed. Burying that option, or presenting it as a lesser version of closure, would be a dark
 * pattern in the other direction.
 *
 * ## The checks step renders four statuses, and does not flatten them
 *
 * `blocking` stops closure. `advisory` does not, and is acknowledged rather than resolved — an
 * unsettled credit memo is worth knowing about precisely because after closure there is no account
 * to settle it against. `not_applicable` means the check did not run: there is no wallet module and
 * no payment module, and printing a tick beside "wallet balance" would be claiming a balance was
 * checked by code nobody has written. `clear` is the only tick.
 *
 * A screen that collapsed the four into "ready / not ready" would be a screen that starts lying the
 * day payments ship, and it would lie quietly.
 *
 * ## The verdict is the server's
 *
 * `canClose` comes from the server and is never recomputed from the blocker list. The wizard also
 * **re-reads** the preconditions on every step rather than carrying step three's answer forward: a
 * subscription created in another tab between the checks and the code is exactly the case the
 * registry exists to catch, and `verifyClosure` re-checks again on the server for the same reason.
 */

export const CLOSURE_STEPS = ['reason', 'scope', 'checks', 'verify', 'done'] as const;
export type ClosureStep = (typeof CLOSURE_STEPS)[number];

export function isClosureStep(value: string | undefined): value is ClosureStep {
    return value !== undefined && (CLOSURE_STEPS as readonly string[]).includes(value);
}

const TEST_ID = 'closure';

export interface ClosureWizardScreenProps {
    readonly step: string | undefined;
}

/** `other` is the only reason that invites free text — the backend's `invitesNote()`, mirrored. */
const NOTE_REASONS: ReadonlySet<ClosureReasonCode> = new Set<ClosureReasonCode>(['other']);

export function ClosureWizardScreen({ step }: ClosureWizardScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();

    const current: ClosureStep = isClosureStep(step) ? step : 'reason';

    const [reasonCode, setReasonCode] = useState<ClosureReasonCode | null>(null);
    const [reasonNote, setReasonNote] = useState('');
    const [scope, setScope] = useState<ClosureScope>('marketing_opt_out');
    const [acknowledged, setAcknowledged] = useState(false);

    // Re-read on every step. A snapshot taken at step three is a snapshot that can be wrong by
    // step four, and being wrong here means closing over a live subscription.
    const preconditions = useClosurePreconditionsQuery();
    const live = useLiveClosureRequestQuery();

    const request = useRequestClosureMutation();
    const verify = useVerifyClosureMutation();

    /** The ticket in hand: whatever the last write produced, else whatever is already in flight. */
    const ticket: ClosureTicket | null = request.data ?? verify.data ?? live.data ?? null;
    const failure = toFailure(request.error) ?? toFailure(verify.error);

    const go = (next: ClosureStep) => {
        router.push(`/customer/account/close/${next}` as never);
    };

    const blockers = preconditions.data?.blockers ?? [];
    const blocking = blockers.filter((blocker) => blocker.status === 'blocking');
    const advisories = blockers.filter((blocker) => blocker.status === 'advisory');
    const canClose = preconditions.data?.canClose ?? false;

    return (
        <Stack space="lg" testID={`${TEST_ID}-screen`}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-title`}>
                    {t('account:closure.title')}
                </Heading>
                <Text tone="secondary">{t('account:closure.subtitle')}</Text>
            </Stack>

            <Stepper
                testID={`${TEST_ID}-stepper`}
                label={t('account:closure.stepperLabel')}
                current={CLOSURE_STEPS.indexOf(current) + 1}
                total={CLOSURE_STEPS.length}
                stepLabel={t(`account:closure.steps.${current}`)}
            />

            {failure === null ? null : (
                <Callout
                    testID={`${TEST_ID}-error`}
                    role="alert"
                    tone="danger"
                    icon="warning"
                    title={t('account:closure.failedTitle')}
                    body={failure.message}
                />
            )}

            {/* ── 1. why ─────────────────────────────────────────────────────────────────────── */}
            {current === 'reason' ? (
                <Card padding="md" testID={`${TEST_ID}-reason`}>
                    <Stack space="md">
                        <Select
                            testID={`${TEST_ID}-reason-select`}
                            label={t('account:closure.reasonLabel')}
                            hint={t('account:closure.reasonHint')}
                            value={reasonCode}
                            onChange={(next) => {
                                setReasonCode(next as ClosureReasonCode);
                            }}
                            options={CLOSURE_REASON_CODES.map((code) => ({
                                value: code,
                                label: t(`account:closure.reasons.${code}`),
                            }))}
                        />

                        {/* Only `other` invites a note — the backend's own rule, not a guess. */}
                        {reasonCode !== null && NOTE_REASONS.has(reasonCode) ? (
                            <TextInputField
                                testID={`${TEST_ID}-reason-note`}
                                label={t('account:closure.noteLabel')}
                                hint={t('account:closure.noteHint')}
                                value={reasonNote}
                                onChangeText={setReasonNote}
                                multiline
                            />
                        ) : null}

                        <Button
                            testID={`${TEST_ID}-reason-next`}
                            label={t('account:closure.next')}
                            disabled={reasonCode === null}
                            onPress={() => {
                                go('scope');
                            }}
                        />
                    </Stack>
                </Card>
            ) : null}

            {/* ── 2. how far ─────────────────────────────────────────────────────────────────── */}
            {current === 'scope' ? (
                <Card padding="md" testID={`${TEST_ID}-scope`}>
                    <Stack space="md">
                        <SegmentedControl
                            testID={`${TEST_ID}-scope-picker`}
                            label={t('account:closure.scopeLabel')}
                            block
                            value={scope}
                            onChange={(next) => {
                                setScope(next as ClosureScope);
                            }}
                            items={[
                                {
                                    value: 'marketing_opt_out',
                                    label: t('account:closure.scopes.marketing_opt_out'),
                                    testID: `${TEST_ID}-scope-marketing`,
                                },
                                {
                                    value: 'full',
                                    label: t('account:closure.scopes.full'),
                                    testID: `${TEST_ID}-scope-full`,
                                },
                            ]}
                        />

                        <Callout
                            testID={`${TEST_ID}-scope-explainer`}
                            role="note"
                            tone={scope === 'full' ? 'warning' : 'info'}
                            icon={scope === 'full' ? 'warning' : 'info'}
                            title={t(`account:closure.scopeExplainer.${scope}.title`)}
                            body={t(`account:closure.scopeExplainer.${scope}.body`)}
                        />

                        <Button
                            testID={`${TEST_ID}-scope-next`}
                            label={
                                scope === 'marketing_opt_out'
                                    ? t('account:closure.optOutConfirm')
                                    : t('account:closure.next')
                            }
                            loading={request.isPending}
                            onPress={() => {
                                if (reasonCode === null) return;
                                if (scope === 'full') {
                                    go('checks');
                                    return;
                                }
                                // The short-circuit. It completes in one write: nothing is
                                // destroyed, so there is nothing to step up for.
                                request.mutate(
                                    {
                                        reasonCode,
                                        scope: 'marketing_opt_out',
                                        ...(reasonNote.trim().length === 0
                                            ? {}
                                            : { reasonNote: reasonNote.trim() }),
                                    },
                                    {
                                        onSuccess: () => {
                                            go('done');
                                        },
                                    },
                                );
                            }}
                        />
                    </Stack>
                </Card>
            ) : null}

            {/* ── 3. what is in the way ──────────────────────────────────────────────────────── */}
            {current === 'checks' ? (
                <Stack space="md" testID={`${TEST_ID}-checks`}>
                    <BlockerList blockers={blockers} />

                    <RetainedRecords codes={preconditions.data?.retainedRecordCodes ?? []} />

                    {advisories.length === 0 ? null : (
                        <Checkbox
                            testID={`${TEST_ID}-acknowledge`}
                            label={t('account:closure.acknowledge', {
                                count: advisories.length,
                            })}
                            checked={acknowledged}
                            onChange={setAcknowledged}
                        />
                    )}

                    {blocking.length === 0 ? null : (
                        <Callout
                            testID={`${TEST_ID}-blocked`}
                            role="alert"
                            tone="danger"
                            icon="warning"
                            title={t('account:closure.blockedTitle', { count: blocking.length })}
                            body={t('account:closure.blockedBody')}
                        />
                    )}

                    <Inline space="sm" wrap>
                        <Button
                            testID={`${TEST_ID}-checks-next`}
                            label={t('account:closure.startClosure')}
                            loading={request.isPending}
                            // The server's verdict, plus the acknowledgement this screen owns.
                            disabled={!canClose || (advisories.length > 0 && !acknowledged)}
                            onPress={() => {
                                if (reasonCode === null) return;
                                request.mutate(
                                    {
                                        reasonCode,
                                        scope: 'full',
                                        ...(reasonNote.trim().length === 0
                                            ? {}
                                            : { reasonNote: reasonNote.trim() }),
                                    },
                                    {
                                        onSuccess: (created) => {
                                            go(created.blocked ? 'checks' : 'verify');
                                        },
                                    },
                                );
                            }}
                        />
                        <Button
                            testID={`${TEST_ID}-checks-back`}
                            variant="ghost"
                            label={t('account:closure.back')}
                            onPress={() => {
                                go('scope');
                            }}
                        />
                    </Inline>
                </Stack>
            ) : null}

            {/* ── 4. the code ────────────────────────────────────────────────────────────────── */}
            {current === 'verify' ? (
                <Card padding="md" testID={`${TEST_ID}-verify`}>
                    <Stack space="md">
                        <Callout
                            testID={`${TEST_ID}-irreversible`}
                            role="alert"
                            tone="danger"
                            icon="warning"
                            title={t('account:closure.irreversibleTitle')}
                            body={t('account:closure.irreversibleBody')}
                        />

                        {ticket?.challenge == null ? (
                            <Text tone="secondary" testID={`${TEST_ID}-no-challenge`}>
                                {t('account:closure.noChallenge')}
                            </Text>
                        ) : (
                            <OtpChallengePanel
                                testID={`${TEST_ID}-otp`}
                                challenge={ticket.challenge}
                                failure={toFailure(verify.error)}
                                fallbackMessage={t('account:closure.verifyFailed')}
                                verifying={verify.isPending}
                                onVerify={(code) => {
                                    verify.mutate(
                                        { ticketId: ticket.id, code },
                                        {
                                            onSuccess: (result) => {
                                                // A closure that became blocked between the request
                                                // and the code goes back to the checks, not forward.
                                                go(result.blocked ? 'checks' : 'done');
                                            },
                                        },
                                    );
                                }}
                                // Resending is `VerificationRepository`'s, and a closure challenge
                                // is bound to the request rather than to a contact the account
                                // screens own. Rather than wire a control that would resend the
                                // wrong thing, the panel's resend is a no-op here and the copy
                                // above tells somebody to start again. Recorded as deferred.
                                onResend={() => undefined}
                            />
                        )}
                    </Stack>
                </Card>
            ) : null}

            {/* ── 5. done ────────────────────────────────────────────────────────────────────── */}
            {current === 'done' ? (
                <Stack space="md" testID={`${TEST_ID}-done`}>
                    <Callout
                        testID={`${TEST_ID}-done-callout`}
                        role="status"
                        tone="success"
                        title={t(
                            ticket?.scope === 'marketing_opt_out'
                                ? 'account:closure.optOutDoneTitle'
                                : 'account:closure.closedTitle',
                        )}
                        body={t(
                            ticket?.scope === 'marketing_opt_out'
                                ? 'account:closure.optOutDoneBody'
                                : 'account:closure.closedBody',
                        )}
                    />

                    {ticket?.scope === 'full' ? (
                        <Text tone="secondary" variant="caption" testID={`${TEST_ID}-signed-out`}>
                            {t('account:closure.signedOutNote')}
                        </Text>
                    ) : null}

                    <Button
                        testID={`${TEST_ID}-done-home`}
                        label={t('account:closure.finish')}
                        onPress={() => {
                            router.push('/' as never);
                        }}
                    />
                </Stack>
            ) : null}
        </Stack>
    );
}

/** Four statuses, four tones, and no collapsing. */
const BLOCKER_TONE: Readonly<
    Record<ClosureBlocker['status'], 'danger' | 'success' | 'warning' | 'neutral'>
> = {
    blocking: 'danger',
    clear: 'success',
    advisory: 'warning',
    not_applicable: 'neutral',
};

interface BlockerListProps {
    readonly blockers: readonly ClosureBlocker[];
}

function BlockerList({ blockers }: BlockerListProps) {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <Stack space="sm" testID={`${TEST_ID}-blockers`}>
            <Text variant="label">{t('account:closure.checksTitle')}</Text>

            {blockers.map((blocker) => (
                <Card key={blocker.code} padding="sm" testID={`${TEST_ID}-blocker-${blocker.code}`}>
                    <Stack space="xs">
                        <Inline space="sm" align="center" justify="between">
                            <Text variant="bodyStrong">
                                {t(`account:closure.blockers.${blocker.code}`)}
                            </Text>
                            <Badge
                                tone={BLOCKER_TONE[blocker.status]}
                                label={t(`account:closure.blockerStatuses.${blocker.status}`)}
                                testID={`${TEST_ID}-blocker-${blocker.code}-status`}
                            />
                        </Inline>

                        {/*
                         * The server's own reason string, translated. `not_applicable` always
                         * carries one, and it is the sentence that stops a neutral badge reading
                         * as a pass.
                         */}
                        {blocker.reason === null ? null : (
                            <Text
                                tone="secondary"
                                variant="caption"
                                testID={`${TEST_ID}-blocker-${blocker.code}-reason`}
                            >
                                {t(`account:closure.reasonsWhy.${blocker.reason}`, {
                                    count: blocker.count,
                                    defaultValue: blocker.reason,
                                })}
                            </Text>
                        )}

                        {blocker.status === 'blocking' && blocker.resolveHref !== null ? (
                            <Inline space="sm">
                                <Button
                                    testID={`${TEST_ID}-blocker-${blocker.code}-resolve`}
                                    size="sm"
                                    variant="secondary"
                                    label={t('account:closure.resolve')}
                                    onPress={() => {
                                        router.push(blocker.resolveHref as never);
                                    }}
                                />
                            </Inline>
                        ) : null}
                    </Stack>
                </Card>
            ))}
        </Stack>
    );
}

interface RetainedRecordsProps {
    readonly codes: readonly string[];
}

/**
 * What survives.
 *
 * On the way in, not in a policy. A one-way fingerprint of the email is kept so "never contact me
 * again" outlives the deletion of the address itself, and orders keep their amounts and dates for
 * accounting with their delivery lines redacted. Claiming total erasure while retaining records
 * would be a lie, and these records exist in the person's own interest.
 */
function RetainedRecords({ codes }: RetainedRecordsProps) {
    const { t } = useTranslation();
    if (codes.length === 0) return null;

    return (
        <Card padding="sm" testID={`${TEST_ID}-retained`}>
            <Stack space="xs">
                <Text variant="label">{t('account:closure.retainedTitle')}</Text>
                {codes.map((code) => (
                    <Text
                        key={code}
                        tone="secondary"
                        variant="caption"
                        testID={`${TEST_ID}-retained-${code}`}
                    >
                        {t(`account:closure.retained.${code}`, { defaultValue: code })}
                    </Text>
                ))}
            </Stack>
        </Card>
    );
}
