import { Callout, Icon, cx } from '@healthy360/design-system';
import type { SubscriptionBalance, SubscriptionQuote } from '@healthy360/api-client/contracts';
import type { SubscriptionState } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';

import { toFailure } from '../../data/commerce-hooks.ts';
import {
    ShopDialog,
    ShopDialogButton,
    ShopDialogConsequence,
    ShopDialogSubject,
    ShopDialogTag,
    ShopDialogTile,
} from '../../ui/shop-dialog.tsx';
import { weekdayKey } from '../marketplace/format.ts';
import { isTerminalSubscriptionState } from './state-badge.tsx';

/**
 * The three S1 editors, and the dialog that ends a subscription.
 *
 * Extracted from `screens/subscription-detail-screen.tsx` rather than added to it: the detail screen
 * was already the longest in the feature, and these three are each a small self-contained decision
 * with its own rule. Keeping them here means the rule and the control that enforces it are next to
 * each other.
 */

/**
 * Why an action did not go through, inside the dialog that asked for it.
 *
 * Every subscription dialog is modal and stays open when the server refuses, so a refusal drawn on
 * the page underneath is drawn behind the backdrop — the person pressed Confirm and saw nothing
 * happen (plans-09). It is drawn here instead, in the server's own words, and each dialog's
 * mutation is reset as the dialog opens so an old refusal never greets a fresh attempt.
 */
