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
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useCancelClosureMutation,
    useClosurePreconditionsQuery,
    useLiveClosureRequestQuery,
    useRequestClosureMutation,
    useVerifyClosureMutation,
} from '../../../data/account-hooks.ts';
import { queryKeys } from '../../../data/query-keys.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';
import { createSessionDraftStore } from '../../../navigation/session-draft.ts';
import { usePreviousEntry } from '../../../navigation/use-return-to.ts';
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
 *
 * ## The answers live in a session draft, not in the screen
 *
 * Each step is its own route, pushed, and every `/customer/*` page is a sibling in one `<Slot/>` —
 * so moving from the reason to the scope unmounts this screen, and the reason held in `useState`
 * was gone by the time "Stop the marketing" needed it. The wizard could never get past step two.
 * The reason, the note, the scope and the acknowledgement now sit in a `closure` session draft: it
 * survives the step change, a refresh and a detour to resolve a blocker, dies with the tab, and is
 * cleared on sign-out. Not the URL: the note is free text about why somebody is leaving.
 *
 * ## Every step has a way out, and a way back
 *
 * "Keep my account" on every step clears the draft, cancels a request still in flight, and goes up
 * to Account › Notifications, where the wizard is opened from. The in-card Back walks to the
 * previous step: the browser's Back when that is the entry underneath, otherwise a replace to it —
 * after a refresh or a deep link there is nothing underneath to pop to.
 *
 * ## The done step says what happened, from the URL
 *
 * `/close/done?scope=marketing_opt_out` — the finished scope travels in the URL, because the
 * mutation that produced it died with the previous step's screen. A full closure does not end
 * here at all: it ends the session, and anything under `/customer` would answer that with the
 * sign-in page. It replaces to the public `/account-closed` first, and only then tells the session
 * query, so the customer gate never gets a chance to bounce the person to sign-in.
 */

export const CLOSURE_STEPS = ['reason', 'scope', 'checks', 'verify', 'done'] as const;
export type ClosureStep = (typeof CLOSURE_STEPS)[number];

export function isClosureStep(value: string | undefined): value is ClosureStep {
    return value !== undefined && (CLOSURE_STEPS as readonly string[]).includes(value);
}

const TEST_ID = 'closure';

/** Where the wizard is opened from, and where "Keep my account" and an opt-out go back to. */
export const CLOSURE_HOME = '/customer/account?section=notifications';

/** The public page a completed full closure ends on — outside the customer gate. */
export const ACCOUNT_CLOSED_HREF = '/account-closed';

function stepHref(step: ClosureStep): string {
    return `/customer/account/close/${step}`;
}

function isClosureScope(value: unknown): value is ClosureScope {
    return value === 'marketing_opt_out' || value === 'full';
}

/** What the person has answered so far. */
export interface ClosureDraft {
    readonly reasonCode: ClosureReasonCode | null;
    readonly reasonNote: string;
    readonly scope: ClosureScope;
    readonly acknowledged: boolean;
}

const EMPTY_DRAFT: ClosureDraft = {
    reasonCode: null,
    reasonNote: '',
    // The opt-out is offered first, on purpose — see the module note.
    scope: 'marketing_opt_out',
    acknowledged: false,
};

function parseClosureDraft(raw: unknown): ClosureDraft | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const value = raw as Record<string, unknown>;
    const reasonCode =
        typeof value.reasonCode === 'string' &&
        (CLOSURE_REASON_CODES as readonly string[]).includes(value.reasonCode)
            ? (value.reasonCode as ClosureReasonCode)
            : null;
    return {
        reasonCode,
        reasonNote: typeof value.reasonNote === 'string' ? value.reasonNote : '',
        scope: isClosureScope(value.scope) ? value.scope : EMPTY_DRAFT.scope,
        acknowledged: value.acknowledged === true,
    };
}

const DRAFT_KEY = 'current';

const closureDrafts = createSessionDraftStore<ClosureDraft>({
    namespace: 'closure',
    parse: parseClosureDraft,
    // A day: long enough to sort out a blocker and come back, short enough that an answer from last
    // week is not presented as today's.
    maxAgeMs: 24 * 60 * 60 * 1000,
});

