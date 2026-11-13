import { Icon, TextInputField, cx } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
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
import { Pressable, Text as RNText, View } from 'react-native';
import type { DimensionValue } from 'react-native';

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
import { AuthCheck, AuthError, AuthTick } from '../../../ui/auth-form.tsx';
import { OtpChallengePanel } from '../../verification/otp-challenge-panel.tsx';
import { ExtraButton, ExtraCard, ExtraChip, ExtraLink, ExtraPage } from '../account-extra.tsx';

/**
 * `/customer/account/close/{step}` — leaving, in four steps and one short-circuit, drawn as the
 * accepted Close-account board: the red header, the five-dot progress line, the reasons as radio
 * tiles, the two scope cards (the marketing opt-out first, closing in red), the checks with their
 * chips, the code, and the done card.
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
        <ExtraLinkButton
            testID={`${TEST_ID}-${current}-keep`}
            label={t('account:closure.keepAccount')}
            busy={cancel.isPending}
            onPress={keepAccount}
        />
    );
    const backButton = (
        <ExtraButton
            testID={`${TEST_ID}-${current}-back`}
            tone="secondary"
            label={t('account:closure.back')}
            onPress={stepBack}
        />
    );

    const blockers = preconditions.data?.blockers ?? [];
    const blocking = blockers.filter((blocker) => blocker.status === 'blocking');
    const advisories = blockers.filter((blocker) => blocker.status === 'advisory');
    const canClose = preconditions.data?.canClose ?? false;

    return (
        <ExtraPage
            testID={`${TEST_ID}-screen`}
            backTestID={`${TEST_ID}-trail-up`}
            backLabel={t('account:title')}
            onBack={keepAccount}
            icon="signOut"
            tone="danger"
            title={t('account:closure.title')}
            titleTestID={`${TEST_ID}-title`}
        >
            <ClosureSteps current={current} />

            {failure === null ? null : (
                <View className="mt-[18px]">
                    <AuthError
                        testID={`${TEST_ID}-error`}
                        message={`${t('account:closure.failedTitle')} ${failure.message}`}
                    />
                </View>
            )}

            {/* ── 1. why ─────────────────────────────────────────────────────────────────────── */}
            {current === 'reason' ? (
                <ExtraCard testID={`${TEST_ID}-reason`} title={t('account:closure.reasonLabel')}>
                    <View
                        role="radiogroup"
                        aria-label={t('account:closure.reasonLabel')}
                        className="mt-3 flex-row flex-wrap"
                    >
                        {CLOSURE_REASON_CODES.map((code) => {
                            const on = reasonCode === code;
                            return (
                                <View key={code} className="w-full p-1 sm:w-1/2">
                                    <Pressable
                                        testID={`${TEST_ID}-reason-select-option-${code}`}
                                        role="radio"
                                        aria-checked={on}
                                        accessibilityState={{ checked: on }}
                                        onPress={() => {
                                            update({ reasonCode: code });
                                        }}
                                        className={cx(
                                            'min-h-[52px] flex-row items-center gap-2.5 rounded-[14px] border-[1.5px] px-3.5',
                                            on
                                                ? 'border-surface-brand bg-surface-brand-subtle'
                                                : 'border-stroke bg-surface-raised hover:border-surface-brand',
                                        )}
                                    >
                                        <View
                                            className={cx(
                                                'h-5 w-5 items-center justify-center rounded-full border-2',
                                                on ? 'border-surface-brand' : 'border-stroke',
                                            )}
                                        >
                                            {on ? (
                                                <View className="h-2.5 w-2.5 rounded-full bg-surface-brand" />
                                            ) : null}
                                        </View>
                                        <RNText
                                            className={cx(
                                                'min-w-0 flex-1 text-sm font-semibold text-start',
                                                on
                                                    ? 'text-content-on-brand-subtle'
                                                    : 'text-content-primary',
                                            )}
                                        >
                                            {t(`account:closure.reasons.${code}`)}
                                        </RNText>
                                    </Pressable>
                                </View>
                            );
                        })}
                    </View>

                    {/* Only `other` invites a note — the backend's own rule, not a guess. */}
                    {reasonCode !== null && NOTE_REASONS.has(reasonCode) ? (
                        <View className="mt-3.5">
                            <TextInputField
                                testID={`${TEST_ID}-reason-note`}
                                label={t('account:closure.noteLabel')}
                                placeholder={t('account:closure.notePlaceholder')}
                                value={reasonNote}
                                onChangeText={(next) => {
                                    update({ reasonNote: next });
                                }}
                                multiline
                            />
                        </View>
                    ) : null}

                    <View className="mt-5 flex-row flex-wrap items-center gap-2.5">
                        <ExtraButton
                            testID={`${TEST_ID}-reason-next`}
                            label={t('account:closure.next')}
                            icon="chevronForward"
                            disabled={reasonCode === null}
                            onPress={() => {
                                go('scope');
                            }}
                        />
                        {keepButton}
                    </View>
                </ExtraCard>
            ) : null}

            {/* ── 2. how far ─────────────────────────────────────────────────────────────────── */}
            {current === 'scope' ? (
                <ExtraCard testID={`${TEST_ID}-scope`} title={t('account:closure.scopeLabel')}>
                    <View
                        testID={`${TEST_ID}-scope-picker`}
                        role="radiogroup"
                        className="mt-3 flex-col gap-3 sm:flex-row"
                    >
                        {(['marketing_opt_out', 'full'] as const).map((value) => {
                            const on = scope === value;
                            const danger = value === 'full';
                            return (
                                <Pressable
                                    key={value}
                                    testID={`${TEST_ID}-scope-${danger ? 'full' : 'marketing'}`}
                                    role="radio"
                                    aria-checked={on}
                                    accessibilityState={{ checked: on }}
                                    onPress={() => {
                                        update({ scope: value });
                                    }}
                                    className={cx(
                                        'min-w-0 flex-1 flex-col gap-2 rounded-[20px] border-[1.5px] p-[18px] transition duration-normal ease-standard hover:-translate-y-0.5',
                                        on
                                            ? danger
                                                ? 'border-danger-border bg-danger-subtle'
                                                : 'border-surface-brand bg-surface-brand-subtle'
                                            : 'border-stroke bg-surface-raised',
                                    )}
                                >
                                    <View
                                        className={cx(
                                            'h-11 w-11 items-center justify-center rounded-[14px]',
                                            danger ? 'bg-danger-subtle' : 'bg-surface-brand-subtle',
                                        )}
                                    >
                                        <Icon
                                            name={danger ? 'signOut' : 'send'}
                                            size="md"
                                            className={
                                                danger
                                                    ? 'text-danger-on-subtle'
                                                    : 'text-content-on-brand-subtle'
                                            }
                                        />
                                    </View>
                                    <RNText className="font-display text-lg font-bold text-content-primary text-start">
                                        {t(`account:closure.scopes.${value}`)}
                                    </RNText>
                                    <RNText className="text-sm font-medium leading-5 text-content-secondary text-start">
                                        {t(`account:closure.scopeExplainer.${value}.body`)}
                                    </RNText>
                                </Pressable>
                            );
                        })}
                    </View>

                    <View className="mt-5 flex-row flex-wrap items-center gap-2.5">
                        {backButton}
                        <ExtraButton
                            testID={`${TEST_ID}-scope-next`}
                            tone={scope === 'full' ? 'danger' : 'brand'}
                            label={
                                scope === 'marketing_opt_out'
                                    ? t('account:closure.optOutConfirm')
                                    : t('account:closure.next')
                            }
                            busy={request.isPending}
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
                        {keepButton}
                    </View>
                </ExtraCard>
            ) : null}

            {/* ── 3. what is in the way ──────────────────────────────────────────────────────── */}
            {current === 'checks' ? (
                <View testID={`${TEST_ID}-checks`}>
                    <BlockerList blockers={blockers} />

                    <RetainedRecords codes={preconditions.data?.retainedRecordCodes ?? []} />

                    {advisories.length === 0 ? null : (
                        <View className="mt-3.5">
                            <AuthCheck
                                testID={`${TEST_ID}-acknowledge`}
                                label={t('account:closure.acknowledge', {
                                    count: advisories.length,
                                })}
                                checked={acknowledged}
                                onChange={(next) => {
                                    update({ acknowledged: next });
                                }}
                            />
                        </View>
                    )}

                    {blocking.length === 0 ? null : (
                        <View className="mt-3.5">
                            <AuthError
                                testID={`${TEST_ID}-blocked`}
                                message={`${t('account:closure.blockedTitle', { count: blocking.length })} ${t('account:closure.blockedBody')}`}
                            />
                        </View>
                    )}

                    <View className="mt-5 flex-row flex-wrap items-center gap-2.5">
                        {backButton}
                        <ExtraButton
                            testID={`${TEST_ID}-checks-next`}
                            tone="danger"
                            label={t('account:closure.startClosure')}
                            icon="chevronForward"
                            busy={request.isPending}
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
                        {keepButton}
                    </View>
                </View>
            ) : null}

            {/* ── 4. the code ────────────────────────────────────────────────────────────────── */}
            {current === 'verify' ? (
                <ExtraCard testID={`${TEST_ID}-verify`} title={t('account:closure.codeTitle')}>
                    <View className="mt-3">
                        <AuthError
                            testID={`${TEST_ID}-irreversible`}
                            message={`${t('account:closure.irreversibleTitle')} ${t('account:closure.irreversibleBody')}`}
                        />
                    </View>

                    <View className="mt-4">
                        {ticket?.challenge == null ? (
                            <RNText
                                testID={`${TEST_ID}-no-challenge`}
                                className="text-sm font-medium text-content-secondary text-start"
                            >
                                {t('account:closure.noChallenge')}
                            </RNText>
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
                    </View>

                    <View className="mt-5 flex-row flex-wrap items-center gap-2.5">
                        {backButton}
                        {keepButton}
                    </View>
                </ExtraCard>
            ) : null}

            {/* ── 5. done ────────────────────────────────────────────────────────────────────── */}
            {current === 'done' && doneScope !== null ? (
                <View testID={`${TEST_ID}-done`}>
                    <ExtraCard testID={`${TEST_ID}-done-callout`}>
                        <View role="status" className="flex-col items-center px-5 pb-2.5 pt-7">
                            <AuthTick />
                            <RNText className="mt-6 font-display text-2xl font-bold text-content-primary text-center">
                                {t(
                                    doneScope === 'marketing_opt_out'
                                        ? 'account:closure.optOutDoneTitle'
                                        : 'account:closure.closedTitle',
                                )}
                            </RNText>
                            <RNText className="mb-5 mt-1.5 max-w-[440px] text-base font-medium leading-6 text-content-secondary text-center">
                                {t(
                                    doneScope === 'marketing_opt_out'
                                        ? 'account:closure.optOutDoneBody'
                                        : 'account:closure.closedBody',
                                )}
                            </RNText>
                            <ExtraButton
                                testID={`${TEST_ID}-done-home`}
                                label={t('account:closure.finish')}
                                onPress={() => {
                                    // An opt-out leaves the account as it was: back to the switches
                                    // the person came from, which now read off. A replace — the
                                    // wizard is over.
                                    router.replace(
                                        (doneScope === 'marketing_opt_out'
                                            ? CLOSURE_HOME
                                            : '/discover') as never,
                                    );
                                }}
                            />
                        </View>
                    </ExtraCard>
                </View>
            ) : null}
        </ExtraPage>
    );
}