export function DialogFailure({
    error,
    testID,
}: {
    readonly error: unknown;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const failure = toFailure(error);
    if (failure === null) return null;
    return (
        <Callout
            testID={testID}
            role="alert"
            tone="danger"
            icon="warning"
            title={t('commerce:subscription.actionFailedTitle')}
            body={failure.message}
        />
    );
}

/**
 * A tile editor's refusal (Shop · Subscription, pin 3): one small red line under the buttons —
 * "That change was not saved.", the server's reason, and Try again — rather than the full red box a
 * pop-up uses. The editor stays open with what the person chose.
 */
export function InlineFailure({
    error,
    onRetry,
    testID,
}: {
    readonly error: unknown;
    readonly onRetry?: (() => void) | undefined;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const failure = toFailure(error);
    if (failure === null) return null;
    return (
        <View
            testID={testID}
            role="alert"
            className="flex-row items-center gap-2 rounded-xl bg-danger-subtle px-2.5 py-2"
        >
            <Icon name="alert" size="sm" className="text-danger-on-subtle" />
            <RNText className="min-w-0 flex-1 text-xs font-semibold leading-4 text-danger-on-subtle text-start">
                {`${t('commerce:subscription.notSaved')} ${failure.message}`}
            </RNText>
            {onRetry === undefined ? null : (
                <Pressable
                    testID={`${testID}-retry`}
                    role="button"
                    accessibilityRole="button"
                    onPress={onRetry}
                >
                    <RNText className="text-xs font-bold text-danger-on-subtle underline">
                        {t('errors:generic.retry')}
                    </RNText>
                </Pressable>
            )}
        </View>
    );
}

/* ── pause and resume ───────────────────────────────────────────────────────────────────────── */

export interface PlanSubjectProps {
    readonly planName: string;
    readonly state: SubscriptionState;
    readonly kitchenName?: string | undefined;
    /** One more fact after the kitchen — the next delivery, the days left. */
    readonly line?: string | undefined;
    readonly testID?: string | undefined;
}

/** The subscription pop-ups' card: the plan, its state as a tag, the kitchen and one line. */
export function PlanSubject({ planName, state, kitchenName, line, testID }: PlanSubjectProps) {
    const { t } = useTranslation();
    const meta = [kitchenName, line].filter(
        (part): part is string => part !== undefined && part !== '',
    );
    return (
        <ShopDialogSubject
            testID={testID}
            lead={<ShopDialogTile icon="leaf" />}
            name={planName}
            tag={
                <ShopDialogTag
                    label={t(`commerce:states.${state}`)}
                    tone={
                        state === 'paused'
                            ? 'warning'
                            : isTerminalSubscriptionState(state)
                              ? 'muted'
                              : 'brand'
                    }
                />
            }
            meta={meta.length === 0 ? undefined : meta.join(' · ')}
        />
    );
}

export interface PauseResumeDialogProps {
    readonly kind: 'pause' | 'resume';
    readonly open: boolean;
    readonly subject: PlanSubjectProps;
    readonly pending: boolean;
    readonly error?: unknown;
    readonly onClose: () => void;
    readonly onConfirm: () => void;
    /** `{prefix}-dialog`, `-cancel`, `-confirm`, `-consequence`, `-failure`. */
    readonly testID: string;
}

/**
 * "Pause this subscription?" and "Resume this subscription?" — Shop · Subscription, pins 8 and 9.
 * The same two questions on the subscription page and on the account's subscription cards.
 *
 * Pause has no "resume on" date: the platform has no scheduled resume, and the field that used to
 * ask for one collected a date nothing acted on.
 */
export function PauseResumeDialog({
    kind,
    open,
    subject,
    pending,
    error,
    onClose,
    onConfirm,
    testID,
}: PauseResumeDialogProps) {
    const { t } = useTranslation();
    const pausing = kind === 'pause';
    return (
        <ShopDialog
            testID={`${testID}-dialog`}
            open={open}
            onClose={onClose}
            icon={pausing ? 'pause' : 'play'}
            title={t(
                pausing
                    ? 'commerce:subscription.pauseDialogTitle'
                    : 'commerce:subscription.resumeDialogTitle',
            )}
            description={t(
                pausing
                    ? 'commerce:subscription.pauseDialogBody'
                    : 'commerce:subscription.resumeDialogBody',
            )}
            actions={
                <>
                    <ShopDialogButton
                        testID={`${testID}-cancel`}
                        label={t('commerce:common.cancel')}
                        onPress={onClose}
                    />
                    <ShopDialogButton
                        testID={`${testID}-confirm`}
                        kind="brand"
                        icon={pausing ? 'pause' : 'play'}
                        label={t(
                            pausing
                                ? 'commerce:subscription.pauseConfirm'
                                : 'commerce:subscription.resumeConfirm',
                        )}
                        busy={pending}
                        onPress={onConfirm}
                    />
                </>
            }
        >
            <PlanSubject {...subject} testID={`${testID}-subject`} />
            {pausing ? (
                <ShopDialogConsequence
                    testID={`${testID}-consequence`}
                    icon="infoCircle"
                    title={t('commerce:subscription.pauseConsequenceTitle')}
                    body={t('commerce:subscription.pauseConsequenceOpen')}
                />
            ) : null}
            <DialogFailure error={error} testID={`${testID}-failure`} />
        </ShopDialog>
    );
}

/* ── cancellation ────────────────────────────────────────────────────────────────────────────── */

export interface CancelSubscriptionDialogProps {
    readonly open: boolean;
    readonly balance: SubscriptionBalance | undefined;
    /** Set once the cancellation has happened, so the dialog can say so. */
    readonly cancelled: boolean;
    /** The plan's name, which the board's title asks about: "Cancel Weekday Lean?". */
    readonly planName: string;
    /** The kitchen, under the plan's name on the pop-up's card. */
    readonly kitchenName?: string | undefined;
    /** The state before cancelling, as the card's tag. */
    readonly state?: SubscriptionState | undefined;
    readonly pending: boolean;
    /** The refusal of the last attempt, drawn inside the dialog ({@link DialogFailure}). */
    readonly error?: unknown;
    readonly onClose: () => void;
    readonly onConfirm: () => void;
    readonly testID?: string | undefined;
}

/**
 * "Cancel this subscription." It states what stops, and promises no money: a subscription is paid per
 * delivery, so nothing is held and nothing comes back.
 */
export function CancelSubscriptionDialog({
    open,
    balance,
    cancelled,
    planName,
    kitchenName,
    state = 'active',
    pending,
    error,
    onClose,
    onConfirm,
    testID = 'subscription-cancel',
}: CancelSubscriptionDialogProps) {
    const { t } = useTranslation();

    const remaining = balance?.days.remaining ?? 0;
    const subject = (
        <ShopDialogSubject
            testID={`${testID}-subject`}
            lead={<ShopDialogTile icon="leaf" />}
            name={planName}
            tag={
                cancelled ? (
                    <ShopDialogTag label={t('commerce:states.cancelled')} tone="muted" />
                ) : (
                    <ShopDialogTag label={t(`commerce:states.${state}`)} />
                )
            }
            meta={kitchenName}
            end={
                cancelled || balance === undefined ? undefined : (
                    <RNText className="pe-1 font-display text-base font-bold text-content-primary">
                        {t('commerce:subscription.dialog.daysLeft', { count: remaining })}
                    </RNText>
                )
            }
        />
    );

    /*
     * The board draws the two moments as two pop-ups (Shop · Subscription, pins 11 and 12): the
     * question on a danger head, then "Subscription cancelled" on a plain one. Here they are one
     * dialog whose head and body change once the cancellation has happened.
     */
    return (
        <ShopDialog
            testID={`${testID}-dialog`}
            open={open}
            onClose={onClose}
            tone={cancelled ? 'brand' : 'danger'}
            icon={cancelled ? 'check' : 'circleX'}
            title={
                cancelled
                    ? t('commerce:cancel.doneTitle')
                    : t('commerce:cancel.titleNamed', { plan: planName })
            }
            description={cancelled ? t('commerce:cancel.doneBody') : t('commerce:cancel.body')}
            actions={
                !cancelled ? (
                    <>
                        <ShopDialogButton
                            testID={`${testID}-dismiss`}
                            label={t('commerce:cancel.keep')}
                            onPress={onClose}
                        />
                        <ShopDialogButton
                            testID={`${testID}-confirm`}
                            kind="danger"
                            label={t('commerce:cancel.confirm')}
                            busy={pending}
                            onPress={onConfirm}
                        />
                    </>
                ) : (
                    <ShopDialogButton
                        testID={`${testID}-done`}
                        kind="brand"
                        label={t('commerce:common.close')}
                        onPress={onClose}
                    />
                )
            }
        >
            {subject}
            {!cancelled ? (
                <>
                    <ShopDialogConsequence
                        testID={`${testID}-consequence`}
                        icon="calendar"
                        title={t('commerce:cancel.consequenceTitle')}
                        body={t('commerce:cancel.consequenceBody', { count: remaining })}
                    />
                    <DialogFailure error={error} testID={`${testID}-failure`} />
                </>
            ) : (
                <View testID={`${testID}-result`} role="status" />
            )}
        </ShopDialog>
    );
}

/* ── weekdays ────────────────────────────────────────────────────────────────────────────────── */

export interface WeekdayEditorProps {
    readonly quote: SubscriptionQuote | undefined;
    readonly balance: SubscriptionBalance | undefined;
    readonly selected: readonly number[];
    readonly pending: boolean;
    /** The refusal of the last attempt, drawn under the buttons ({@link DialogFailure}). */
    readonly error?: unknown;
    readonly onChange: (weekdays: readonly number[]) => void;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
    readonly testID?: string | undefined;
}

/**
 * Which weekdays this subscription delivers on — the Subscription board's inline editor, opened by
 * the Delivery days tile's Change.
 *
 * ## The choices come from the plan, in one request
 *
 * Every day button here is a weekday the plan actually delivers on, read from
 * `CommerceRepository.getSubscriptionQuote`. The previous implementation discovered the same list by
 * pricing seven hypothetical subscriptions and reading which answers carried an "unavailable"
 * warning — honest, and seven round trips for a fact that was on the plan record all along. While
 * the quote is loading, no day is offered rather than all seven: offering a day the plan refuses,
 * and finding out on save, is the failure this read exists to prevent.
 *
 * ## And it says when the change lands
 *
 * Not "immediately". Deliveries inside the cut-off window proceed as scheduled (semantics §2), so a
 * change made the morning before tomorrow's delivery affects the one after it. The note states the
 * cut-off in hours, which is the plan's configuration rather than a constant this screen owns.
 */
export function WeekdayEditor({
    quote,
    balance,
    selected,
    pending,
    error,
    onChange,
    onCancel,
    onConfirm,
    testID = 'subscription-weekdays',
}: WeekdayEditorProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const available = quote?.availableWeekdays ?? [];
    const empty = selected.length === 0;

    return (
        <View testID={`${testID}-editor`} className="flex-col gap-2 pt-1">
            {available.length === 0 ? (
                <RNText testID={`${testID}-loading`} className="text-xs text-content-secondary">
                    {t('commerce:weekdays.loading')}
                </RNText>
            ) : (
                <View testID={`${testID}-chips`} className="flex-row flex-wrap gap-1.5">
                    {available.map((weekday) => {
                        const on = selected.includes(weekday);
                        return (
                            <Pressable
                                key={weekday}
                                testID={`${testID}-day-${String(weekday)}`}
                                role="checkbox"
                                aria-checked={on}
                                accessibilityState={{ checked: on }}
                                accessibilityLabel={t(weekdayKey(weekday))}
                                onPress={() => {
                                    onChange(
                                        on
                                            ? selected.filter((value) => value !== weekday)
                                            : [...selected, weekday].sort(
                                                  (left, right) => left - right,
                                              ),
                                    );
                                }}
                                className={cx(
                                    'h-[34px] min-w-[34px] items-center justify-center rounded-xl border-[1.5px] px-1',
                                    on
                                        ? 'border-surface-brand bg-surface-brand'
                                        : 'border-stroke bg-surface-raised hover:border-surface-brand',
                                )}
                            >
                                <RNText
                                    className={cx(
                                        'text-xs font-bold',
                                        on ? 'text-content-on-brand' : 'text-content-primary',
                                    )}
                                >
                                    {shortWeekday(weekday, formatter.formatDate)}
                                </RNText>
                            </Pressable>
                        );
                    })}
                </View>
            )}

            {/* A refusal the server would make anyway, said before the round trip. */}
            {empty ? (
                <RNText testID={`${testID}-empty`} className="text-xs text-danger-on-subtle">
                    {t('commerce:weekdays.chooseOne')}
                </RNText>
            ) : null}

            <View testID={`${testID}-cutoff`} className="flex-row items-center gap-1.5">
                <Icon name="clock" size="sm" className="text-content-secondary" />
                <RNText className="shrink text-xs leading-4 text-content-secondary text-start">
                    {t('commerce:weekdays.hint', {
                        count: balance?.changeCutoffHours ?? quote?.changeCutoffHours ?? 24,
                    })}
                </RNText>
            </View>

            <View className="flex-row gap-1.5">
                <EditorButton
                    testID={`${testID}-confirm`}
                    label={t('commerce:subscription.board.save')}
                    tone="primary"
                    pending={pending}
                    disabled={empty || available.length === 0}
                    onPress={onConfirm}
                />
                <EditorButton
                    testID={`${testID}-cancel`}
                    label={t('commerce:common.cancel')}
                    onPress={onCancel}
                />
            </View>

            <InlineFailure error={error} onRetry={onConfirm} testID={`${testID}-failure`} />
        </View>
    );
}

/**
 * The weekday's short name in the reader's locale — "Mon" — from a Monday-anchored week, so the
 * board's day boxes need no catalogue of their own.
 */
export function shortWeekday(
    weekday: number,
    formatDate: (value: string, options: Intl.DateTimeFormatOptions) => string,
): string {
    // 2024-01-01 was a Monday, so ISO weekday n is 2024-01-0n.
    const date = `2024-01-0${String(weekday)}`;
    const short = formatDate(date, { weekday: 'short' });
    // Some locales' "short" is the whole word (Arabic's is); a box takes the narrow letter then.
    return short.length > 3 ? formatDate(date, { weekday: 'narrow' }) : short;
}

/** The editors' small pill buttons: Save beside Cancel, 32px, as the board's Change pill. */
export function EditorButton({
    testID,
    label,
    tone = 'neutral',
    pending = false,
    disabled = false,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly tone?: 'primary' | 'neutral';
    readonly pending?: boolean;
    readonly disabled?: boolean;
    readonly onPress: () => void;
}) {
    const inert = disabled || pending;
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            disabled={inert}
            aria-disabled={inert}
            aria-busy={pending}
            accessibilityState={{ disabled: inert, busy: pending }}
            onPress={onPress}
            className={cx(
                'h-8 flex-row items-center justify-center gap-1.5 rounded-full border px-3',
                tone === 'primary'
                    ? 'border-content-primary bg-content-primary'
                    : 'border-stroke bg-surface-raised hover:bg-surface-brand-subtle',
                inert ? 'opacity-50' : '',
            )}
        >
            {pending ? <ActivityIndicator size="small" /> : null}
            <RNText
                className={cx(
                    'text-xs font-semibold',
                    tone === 'primary' ? 'text-surface-base' : 'text-content-primary',
                )}
            >
                {label}
            </RNText>
        </Pressable>
    );
}
