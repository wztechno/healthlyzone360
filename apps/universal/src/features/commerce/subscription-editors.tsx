import { Button, Callout, Dialog, Stack, cx } from '@healthy360/design-system';
import type { SubscriptionBalance, SubscriptionQuote } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';

import { toFailure } from '../../data/commerce-hooks.ts';
import { weekdayKey } from '../marketplace/format.ts';

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

/* ── cancellation ────────────────────────────────────────────────────────────────────────────── */

export interface CancelSubscriptionDialogProps {
    readonly open: boolean;
    readonly balance: SubscriptionBalance | undefined;
    /** Set once the cancellation has happened, so the dialog can say so. */
    readonly cancelled: boolean;
    /** The plan's name, which the board's title asks about: "Cancel Weekday Lean?". */
    readonly planName: string;
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
    pending,
    error,
    onClose,
    onConfirm,
    testID = 'subscription-cancel',
}: CancelSubscriptionDialogProps) {
    const { t } = useTranslation();

    const remaining = balance?.days.remaining ?? 0;

    return (
        <Dialog
            testID={`${testID}-dialog`}
            open={open}
            onClose={onClose}
            title={t('commerce:cancel.titleNamed', { plan: planName })}
            description={t('commerce:cancel.body')}
            actions={
                !cancelled ? (
                    <>
                        <Button
                            testID={`${testID}-dismiss`}
                            variant="quiet"
                            label={t('commerce:cancel.keep')}
                            onPress={onClose}
                        />
                        <Button
                            testID={`${testID}-confirm`}
                            variant="danger"
                            label={t('commerce:cancel.confirm')}
                            loading={pending}
                            onPress={onConfirm}
                        />
                    </>
                ) : (
                    <Button
                        testID={`${testID}-done`}
                        label={t('commerce:common.close')}
                        onPress={onClose}
                    />
                )
            }
        >
            <Stack space="sm">
                {!cancelled ? (
                    <>
                        <Callout
                            testID={`${testID}-consequence`}
                            role="alert"
                            tone="warning"
                            icon="warning"
                            title={t('commerce:cancel.consequenceTitle')}
                            body={t('commerce:cancel.consequenceBody', { count: remaining })}
                        />

                        <DialogFailure error={error} testID={`${testID}-failure`} />
                    </>
                ) : (
                    <Callout
                        testID={`${testID}-result`}
                        role="status"
                        tone="success"
                        title={t('commerce:cancel.doneTitle')}
                        body={t('commerce:cancel.doneBody')}
                    />
                )}
            </Stack>
        </Dialog>
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

            <RNText testID={`${testID}-cutoff`} className="text-xs text-content-secondary">
                {t('commerce:weekdays.cutOffBody', {
                    count: balance?.changeCutoffHours ?? quote?.changeCutoffHours ?? 24,
                })}
            </RNText>

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

            <DialogFailure error={error} testID={`${testID}-failure`} />
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