/**
 * The board's progress line: five numbered dots under a line that fills to the step in hand, each
 * finished dot a brand disc with a tick.
 */
function ClosureSteps({ current }: { readonly current: ClosureStep }) {
    const { t } = useTranslation();
    const index = CLOSURE_STEPS.indexOf(current);
    const filled = (index / (CLOSURE_STEPS.length - 1)) * 80;
    return (
        <View
            testID={`${TEST_ID}-stepper`}
            accessibilityLabel={`${t('account:closure.stepperLabel')}: ${t(`account:closure.steps.${current}`)}`}
            className="relative mt-[22px] flex-row"
        >
            <View className="absolute end-[10%] start-[10%] top-[15px] h-[3px] rounded-full bg-stroke-subtle" />
            <View
                className="absolute start-[10%] top-[15px] h-[3px] rounded-full bg-surface-brand"
                style={{ width: `${String(filled)}%` as DimensionValue }}
            />
            {CLOSURE_STEPS.map((step, position) => {
                const done = position < index;
                const now = position === index;
                return (
                    <View key={step} className="flex-1 flex-col items-center gap-1.5">
                        <View
                            className={cx(
                                'h-8 w-8 items-center justify-center rounded-full border-2',
                                done
                                    ? 'border-surface-brand bg-surface-brand'
                                    : now
                                      ? 'border-surface-brand bg-surface-raised'
                                      : 'border-stroke bg-surface-raised',
                            )}
                        >
                            {done ? (
                                <Icon name="check" size="sm" className="text-content-on-brand" />
                            ) : (
                                <RNText className="text-sm font-bold text-content-primary">
                                    {String(position + 1)}
                                </RNText>
                            )}
                        </View>
                        <RNText
                            className={cx(
                                'text-xs font-semibold text-center',
                                now ? 'text-content-primary' : 'text-content-secondary',
                            )}
                        >
                            {t(`account:closure.steps.${step}`)}
                        </RNText>
                    </View>
                );
            })}
        </View>
    );
}

