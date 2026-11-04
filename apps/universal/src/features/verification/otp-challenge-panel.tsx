import type { ApiFailure } from '@healthy360/api-client';
import { Badge, Button, Callout, Inline, Stack, Text } from '@healthy360/design-system';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { AuthLink, AuthSubmit, AuthText } from '../../ui/auth-form.tsx';
import { CodeBoxes } from '../../ui/code-boxes.tsx';
import { describeOtpFailure } from './otp-errors.ts';
import type { OtpChannel, OtpErrorView } from './otp-errors.ts';
import { secondsUntil, useCountdown } from './use-countdown.ts';

/**
 * The subset of `OtpChallenge` this panel draws.
 *
 * Declared structurally rather than imported: `VerificationRepository` has not joined the exported
 * `Repositories` bundle yet, so the contract's types are not reachable from the application. A real
 * `OtpChallenge` satisfies this interface, which is what the follow-up slice will rely on when it
 * wires the repository in — no cast, no adapter.
 */
export interface OtpChallengeView {
    readonly id: string;
    readonly channel: OtpChannel;
    /** Server-authored. The panel never masks anything itself. */
    readonly maskedDestination: string;
    readonly codeLength: number;
    readonly expiresAt: string;
    readonly resendCooldownSeconds: number;
    readonly attemptsRemaining: number;
    readonly availableChannels: readonly OtpChannel[];
    /** Non-production only. Each one is badged as undelivered. */
    readonly simulatedChannels: readonly OtpChannel[];
}

export interface ChannelPickerProps {
    readonly channels: readonly OtpChannel[];
    readonly current: OtpChannel;
    readonly simulated: readonly OtpChannel[];
    readonly disabled?: boolean | undefined;
    readonly onSelect: (channel: OtpChannel) => void;
    readonly testID?: string | undefined;
}

/**
 * "Send the code another way."
 *
 * Every channel the *server* offered, and nothing else — a picker assembled from a contact list on
 * the device would offer routes the backend will refuse. A simulated channel is still shown, because
 * hiding it in development would make the panel behave differently from production for the wrong
 * reason; it is shown with a badge that says no message is actually delivered, which is the honest
 * alternative to a screen that claims to have sent an SMS.
 */
export function ChannelPicker({
    channels,
    current,
    simulated,
    disabled = false,
    onSelect,
    testID = 'otp-channels',
}: ChannelPickerProps) {
    const { t } = useTranslation();
    if (channels.length === 0) return null;

    return (
        <Stack testID={testID} space="xs">
            <Text variant="label" tone="secondary">
                {t('auth:otp.channelSwitch')}
            </Text>
            <Inline space="sm">
                {channels.map((channel) => {
                    const name = t(`auth:otp.channels.${channel}`);
                    const isSimulated = simulated.includes(channel);
                    return (
                        <Inline key={channel} space="xs">
                            <Button
                                testID={`${testID}-${channel}`}
                                variant={channel === current ? 'secondary' : 'ghost'}
                                size="sm"
                                disabled={disabled}
                                label={t('auth:otp.sendVia', { channel: name })}
                                onPress={() => {
                                    onSelect(channel);
                                }}
                            />
                            {isSimulated ? (
                                <Badge
                                    testID={`${testID}-${channel}-simulated`}
                                    tone="warning"
                                    label={t('auth:otp.channelSimulated')}
                                />
                            ) : null}
                        </Inline>
                    );
                })}
            </Inline>
        </Stack>
    );
}

/** What the person typed, and the challenge and rejection it was typed against. */
interface CodeEntry {
    readonly code: string;
    readonly challengeId: string;
    readonly against: ApiFailure | null;
}

interface ChannelChoice {
    readonly channel: OtpChannel;
    readonly challengeId: string;
}

export interface OtpChallengePanelProps {
    readonly challenge: OtpChallengeView;
    /** The last rejection, if any. Non-OTP failures fall through to `fallbackMessage`. */
    readonly failure?: ApiFailure | null | undefined;
    /** Copy for a failure this panel has no row for — a network drop, say. */
    readonly fallbackMessage?: string | null | undefined;
    readonly verifying?: boolean | undefined;
    readonly resending?: boolean | undefined;
    readonly onVerify: (code: string) => void;
    readonly onResend: (channel: OtpChannel) => void;
    readonly testID?: string | undefined;
    /**
     * `auth` draws the panel as the sign-in frame's boards do — the screen owns the title, the
     * code boxes sit full width, Confirm is the big pill and the other channels wait behind "Send
     * the code another way". `panel` is the card look every other screen uses.
     */
    readonly look?: 'panel' | 'auth' | undefined;
}