/** Forgets the answers — on "Keep my account", on finishing, and when the wizard is opened afresh. */
export function clearClosureDraft(): void {
    closureDrafts.clear(DRAFT_KEY);
}

export interface ClosureWizardScreenProps {
    readonly step: string | undefined;
    /** The done step's `?scope=` — what actually happened. */
    readonly scope?: string | undefined;
}

/** `other` is the only reason that invites free text — the backend's `invitesNote()`, mirrored. */
const NOTE_REASONS: ReadonlySet<ClosureReasonCode> = new Set<ClosureReasonCode>(['other']);

export function ClosureWizardScreen({ step, scope: doneParam }: ClosureWizardScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const queryClient = useQueryClient();
    const previous = usePreviousEntry();

    // A done step that does not say what was done cannot claim anything: it starts over.
    const doneScope: ClosureScope | null = isClosureScope(doneParam) ? doneParam : null;
    const requested: ClosureStep = isClosureStep(step) ? step : 'reason';
    const current: ClosureStep = requested === 'done' && doneScope === null ? 'reason' : requested;

    const draft = closureDrafts.useDraft(DRAFT_KEY) ?? EMPTY_DRAFT;
    const { reasonCode, reasonNote, scope, acknowledged } = draft;
    const update = (patch: Partial<ClosureDraft>) => {
        closureDrafts.write(DRAFT_KEY, {
            ...(closureDrafts.read(DRAFT_KEY) ?? EMPTY_DRAFT),
            ...patch,
        });
    };

    // Re-read on every step. A snapshot taken at step three is a snapshot that can be wrong by
    // step four, and being wrong here means closing over a live subscription.
    const preconditions = useClosurePreconditionsQuery();
    const live = useLiveClosureRequestQuery();

    const request = useRequestClosureMutation();
    const verify = useVerifyClosureMutation();
    const cancel = useCancelClosureMutation();

    /** The ticket in hand: whatever the last write produced, else whatever is already in flight. */
    const ticket: ClosureTicket | null = request.data ?? verify.data ?? live.data ?? null;
    const failure = toFailure(request.error) ?? toFailure(verify.error) ?? toFailure(cancel.error);

    const go = (next: ClosureStep) => {
        router.push(stepHref(next) as never);
    };

    /** The in-card Back: pop when the previous step is underneath, else replace to it. */
    const stepBack = () => {
        const index = CLOSURE_STEPS.indexOf(current);
        const target = CLOSURE_STEPS[index - 1];
        if (target === undefined) return;
        if (previous?.pathname === stepHref(target)) router.back();
        else router.replace(stepHref(target) as never);
    };

    /** A completed write: replace, so Back never offers the step that made it. */
    const finishOptOut = () => {
        clearClosureDraft();
        router.replace(withQuery(stepHref('done'), { scope: 'marketing_opt_out' }) as never);
    };

    /**
     * A completed full closure. The navigation first, then the session query: the server has ended
     * the session, and the customer gate would answer a stale `me` with the sign-in page.
     */
    const finishClosure = () => {
        clearClosureDraft();
        router.replace(ACCOUNT_CLOSED_HREF as never);
        void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    };

    const keepAccount = () => {
        const leave = () => {
            clearClosureDraft();
            router.dismissTo(CLOSURE_HOME as never);
        };
        // A request still in flight would refuse the next attempt (`closure_already_in_flight`),
        // so keeping the account withdraws it.
        if (ticket !== null && ticket.status !== 'completed' && ticket.status !== 'cancelled') {
            cancel.mutate({ ticketId: ticket.id }, { onSuccess: leave });
            return;
        }
        leave();
    };

    const keepButton = (
        <Button
            testID={`${TEST_ID}-${current}-keep`}
            variant="quiet"
            label={t('account:closure.keepAccount')}
            loading={cancel.isPending}
            onPress={keepAccount}
        />
    );
    const backButton = (
        <Button
            testID={`${TEST_ID}-${current}-back`}
            variant="ghost"
            label={t('account:closure.back')}
            onPress={stepBack}
        />
    );

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
                                update({ reasonCode: next as ClosureReasonCode });
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
                                placeholder={t('account:closure.notePlaceholder')}
                                hint={t('account:closure.noteHint')}
                                value={reasonNote}
                                onChangeText={(next) => {
                                    update({ reasonNote: next });
                                }}
                                multiline
                            />
                        ) : null}

                        <Inline space="sm" wrap>
                            <Button
                                testID={`${TEST_ID}-reason-next`}
                                label={t('account:closure.next')}
                                disabled={reasonCode === null}
                                onPress={() => {
                                    go('scope');
                                }}
                            />
                            {keepButton}
                        </Inline>
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
                                update({ scope: next as ClosureScope });
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

                        <Inline space="sm" wrap>
                            <Button
                                testID={`${TEST_ID}-scope-next`}
                                label={
                                    scope === 'marketing_opt_out'
                                        ? t('account:closure.optOutConfirm')
                                        : t('account:closure.next')
                                }
                                loading={request.isPending}
                                // Reached without a reason — a deep link, or an expired draft —
                                // there is nothing to send. Back walks to the step that asks.
                                disabled={reasonCode === null}
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
                                        { onSuccess: finishOptOut },
                                    );
                                }}
                            />
                            {backButton}
                            {keepButton}
                        </Inline>
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
                            onChange={(next) => {
                                update({ acknowledged: next });
                            }}
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
                            // The server's verdict, plus the acknowledgement this screen owns, plus
                            // the reason the request needs.
                            disabled={
                                !canClose ||
                                (advisories.length > 0 && !acknowledged) ||
                                reasonCode === null
                            }
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
                                        // Refused to start: this step already is the answer, and
                                        // the write's invalidation has re-read the checks.
                                        onSuccess: (created) => {
                                            if (!created.blocked) go('verify');
                                        },
                                    },
                                );
                            }}
                        />
                        {backButton}
                        {keepButton}
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
                                                if (result.blocked) {
                                                    stepBack();
                                                } else if (result.status === 'completed') {
                                                    finishClosure();
                                                } else {
                                                    // Verified and scheduled: the session is
                                                    // still live, so the done step can say so.
                                                    clearClosureDraft();
                                                    router.replace(
                                                        withQuery(stepHref('done'), {
                                                            scope: 'full',
                                                        }) as never,
                                                    );
                                                }
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

                        <Inline space="sm" wrap>
                            {backButton}
                            {keepButton}
                        </Inline>
                    </Stack>
                </Card>
            ) : null}

            {/* ── 5. done ────────────────────────────────────────────────────────────────────── */}
            {current === 'done' && doneScope !== null ? (
                <Stack space="md" testID={`${TEST_ID}-done`}>
                    <Callout
                        testID={`${TEST_ID}-done-callout`}
                        role="status"
                        tone="success"
                        title={t(
                            doneScope === 'marketing_opt_out'
                                ? 'account:closure.optOutDoneTitle'
                                : 'account:closure.closedTitle',
                        )}
                        body={t(
                            doneScope === 'marketing_opt_out'
                                ? 'account:closure.optOutDoneBody'
                                : 'account:closure.closedBody',
                        )}
                    />

                    <Button
                        testID={`${TEST_ID}-done-home`}
                        label={t('account:closure.finish')}
                        onPress={() => {
                            // An opt-out leaves the account as it was: back to the switches the
                            // person came from, which now read off. A replace — the wizard is over.
                            router.replace(
                                (doneScope === 'marketing_opt_out'
                                    ? CLOSURE_HOME
                                    : '/discover') as never,
                            );
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
                                        // A detour: the page that sorts it out offers the way
                                        // back to these checks, which re-read on return.
                                        router.push(
                                            withReturnTo(
                                                blocker.resolveHref ?? '',
                                                stepHref('checks'),
                                            ) as never,
                                        );
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
