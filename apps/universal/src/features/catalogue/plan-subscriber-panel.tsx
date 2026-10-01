import { Button, Dialog, cx, useBreakpoint, useToast } from '@healthy360/design-system';
import type { Subscription } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import {
    usePauseSubscriptionMutation,
    useResumeSubscriptionMutation,
    useSkipDayMutation,
    useSubscriptionBalanceQuery,
} from '../../data/commerce-hooks.ts';
import { toFailure } from '../../data/hooks.ts';
import { usePrototypeAction } from '../../prototype/index.ts';
import { Eyebrow } from '../../ui/eyebrow.tsx';
import { canPauseOrSkip, canResume } from '../commerce/state-badge.tsx';
import { InfoNote, SubtleButton } from './plan-controls.tsx';

/**
 * The band under the plan cards for somebody who already holds a plan — HealthZone's "Your week ·
 * dates" card beside its "Active subscription" card, in the design's `1fr 340px` split.
 *
 * ## Every figure is the subscription's own
 *
 * The week is the seven days around the next delivery, each tile marked from the subscription's
 * weekdays and its skipped dates. The summary rows are its plan, weekdays, next delivery and
 * balance, and the change cut-off is the plan's `changeCutoffHours` from the balance read.
 *
 * Where the drawing names something the platform does not have, the slot stays and says so:
 *
 * - **The dish per day.** There is no read of a subscription's meal choices (only the write), so a
 *   delivery tile says "Delivery" where the design names a dish, and the date where it gives macros.
 * - **"Next charge".** A plan is a balance bought up front — nothing is charged on a schedule — so
 *   the row reads "None scheduled" rather than inventing a billing date.
 * - **"Shuffle my week"** has no endpoint, so it goes through the prototype mechanism.
 *
 * ## The two lifecycle actions are real
 *
 * "Skip next week" becomes "Skip next delivery": the platform skips one delivery at a time
 * (`POST /subscriptions/{id}/skip` takes a date), so the button skips the next one. "Pause" pauses
 * until resumed, and on a paused plan the same place offers "Resume". Each asks first — a skip
 * cannot be undone from here — and a refusal (inside the cut-off, say) is reported as the server
 * worded it. "Set dietary rules" opens the allergy and diet profile every plan is matched against.
 */
export interface PlanSubscriberPanelProps {
    readonly subscription: Subscription;
}

/** A Monday, so `REFERENCE_MONDAY + (n − 1)` is ISO weekday `n` for the weekday-name formatter. */
const REFERENCE_MONDAY = new Date(2024, 0, 1);

export function weekdayName(formatter: Formatter, isoWeekday: number, width: 'short' | 'long') {
    const date = new Date(
        REFERENCE_MONDAY.getFullYear(),
        REFERENCE_MONDAY.getMonth(),
        REFERENCE_MONDAY.getDate() + isoWeekday - 1,
    );
    return formatter.formatDate(date, { weekday: width });
}

