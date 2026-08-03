import {
    Button,
    Callout,
    Dialog,
    FilterChip,
    Inline,
    Select,
    Stack,
    Text,
} from '@healthy360/design-system';
import type {
    CreditMemo,
    SubscriptionBalance,
    SubscriptionMealChoice,
    SubscriptionQuote,
} from '@healthy360/api-client/contracts';
import type { MealId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMoney, weekdayKey } from '../marketplace/format.ts';

/**
 * The three S1 editors, and the dialog that ends a subscription.
 *
 * Extracted from `screens/subscription-detail-screen.tsx` rather than added to it: the detail screen
 * was already the longest in the feature, and these three are each a small self-contained decision
 * with its own rule. Keeping them here means the rule and the control that enforces it are next to
 * each other.
 */

/* ── cancellation ────────────────────────────────────────────────────────────────────────────── */

export interface CancelSubscriptionDialogProps {
    readonly open: boolean;
    readonly balance: SubscriptionBalance | undefined;
    /** Set once the cancellation has happened, so the dialog can report what it produced. */
    readonly memo: CreditMemo | null | undefined;
    readonly pending: boolean;
    readonly onClose: () => void;
    readonly onConfirm: () => void;
    readonly testID?: string | undefined;
}

/**
 * "Cancel this subscription."
 *
 * ## It states the amount *before* the button, not after
 *
 * The refund is computable from data the screen already holds — remaining days × the effective
 * per-day price — so the dialog prints it as the consequence rather than revealing it on the
 * confirmation screen. A person deciding whether to cancel is deciding about that number, and
 * showing it afterwards would make the dialog a formality rather than a decision.
 *
 * The amount shown is a *statement of what will be recorded*, and the copy says so. It is not a
 * quotation the server has agreed to: the server recomputes it and answers with the memo it
 * actually wrote, which is what the success state then shows. When the two ever disagree, the
 * server's is the one on screen at the end.
 *
 * ## And it says settlement is manual
 *
 * Nothing in this system moves money. A credit memo is a record somebody settles by hand, and a
 * dialog that said "you will be refunded" would be promising a transfer no code performs. The
 * sentence is in the dialog and repeated on the receipt, because it is the part most likely to be
 * misremembered.
 */
