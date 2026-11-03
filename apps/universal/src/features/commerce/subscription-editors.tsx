import {
    Button,
    Callout,
    Dialog,
    FilterChip,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { SubscriptionBalance, SubscriptionQuote } from '@healthy360/api-client/contracts';
import { useTranslation } from 'react-i18next';

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
            title={t('commerce:cancel.title')}
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

export interface WeekdayEditorDialogProps {
    readonly open: boolean;
    readonly quote: SubscriptionQuote | undefined;
    readonly balance: SubscriptionBalance | undefined;
    readonly selected: readonly number[];
    readonly pending: boolean;
    /** The refusal of the last attempt, drawn inside the dialog ({@link DialogFailure}). */
    readonly error?: unknown;
    readonly onChange: (weekdays: readonly number[]) => void;
    readonly onClose: () => void;
    readonly onConfirm: () => void;
    readonly testID?: string | undefined;
}

/**
 * Which weekdays this subscription delivers on.
 *
 * ## The choices come from the plan, in one request
 *
 * Every chip here is a weekday the plan actually delivers on, read from
 * `CommerceRepository.getSubscriptionQuote`. The previous implementation discovered the same list by
 * pricing seven hypothetical subscriptions and reading which answers carried an "unavailable"
 * warning — honest, and seven round trips for a fact that was on the plan record all along. While
 * the quote is loading, no chip is offered rather than all seven: offering a day the plan refuses,
 * and finding out on save, is the failure this read exists to prevent.
 *
 * ## And the dialog says when the change lands
 *
 * Not "immediately". Deliveries inside the cut-off window proceed as scheduled (semantics §2), so a
 * change made the morning before tomorrow's delivery affects the one after it. The note states the
 * cut-off in hours, which is the plan's configuration rather than a constant this screen owns.
 */
export function WeekdayEditorDialog({
    open,
    quote,
    balance,
    selected,
    pending,
    error,
    onChange,
    onClose,
    onConfirm,
    testID = 'subscription-weekdays',
}: WeekdayEditorDialogProps) {
    const { t } = useTranslation();

    const available = quote?.availableWeekdays ?? [];
    const empty = selected.length === 0;

    return (
        <Dialog
            testID={`${testID}-dialog`}
            open={open}
            onClose={onClose}
            title={t('commerce:weekdays.title')}
            description={t('commerce:weekdays.body')}
            actions={
                <>
                    <Button
                        testID={`${testID}-cancel`}
                        variant="quiet"
                        label={t('commerce:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID={`${testID}-confirm`}
                        label={t('commerce:weekdays.confirm')}
                        loading={pending}
                        disabled={empty || available.length === 0}
                        onPress={onConfirm}
                    />
                </>
            }
        >
            <Stack space="md">
                {available.length === 0 ? (
                    <Text tone="secondary" testID={`${testID}-loading`}>
                        {t('commerce:weekdays.loading')}
                    </Text>
                ) : (
                    <Inline space="xs" wrap testID={`${testID}-chips`}>
                        {available.map((weekday) => (
                            <FilterChip
                                key={weekday}
                                testID={`${testID}-day-${String(weekday)}`}
                                label={t(weekdayKey(weekday))}
                                selected={selected.includes(weekday)}
                                onChange={(isSelected) => {
                                    onChange(
                                        isSelected
                                            ? [...selected, weekday].sort(
                                                  (left, right) => left - right,
                                              )
                                            : selected.filter((value) => value !== weekday),
                                    );
                                }}
                            />
                        ))}
                    </Inline>
                )}

                {/* A refusal the server would make anyway, said before the round trip. */}
                {empty ? (
                    <Text tone="danger" variant="caption" testID={`${testID}-empty`}>
                        {t('commerce:weekdays.chooseOne')}
                    </Text>
                ) : null}

                <Callout
                    testID={`${testID}-cutoff`}
                    role="note"
                    tone="info"
                    icon="info"
                    title={t('commerce:weekdays.cutOffTitle')}
                    body={t('commerce:weekdays.cutOffBody', {
                        count: balance?.changeCutoffHours ?? quote?.changeCutoffHours ?? 24,
                    })}
                />

                <DialogFailure error={error} testID={`${testID}-failure`} />
            </Stack>
        </Dialog>
    );
}