/** A `YYYY-MM-DD` date as a local calendar day — `new Date('2026-10-05')` would be UTC midnight. */
function localDay(isoDate: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    if (match === null) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isoDay(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${String(date.getFullYear())}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** "Oct 5–11", or "Sep 28–Oct 4" across a month boundary — the design's week label. */
export function weekRangeLabel(formatter: Formatter, start: Date, end: Date): string {
    const from = formatter.formatDate(start, { month: 'short', day: 'numeric' });
    const to =
        start.getMonth() === end.getMonth()
            ? formatter.formatNumber(end.getDate())
            : formatter.formatDate(end, { month: 'short', day: 'numeric' });
    return `${from}–${to}`;
}

type TileKind = 'delivery' | 'skipped' | 'off';

function SummaryRow({ label, value, testID }: { label: string; value: string; testID: string }) {
    return (
        <View testID={testID} className="flex-row items-baseline justify-between gap-3">
            <RNText className="shrink text-sm text-content-secondary text-start">{label}</RNText>
            <RNText className="shrink text-sm font-semibold tabular-nums text-content-primary text-end">
                {value}
            </RNText>
        </View>
    );
}

function Card({ children, testID }: { readonly children: ReactNode; readonly testID: string }) {
    return (
        <View
            testID={testID}
            className="flex-col rounded-panel border border-stroke bg-surface-raised p-5"
        >
            {children}
        </View>
    );
}

export function PlanSubscriberPanel({ subscription }: PlanSubscriberPanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const toast = useToast();
    const prototype = usePrototypeAction();
    const { atLeast } = useBreakpoint();

    const pause = usePauseSubscriptionMutation();
    const resume = useResumeSubscriptionMutation();
    const skipDay = useSkipDayMutation();
    const balance = useSubscriptionBalanceQuery(subscription.id);
    const [dialog, setDialog] = useState<'skip' | 'pause' | 'resume' | null>(null);

    const weekdays = new Set(subscription.configuration.deliveryWeekdays);
    const skipped = new Set(subscription.skippedDates);
    const next =
        subscription.nextDeliveryDate === null ? null : localDay(subscription.nextDeliveryDate);

    // The week drawn is the one the next delivery falls in, Monday first; with nothing scheduled,
    // this week.
    const anchor = next ?? new Date();
    const monday = addDays(
        new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()),
        -((anchor.getDay() + 6) % 7),
    );
    const days = [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
        const date = addDays(monday, weekday - 1);
        const kind: TileKind = !weekdays.has(weekday)
            ? 'off'
            : skipped.has(isoDay(date))
              ? 'skipped'
              : 'delivery';
        return { weekday, date, kind };
    });

    const close = () => {
        setDialog(null);
    };
    const report = (error: unknown) => {
        const failure = toFailure(error);
        toast.show({
            tone: 'danger',
            message:
                failure === null
                    ? t('commerce:subscription.actionFailedTitle')
                    : `${t('commerce:subscription.actionFailedTitle')} — ${failure.message}`,
            testID: 'plans-subscriber-error',
        });
    };

    const nextLabel =
        next === null
            ? null
            : formatter.formatDate(next, { weekday: 'long', month: 'short', day: 'numeric' });
    const cutoffHours = balance.data?.changeCutoffHours;
    const isPaused = canResume(subscription.state);
    const canSkip = canPauseOrSkip(subscription.state) && subscription.nextDeliveryDate !== null;

    const week = (
        <Card testID="plans-subscriber-week">
            <View className="flex-row flex-wrap items-baseline justify-between gap-2.5">
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="font-display text-lg font-bold tracking-display text-content-primary text-start"
                >
                    {t('catalogue:plans.subscriber.weekTitle', {
                        range: weekRangeLabel(formatter, monday, addDays(monday, 6)),
                    })}
                </RNText>
                <Eyebrow testID="plans-subscriber-week-count">
                    {t('catalogue:plans.subscriber.weekCount', { count: weekdays.size })}
                </Eyebrow>
            </View>
            <View className="mt-4 flex-row gap-2">
                {days.map(({ weekday, date, kind }) => {
                    const on = kind !== 'off';
                    const dayName = weekdayName(formatter, weekday, 'long');
                    return (
                        <View
                            key={weekday}
                            testID={`plans-subscriber-day-${String(weekday)}`}
                            accessibilityRole="text"
                            accessibilityLabel={t(`catalogue:plans.subscriber.day.${kind}`, {
                                day: dayName,
                            })}
                            className={cx(
                                'min-h-[104px] min-w-0 flex-1 flex-col gap-1.5 rounded-lg p-2 md:p-3',
                                on
                                    ? 'border border-stroke bg-surface-sunken'
                                    : 'border border-dashed border-stroke-strong bg-surface-raised',
                            )}
                        >
                            <Eyebrow tone={kind === 'delivery' ? 'brand' : 'secondary'}>
                                {weekdayName(formatter, weekday, 'short')}
                            </Eyebrow>
                            {/* The words need a tile wide enough to hold them; on a phone the
                                tile's own fill and border say it. */}
                            {atLeast('md') ? (
                                <RNText
                                    numberOfLines={3}
                                    className={cx(
                                        'text-sm font-semibold leading-snug text-start',
                                        kind === 'delivery'
                                            ? 'text-content-primary'
                                            : 'text-content-secondary',
                                    )}
                                >
                                    {t(`catalogue:plans.subscriber.tile.${kind}`)}
                                </RNText>
                            ) : null}
                            <RNText className="mt-auto text-xs tabular-nums text-content-secondary text-start">
                                {atLeast('md')
                                    ? formatter.formatDate(date, { month: 'short', day: 'numeric' })
                                    : formatter.formatNumber(date.getDate())}
                            </RNText>
                        </View>
                    );
                })}
            </View>
            <View className="mt-4 flex-row flex-wrap gap-2">
                <SubtleButton
                    testID="plans-subscriber-shuffle"
                    label={t('catalogue:plans.subscriber.shuffle')}
                    onPress={() => {
                        prototype({
                            contract:
                                'POST /api/v1/subscriptions/{subscription}/meal-choices/shuffle',
                        });
                    }}
                />
                <Button
                    testID="plans-subscriber-dietary"
                    variant="secondary"
                    size="sm"
                    label={t('catalogue:plans.subscriber.dietaryRules')}
                    onPress={() => {
                        router.push('/customer/account/allergies' as never);
                    }}
                />
            </View>
        </Card>
    );

    const summary = (
        <Card testID="plans-subscriber-summary">
            <View className="flex-col gap-1">
                <Eyebrow testID="plans-subscriber-state">
                    {t(
                        isPaused
                            ? 'catalogue:plans.subscriber.eyebrowPaused'
                            : 'catalogue:plans.subscriber.eyebrowActive',
                    )}
                </Eyebrow>
                <RNText
                    testID="plans-subscriber-plan"
                    className="font-display text-lg font-bold tracking-display text-content-primary text-start"
                >
                    {t('catalogue:plans.subscriber.planTitle', {
                        plan: subscription.planName,
                        count: weekdays.size,
                    })}
                </RNText>
            </View>
            <View className="mt-3 flex-col gap-3">
                <SummaryRow
                    testID="plans-subscriber-plan-row"
                    label={t('catalogue:plans.subscriber.plan')}
                    value={subscription.planName}
                />
                <SummaryRow
                    testID="plans-subscriber-days"
                    label={t('catalogue:plans.subscriber.deliveryDays')}
                    value={t('catalogue:plans.subscriber.deliveryDaysValue', {
                        count: weekdays.size,
                    })}
                />
                <SummaryRow
                    testID="plans-subscriber-charge"
                    label={t('catalogue:plans.subscriber.nextCharge')}
                    value={t('catalogue:plans.subscriber.nextChargeValue')}
                />
                <SummaryRow
                    testID="plans-subscriber-next"
                    label={t('catalogue:plans.subscriber.nextDelivery')}
                    value={nextLabel ?? t('catalogue:plans.subscriber.noNextDelivery')}
                />
                <SummaryRow
                    testID="plans-subscriber-balance"
                    label={t('catalogue:plans.subscriber.balance')}
                    value={t('catalogue:plans.subscriber.balanceValue', {
                        remaining: formatter.formatNumber(subscription.days.remaining),
                        total: formatter.formatNumber(subscription.days.total),
                    })}
                />
                <SummaryRow
                    testID="plans-subscriber-cutoff"
                    label={t('catalogue:plans.subscriber.cutoff')}
                    value={
                        cutoffHours === undefined
                            ? t('catalogue:plans.subscriber.unknown')
                            : t('catalogue:plans.subscriber.cutoffValue', { count: cutoffHours })
                    }
                />
            </View>
            <InfoNote testID="plans-subscriber-note" className="mt-3">
                {t('catalogue:plans.subscriber.note')}
            </InfoNote>
            <View className="mt-3 flex-row gap-2">
                <View className="min-w-0 flex-1">
                    <Button
                        testID="plans-subscriber-skip"
                        variant="primary"
                        block
                        label={t('catalogue:plans.subscriber.skipNext')}
                        disabled={!canSkip}
                        onPress={() => {
                            setDialog('skip');
                        }}
                    />
                </View>
                {isPaused ? (
                    <Button
                        testID="plans-subscriber-resume"
                        variant="secondary"
                        label={t('catalogue:plans.subscriber.resume')}
                        onPress={() => {
                            setDialog('resume');
                        }}
                    />
                ) : (
                    <Button
                        testID="plans-subscriber-pause"
                        variant="secondary"
                        label={t('catalogue:plans.subscriber.pause')}
                        disabled={!canPauseOrSkip(subscription.state)}
                        onPress={() => {
                            setDialog('pause');
                        }}
                    />
                )}
            </View>
        </Card>
    );

    const dialogs = (
        <>
            <Dialog
                testID="plans-subscriber-skip-dialog"
                open={dialog === 'skip'}
                onClose={close}
                title={t('commerce:subscription.skipDialogTitle')}
                description={
                    nextLabel === null
                        ? t('commerce:subscription.skipDialogBody')
                        : t('commerce:subscription.skipDialogDated', { date: nextLabel })
                }
                actions={
                    <>
                        <Button
                            testID="plans-subscriber-skip-cancel"
                            variant="quiet"
                            label={t('commerce:common.cancel')}
                            onPress={close}
                        />
                        <Button
                            testID="plans-subscriber-skip-confirm"
                            label={t('commerce:subscription.skipConfirm')}
                            loading={skipDay.isPending}
                            onPress={() => {
                                const date = subscription.nextDeliveryDate;
                                if (date === null) return;
                                skipDay.mutate(
                                    { subscriptionId: subscription.id, request: { date } },
                                    {
                                        onSuccess: () => {
                                            close();
                                            toast.show({
                                                tone: 'success',
                                                message: t(
                                                    'catalogue:plans.subscriber.skippedToast',
                                                    {
                                                        date: nextLabel ?? date,
                                                    },
                                                ),
                                            });
                                        },
                                        onError: (error) => {
                                            close();
                                            report(error);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            />
            <Dialog
                testID="plans-subscriber-pause-dialog"
                open={dialog === 'pause'}
                onClose={close}
                title={t('commerce:subscription.pauseDialogTitle')}
                description={t('commerce:subscription.pauseDialogBody')}
                actions={
                    <>
                        <Button
                            testID="plans-subscriber-pause-cancel"
                            variant="quiet"
                            label={t('commerce:common.cancel')}
                            onPress={close}
                        />
                        <Button
                            testID="plans-subscriber-pause-confirm"
                            label={t('commerce:subscription.pauseConfirm')}
                            loading={pause.isPending}
                            onPress={() => {
                                pause.mutate(
                                    { subscriptionId: subscription.id },
                                    {
                                        onSuccess: () => {
                                            close();
                                            toast.show({
                                                tone: 'success',
                                                message: t(
                                                    'catalogue:plans.subscriber.pausedToast',
                                                ),
                                            });
                                        },
                                        onError: (error) => {
                                            close();
                                            report(error);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            />
            <Dialog
                testID="plans-subscriber-resume-dialog"
                open={dialog === 'resume'}
                onClose={close}
                title={t('commerce:subscription.resumeDialogTitle')}
                description={t('commerce:subscription.resumeDialogBody')}
                actions={
                    <>
                        <Button
                            testID="plans-subscriber-resume-cancel"
                            variant="quiet"
                            label={t('commerce:common.cancel')}
                            onPress={close}
                        />
                        <Button
                            testID="plans-subscriber-resume-confirm"
                            label={t('commerce:subscription.resumeConfirm')}
                            loading={resume.isPending}
                            onPress={() => {
                                resume.mutate(subscription.id, {
                                    onSuccess: () => {
                                        close();
                                        toast.show({
                                            tone: 'success',
                                            message: t('catalogue:plans.subscriber.resumedToast'),
                                        });
                                    },
                                    onError: (error) => {
                                        close();
                                        report(error);
                                    },
                                });
                            }}
                        />
                    </>
                }
            />
        </>
    );

    // A structural branch: beside each other from `lg` (the design's `1fr 340px`), stacked below.
    if (!atLeast('lg')) {
        return (
            <View testID="plans-subscriber" className="flex-col gap-4">
                {week}
                {summary}
                {dialogs}
            </View>
        );
    }

    return (
        <View testID="plans-subscriber" className="flex-row items-start gap-4">
            <View className="min-w-0 flex-1">{week}</View>
            <View className="w-[340px]">{summary}</View>
            {dialogs}
        </View>
    );
}