export function CancelSubscriptionDialog({
    open,
    balance,
    memo,
    pending,
    onClose,
    onConfirm,
    testID = 'subscription-cancel',
}: CancelSubscriptionDialogProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const remaining = balance?.days.remaining ?? 0;
    const perDay = balance === undefined ? null : formatMoney(formatter, balance.perDayPrice);

    return (
        <Dialog
            testID={`${testID}-dialog`}
            open={open}
            onClose={onClose}
            title={t('commerce:cancel.title')}
            description={t('commerce:cancel.body')}
            actions={
                memo === undefined ? (
                    <>
                        <Button
                            testID={`${testID}-dismiss`}
                            variant="secondary"
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
                {memo === undefined ? (
                    <>
                        <Callout
                            testID={`${testID}-consequence`}
                            role="alert"
                            tone="warning"
                            icon="warning"
                            title={t('commerce:cancel.consequenceTitle')}
                            body={t('commerce:cancel.consequenceBody', { count: remaining })}
                        />

                        {remaining > 0 && perDay !== null && balance !== undefined ? (
                            <Text testID={`${testID}-estimate`}>
                                {t('commerce:cancel.estimate', {
                                    count: remaining,
                                    perDay,
                                    amount: formatMoney(formatter, {
                                        amount: remaining * balance.perDayPrice.amount,
                                        currency: balance.perDayPrice.currency,
                                    }),
                                })}
                            </Text>
                        ) : (
                            <Text tone="secondary" testID={`${testID}-no-refund`}>
                                {t('commerce:cancel.noRefund')}
                            </Text>
                        )}

                        <Text tone="secondary" variant="caption" testID={`${testID}-manual`}>
                            {t('commerce:cancel.manualSettlement')}
                        </Text>
                    </>
                ) : memo === null ? (
                    <Callout
                        testID={`${testID}-result-none`}
                        role="status"
                        tone="info"
                        title={t('commerce:cancel.doneTitle')}
                        body={t('commerce:cancel.doneNoMemo')}
                    />
                ) : (
                    <Stack space="sm">
                        <Callout
                            testID={`${testID}-result`}
                            role="status"
                            tone="success"
                            title={t('commerce:cancel.doneTitle')}
                            body={t('commerce:cancel.doneMemo', {
                                amount: formatMoney(formatter, memo.amount),
                                count: memo.unusedDays,
                            })}
                        />
                        <Text tone="secondary" variant="caption" testID={`${testID}-memo-manual`}>
                            {t('commerce:cancel.manualSettlement')}
                        </Text>
                    </Stack>
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
                        variant="secondary"
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
            </Stack>
        </Dialog>
    );
}

/* ── Free Selection ──────────────────────────────────────────────────────────────────────────── */

export interface MealChoiceOption {
    readonly id: MealId;
    readonly name: string;
}

export interface MealChoicesDialogProps {
    readonly open: boolean;
    readonly date: string | null;
    readonly options: readonly MealChoiceOption[];
    readonly current: readonly SubscriptionMealChoice[];
    readonly slotCode: string;
    readonly pending: boolean;
    readonly onClose: () => void;
    readonly onConfirm: (mealId: MealId) => void;
    readonly testID?: string | undefined;
}

/**
 * Choosing the meal for one delivery day, ahead of the cut-off.
 *
 * ## What the current state actually is
 *
 * A day nobody has chosen for is not empty — the kitchen has a default, and that default is what
 * will be cooked. So the dialog opens showing it, labelled as the kitchen's rather than the
 * person's. Presenting an unchosen day as blank would imply that not choosing means not eating.
 *
 * ## One slot, and the reason it is one
 *
 * `SubscriptionConfiguration` carries a single `slotCode`, so a day has one delivery and the editor
 * offers one choice. A plan with breakfast, lunch and dinner in separate slots would need the
 * configuration to publish them; inventing three rows from one code would be the interface making
 * up a shape the data does not have.
 */
export function MealChoicesDialog({
    open,
    date,
    options,
    current,
    slotCode,
    pending,
    onClose,
    onConfirm,
    testID = 'subscription-choices',
}: MealChoicesDialogProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const existing = current[0] ?? null;
    const [choice, setChoice] = useState<string | null>(null);
    const value = choice ?? (existing === null ? null : String(existing.mealId));

    return (
        <Dialog
            testID={`${testID}-dialog`}
            open={open}
            onClose={onClose}
            title={t('commerce:choices.title')}
            description={
                date === null
                    ? t('commerce:choices.body')
                    : t('commerce:choices.bodyDated', {
                          date: formatter.formatDate(date, { dateStyle: 'full' }),
                      })
            }
            actions={
                <>
                    <Button
                        testID={`${testID}-cancel`}
                        variant="secondary"
                        label={t('commerce:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID={`${testID}-confirm`}
                        label={t('commerce:choices.confirm')}
                        loading={pending}
                        disabled={value === null}
                        onPress={() => {
                            if (value !== null) onConfirm(value as MealId);
                        }}
                    />
                </>
            }
        >
            <Stack space="md">
                {existing === null ? null : (
                    <Text tone="secondary" variant="caption" testID={`${testID}-current`}>
                        {t(`commerce:choices.sources.${existing.source}`, {
                            meal: existing.mealName,
                        })}
                    </Text>
                )}

                <Select
                    testID={`${testID}-select`}
                    label={t('commerce:choices.selectLabel', {
                        slot: t(`commerce:slots.${slotCode}`, { defaultValue: slotCode }),
                    })}
                    value={value}
                    onChange={setChoice}
                    options={options.map((option) => ({
                        value: String(option.id),
                        label: option.name,
                    }))}
                />

                <Callout
                    testID={`${testID}-cutoff`}
                    role="note"
                    tone="info"
                    icon="info"
                    title={t('commerce:choices.cutOffTitle')}
                    body={t('commerce:choices.cutOffBody')}
                />
            </Stack>
        </Dialog>
    );
}