/** "Keep my account" — the quiet way out on every step, in brand ink. */
function ExtraLinkButton({
    testID,
    label,
    busy,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly busy: boolean;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={busy}
            aria-busy={busy}
            accessibilityState={{ disabled: busy, busy }}
            onPress={onPress}
            className="min-h-touch justify-center rounded-full px-3 hover:bg-surface-brand-subtle"
        >
            <RNText className="text-sm font-semibold text-content-on-brand-subtle">{label}</RNText>
        </Pressable>
    );
}

/** The check's state, as the board's tile and chip. Four statuses, and no collapsing. */
const BLOCKER_LOOK: Readonly<
    Record<
        ClosureBlocker['status'],
        { readonly chip: 'ok' | 'bad' | 'amber' | 'mute'; readonly icon: IconName }
    >
> = {
    blocking: { chip: 'bad', icon: 'close' },
    clear: { chip: 'ok', icon: 'check' },
    advisory: { chip: 'amber', icon: 'warning' },
    not_applicable: { chip: 'mute', icon: 'minus' },
};

interface BlockerListProps {
    readonly blockers: readonly ClosureBlocker[];
}

function BlockerList({ blockers }: BlockerListProps) {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <ExtraCard testID={`${TEST_ID}-blockers`} title={t('account:closure.checksTitle')}>
            {blockers.map((blocker, index) => {
                const look = BLOCKER_LOOK[blocker.status];
                return (
                    <View
                        key={blocker.code}
                        testID={`${TEST_ID}-blocker-${blocker.code}`}
                        className={cx(
                            'flex-row items-center gap-3 py-3',
                            index === 0 ? '' : 'border-t border-stroke-subtle',
                        )}
                    >
                        <View
                            className={cx(
                                'h-10 w-10 items-center justify-center rounded-[13px]',
                                look.chip === 'ok'
                                    ? 'bg-surface-brand-subtle'
                                    : look.chip === 'bad'
                                      ? 'bg-danger-subtle'
                                      : look.chip === 'amber'
                                        ? 'bg-warning-subtle'
                                        : 'bg-surface-base',
                            )}
                        >
                            <Icon
                                name={look.icon}
                                size="md"
                                className={
                                    look.chip === 'ok'
                                        ? 'text-content-on-brand-subtle'
                                        : look.chip === 'bad'
                                          ? 'text-danger-on-subtle'
                                          : look.chip === 'amber'
                                            ? 'text-warning-on-subtle'
                                            : 'text-content-secondary'
                                }
                            />
                        </View>
                        <View className="min-w-0 flex-1">
                            <RNText className="text-base font-semibold text-content-primary text-start">
                                {t(`account:closure.blockers.${blocker.code}`)}
                            </RNText>
                            {/*
                             * The server's own reason string, translated. `not_applicable` always
                             * carries one, and it is the sentence that stops a neutral chip reading
                             * as a pass.
                             */}
                            {blocker.reason === null ? null : (
                                <RNText
                                    testID={`${TEST_ID}-blocker-${blocker.code}-reason`}
                                    className="mt-0.5 text-sm font-medium text-content-secondary text-start"
                                >
                                    {t(`account:closure.reasonsWhy.${blocker.reason}`, {
                                        count: blocker.count,
                                        defaultValue: blocker.reason,
                                    })}
                                </RNText>
                            )}
                            {blocker.status === 'blocking' && blocker.resolveHref !== null ? (
                                <ExtraLink
                                    testID={`${TEST_ID}-blocker-${blocker.code}-resolve`}
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
                            ) : null}
                        </View>
                        <ExtraChip
                            testID={`${TEST_ID}-blocker-${blocker.code}-status`}
                            tone={look.chip}
                            label={t(`account:closure.blockerStatuses.${blocker.status}`)}
                        />
                    </View>
                );
            })}
        </ExtraCard>
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
        <ExtraCard testID={`${TEST_ID}-retained`} title={t('account:closure.retainedTitle')}>
            <View className="mt-1 flex-col gap-1.5">
                {codes.map((code) => (
                    <View key={code} className="flex-row items-start gap-2">
                        <Icon name="info" size="sm" className="mt-0.5 text-content-secondary" />
                        <RNText
                            testID={`${TEST_ID}-retained-${code}`}
                            className="min-w-0 flex-1 text-sm font-medium text-content-secondary text-start"
                        >
                            {t(`account:closure.retained.${code}`, { defaultValue: code })}
                        </RNText>
                    </View>
                ))}
            </View>
        </ExtraCard>
    );
}