/**
 * The one-time-code panel.
 *
 * ## Two live regions, and why they are not one
 *
 * - The **assertive** region carries events: "that code is not right", "this is locked". A screen
 *   reader interrupts for these, which is correct — something just happened and the person's next
 *   action depends on it.
 * - The **polite** region carries state: how many attempts are left, how long until another code can
 *   be sent. These change on a timer. Announcing a countdown assertively would talk over the person
 *   every second; leaving it out of a live region entirely would hide it from anybody not watching
 *   the screen.
 *
 * Both are mounted at all times, empty when there is nothing to say, because a region that appears
 * with its message already in it is frequently not announced at all.
 *
 * ## What the panel refuses to compute
 *
 * The cooldown, the attempts and the lockout end all come from the server — seeded into
 * {@link useCountdown} and counted down locally only so the *display* ticks. When the server and the
 * local clock disagree, the server wins on the next round trip. The panel never decides that a
 * person may resend; it only stops them asking when it already knows the answer is no.
 */
export function OtpChallengePanel({
    challenge,
    failure = null,
    fallbackMessage = null,
    verifying = false,
    resending = false,
    onVerify,
    onResend,
    testID = 'otp-panel',
    look = 'panel',
}: OtpChallengePanelProps) {
    const { t } = useTranslation();
    const [otherWays, setOtherWays] = useState(false);

    const error: OtpErrorView | null = useMemo(
        () => (failure === null ? null : describeOtpFailure(failure)),
        [failure],
    );

    /**
     * The typed code, together with what it was typed *against*.
     *
     * Storing the context alongside the value is what lets "clear the field on a rejection" and
     * "clear the field on a new challenge" be **derived** rather than written from an effect. An
     * effect that called `setCode('')` would fire again on the very next render — that is, as soon
     * as the person started their next attempt — and delete their input keystroke by keystroke.
     * Here the rule is simply: input that predates the current challenge or the current rejection is
     * not shown.
     */
    const [entry, setEntry] = useState<CodeEntry>(() => ({
        code: '',
        challengeId: challenge.id,
        against: failure,
    }));

    const stale =
        entry.challengeId !== challenge.id ||
        (entry.against !== failure && (error?.clearCode ?? false));
    const code = stale ? '' : entry.code;

    /** Same trick for the channel: a chosen channel belongs to the challenge it was chosen on. */
    const [choice, setChoice] = useState<ChannelChoice | null>(null);
    const channel =
        choice !== null && choice.challengeId === challenge.id ? choice.channel : challenge.channel;

    /**
     * Both countdowns are seeded from the server and reset when the seed changes: the cooldown from
     * whichever of the challenge and the rejection is speaking, the expiry from the challenge's own
     * deadline. The panel counts down only so the display ticks — the server stays authoritative.
     */
    const cooldown = useCountdown(error?.countdownSeconds ?? challenge.resendCooldownSeconds);
    const expiry = useCountdown(secondsUntil(challenge.expiresAt));

    const locked = error?.effect === 'locked';
    // Expiry is a *state*, not a message: once the code cannot work, the only affordance left is
    // asking for a new one, whether the server said so or the clock ran out on this device.
    const expired = error?.effect === 'request_new_code' || (!expiry.running && !locked);
    const entryClosed = locked || expired;

    const resendBlocked = locked || cooldown.running || resending;

    const handleResend = useCallback(
        (next: OtpChannel) => {
            setChoice({ channel: next, challengeId: challenge.id });
            onResend(next);
        },
        [challenge.id, onResend],
    );

    const handleCode = useCallback(
        (next: string) => {
            setEntry({ code: next, challengeId: challenge.id, against: failure });
        },
        [challenge.id, failure],
    );

    /** Assertive: what just happened. Never the running counts. */
    const alert =
        error !== null ? t(error.messageKey) : failure !== null ? (fallbackMessage ?? '') : '';

    /** Polite: what is true now. Attempts first, then the wait. */
    const attemptsRemaining = error?.attemptsRemaining ?? challenge.attemptsRemaining;
    const status = [
        entryClosed
            ? ''
            : t('auth:otp.attemptsRemaining', { count: Math.max(0, attemptsRemaining) }),
        cooldown.running ? t('auth:otp.resendIn', { count: cooldown.seconds }) : '',
    ]
        .filter((part) => part.length > 0)
        .join(' ');

    const notices = (
        <>
            {locked ? (
                <Callout
                    testID={`${testID}-locked`}
                    tone="danger"
                    role="alert"
                    title={t('auth:otp.lockedTitle')}
                    body={t('auth:otp.lockedBody', { count: error?.lockoutMinutes ?? 1 })}
                />
            ) : null}

            {expired && !locked ? (
                <Callout
                    testID={`${testID}-expired`}
                    tone="warning"
                    role="status"
                    title={t('auth:otp.expiredTitle')}
                    body={t('auth:otp.expiredBody')}
                />
            ) : null}
        </>
    );

    if (look === 'auth') {
        const channels = locked ? (error?.promoteChannels ?? []) : challenge.availableChannels;
        return (
            <View testID={testID} className="flex-col gap-3.5">
                <AuthText testID={`${testID}-destination`}>
                    {t('auth:otp.body', { destination: challenge.maskedDestination })}
                </AuthText>

                <Text
                    testID={`${testID}-alert`}
                    role="alert"
                    aria-live="assertive"
                    tone="danger"
                    variant="caption"
                >
                    {alert}
                </Text>

                {notices}

                <CodeBoxes
                    testID={`${testID}-code`}
                    label={t('auth:otp.codeLabel')}
                    value={code}
                    length={challenge.codeLength}
                    disabled={entryClosed || verifying}
                    onChangeText={handleCode}
                    onSubmitEditing={() => {
                        if (!entryClosed && code.length >= challenge.codeLength) onVerify(code);
                    }}
                />

                <View testID={`${testID}-status`} role="status" aria-live="polite">
                    <RNText className="text-center text-xs font-medium text-content-secondary">
                        {status}
                    </RNText>
                </View>

                <AuthSubmit
                    testID={`${testID}-submit`}
                    label={t('auth:otp.submit')}
                    busy={verifying}
                    disabled={entryClosed || code.length < challenge.codeLength}
                    onPress={() => {
                        onVerify(code);
                    }}
                />

                <View className="flex-row flex-wrap items-center justify-center gap-x-4">
                    <AuthLink
                        testID={`${testID}-resend`}
                        label={t('auth:otp.resend')}
                        disabled={resendBlocked}
                        onPress={() => {
                            handleResend(channel);
                        }}
                    />
                    {channels.length === 0 || locked ? null : (
                        <AuthLink
                            testID={`${testID}-other-ways`}
                            label={t('auth:otp.channelSwitch')}
                            onPress={() => {
                                setOtherWays((open) => !open);
                            }}
                        />
                    )}
                </View>

                {/* A lockout promotes the other channels from "another way" to the way out. */}
                {otherWays || locked ? (
                    <View className="items-center">
                        <ChannelPicker
                            testID={`${testID}-channels`}
                            channels={channels}
                            current={channel}
                            simulated={challenge.simulatedChannels}
                            disabled={resending || (locked && cooldown.running)}
                            onSelect={handleResend}
                        />
                    </View>
                ) : null}
            </View>
        );
    }

    return (
        <Stack testID={testID} space="lg">
            <Stack space="xs">
                <Text variant="bodyStrong" testID={`${testID}-title`}>
                    {t('auth:otp.title')}
                </Text>
                <Text tone="secondary" testID={`${testID}-destination`}>
                    {t('auth:otp.body', { destination: challenge.maskedDestination })}
                </Text>
            </Stack>

            <Text
                testID={`${testID}-alert`}
                role="alert"
                aria-live="assertive"
                tone="danger"
                variant="caption"
            >
                {alert}
            </Text>

            {notices}

            <CodeBoxes
                testID={`${testID}-code`}
                label={t('auth:otp.codeLabel')}
                size="lg"
                align="start"
                value={code}
                length={challenge.codeLength}
                disabled={entryClosed || verifying}
                onChangeText={handleCode}
            />

            <View testID={`${testID}-status`} role="status" aria-live="polite">
                <Text variant="caption" tone="secondary">
                    {status}
                </Text>
            </View>

            <Inline space="sm">
                <Button
                    testID={`${testID}-submit`}
                    label={t('auth:otp.submit')}
                    loading={verifying}
                    disabled={entryClosed || code.length < challenge.codeLength}
                    onPress={() => {
                        onVerify(code);
                    }}
                />
                <Button
                    testID={`${testID}-resend`}
                    variant="secondary"
                    label={t('auth:otp.resend')}
                    loading={resending}
                    disabled={resendBlocked}
                    onPress={() => {
                        handleResend(channel);
                    }}
                />
            </Inline>

            {/*
             * A lockout is the moment the picker matters most, so it is promoted from "another way"
             * to the primary route out — with the server's own list, which may legitimately be
             * empty when there is nowhere else to send a code.
             */}
            <ChannelPicker
                testID={`${testID}-channels`}
                channels={locked ? (error?.promoteChannels ?? []) : challenge.availableChannels}
                current={channel}
                simulated={challenge.simulatedChannels}
                disabled={resending || (locked && cooldown.running)}
                onSelect={handleResend}
            />
        </Stack>
    );
}
