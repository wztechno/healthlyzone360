import { Text, cx } from '@healthy360/design-system';
import type { PlanDurationOption, SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, ScrollView, View } from 'react-native';

import { Eyebrow } from '../../ui/eyebrow.tsx';
import { PillChip } from '../../ui/pill-chip.tsx';
import { formatMoney } from '../marketplace/format.ts';
import {
    balanceDaysFor,
    cancellationCredit,
    effectiveDayPrice,
    nextMonday,
    simulateBalance,
} from './plan-balance.ts';
import type { BalanceCell, BalanceCellKind } from './plan-balance.ts';
import { cheapestVariant } from './plan-catalogue.ts';
import { InfoNote } from './plan-controls.tsx';
import { weekdayName, weekRangeLabel } from './plan-subscriber-panel.tsx';

/**
 * HealthZone's balance calculator, over the real catalogue: the PLAN / BALANCE SIZE / DELIVERY
 * WEEKDAYS chip groups, the four-figure strip, the week grid with its "Skip week" chips, the legend
 * and the refund note — in the design's order and shape.
 *
 * ## Same rules, real prices
 *
 * The plans, their calorie bands, their balances and their discounts are the published catalogue's,
 * and the arithmetic is `plan-balance.ts` — the server's rounding, the server's credit formula. The
 * design's own plan names, its 10/20/30-day sizes and its 5%/10% discounts are sample data and none
 * of them appears here: a balance is whatever a plan is actually sold in (7, 14, 28 or 84 days in
 * this build's vocabulary), at whatever discount its kitchen set. A plan with several calorie bands
 * shows them as a second row of chips in the PLAN group, because the band is what the price is.
 *
 * ## The week grid scrolls inside itself
 *
 * Ten columns do not fit a phone. Below 640 units the grid scrolls sideways inside its own frame,
 * the way the design lets it, so the page itself never scrolls horizontally.
 */

/** How many weeks are drawn — the design's own ceiling — before the rest is summarised in a line. */
const VISIBLE_WEEKS = 14;
/** The refund example cancels after this many weeks, as the design's does. */
const CANCEL_AFTER_WEEKS = 2;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
/** The design's starting pattern: Monday to Thursday, and the second week skipped. */
const DEFAULT_WEEKDAYS: readonly number[] = [1, 2, 3, 4];
const DEFAULT_SKIPPED: readonly number[] = [1];

export interface PlanBalanceCalculatorProps {
    readonly plans: readonly SubscriptionPlan[];
    readonly kitchenNameById: ReadonlyMap<string, string>;
    /** Injected so a test can pin the calendar; the screen passes today. */
    readonly today?: Date | undefined;
}

/** The middle balance a plan is sold in — the design opens on its middle size, not the smallest. */
function defaultDuration(plan: SubscriptionPlan): PlanDurationOption | undefined {
    return plan.durations[Math.floor(plan.durations.length / 2)] ?? plan.durations[0];
}

function ControlGroup({
    label,
    children,
}: {
    readonly label: string;
    readonly children: ReactNode;
}) {
    return (
        <View className="min-w-[240px] flex-1 basis-[240px] flex-col gap-2.5">
            <Eyebrow>{label}</Eyebrow>
            {children}
        </View>
    );
}

function Stat({
    label,
    value,
    note,
    testID,
}: {
    readonly label: string;
    readonly value: string;
    readonly note: string;
    readonly testID: string;
}) {
    return (
        <View
            testID={testID}
            className="min-w-[160px] flex-1 basis-[160px] flex-col border-e border-stroke-subtle bg-surface-base px-4 py-3"
        >
            <Eyebrow>{label}</Eyebrow>
            <RNText
                testID={`${testID}-value`}
                className="mt-1 font-display text-2xl font-bold tabular-nums tracking-display text-content-primary text-start"
            >
                {value}
            </RNText>
            <RNText className="mt-0.5 text-xs text-content-secondary text-start">{note}</RNText>
        </View>
    );
}

const CELL_CLASS: Readonly<Record<BalanceCellKind, string>> = {
    delivery: 'bg-surface-brand',
    skipped: 'border border-dashed border-stroke-strong',
    ended: 'border border-stroke',
    none: 'bg-surface-sunken',
};

const CELL_TEXT_CLASS: Readonly<Record<BalanceCellKind, string>> = {
    delivery: 'text-content-on-brand font-medium',
    skipped: 'text-content-secondary line-through',
    ended: 'text-content-secondary',
    none: 'text-content-secondary',
};

function Cell({ cell, formatter }: { readonly cell: BalanceCell; readonly formatter: Formatter }) {
    const { t } = useTranslation();
    return (
        <View
            accessibilityRole="text"
            accessibilityLabel={t('catalogue:howPlans.calculator.cellLabel', {
                date: formatter.formatDate(cell.date, {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                }),
                state: t(`catalogue:howPlans.calculator.cell.${cell.kind}`),
            })}
            className={cx(
                'h-[38px] min-w-0 flex-1 items-center justify-center rounded-lg',
                CELL_CLASS[cell.kind],
            )}
        >
            <RNText className={cx('text-xs tabular-nums', CELL_TEXT_CLASS[cell.kind])}>
                {formatter.formatNumber(cell.date.getDate())}
            </RNText>
        </View>
    );
}

function LegendSwatch({ kind, label }: { readonly kind: BalanceCellKind; readonly label: string }) {
    return (
        <View className="flex-row items-center gap-2">
            <View aria-hidden className={cx('h-3 w-3 rounded-sm', CELL_CLASS[kind])} />
            <Eyebrow>{label}</Eyebrow>
        </View>
    );
}

export function PlanBalanceCalculator({
    plans,
    kitchenNameById,
    today,
}: PlanBalanceCalculatorProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const [planId, setPlanId] = useState<string | null>(null);
    const [variantId, setVariantId] = useState<string | null>(null);
    const [durationKey, setDurationKey] = useState<string | null>(null);
    const [weekdays, setWeekdays] = useState<readonly number[]>(DEFAULT_WEEKDAYS);
    const [skipped, setSkipped] = useState<readonly number[]>(DEFAULT_SKIPPED);

    const plan = plans.find((candidate) => String(candidate.id) === planId) ?? plans[0];
    const variant =
        plan?.variants.find((candidate) => String(candidate.id) === variantId) ??
        (plan === undefined ? null : cheapestVariant(plan));
    const option =
        plan?.durations.find((candidate) => candidate.duration === durationKey) ??
        (plan === undefined ? undefined : defaultDuration(plan));

    // Fixed for the life of the page: a calendar that rolled over at midnight would move every row.
    const [start] = useState(() => nextMonday(today ?? new Date()));
    const days = option === undefined ? 0 : balanceDaysFor(option.duration);

    const simulation = simulateBalance({ days, weekdays, skippedWeeks: skipped, start });

    if (plan === undefined || variant === null || option === undefined) {
        return (
            <Text testID="plans-calculator-empty" tone="secondary">
                {t('catalogue:howPlans.calculator.empty')}
            </Text>
        );
    }

    const perDay = effectiveDayPrice(variant, option.discountPercent);
    const total = { amount: perDay.amount * days, currency: perDay.currency };
    const credit = cancellationCredit(simulation, days, CANCEL_AFTER_WEEKS, perDay);
    const visibleWeeks = simulation.weeks.slice(0, VISIBLE_WEEKS);
    const hiddenWeeks = simulation.weeks.length - visibleWeeks.length;
    const hasWeekdays = weekdays.length > 0;

    // Two kitchens may name a plan the same; only then does a chip carry its kitchen too.
    const nameCounts = new Map<string, number>();
    for (const candidate of plans) {
        nameCounts.set(candidate.name, (nameCounts.get(candidate.name) ?? 0) + 1);
    }
    const planLabel = (candidate: SubscriptionPlan) => {
        const kitchen = kitchenNameById.get(String(candidate.kitchenId));
        return (nameCounts.get(candidate.name) ?? 0) > 1 && kitchen !== undefined
            ? t('catalogue:howPlans.calculator.planOption', { plan: candidate.name, kitchen })
            : candidate.name;
    };

    const toggleWeekday = (weekday: number) => {
        setWeekdays((current) =>
            current.includes(weekday)
                ? current.filter((value) => value !== weekday)
                : [...current, weekday],
        );
    };
    const toggleSkip = (index: number) => {
        setSkipped((current) =>
            current.includes(index)
                ? current.filter((value) => value !== index)
                : [...current, index],
        );
    };

    return (
        <View testID="plans-calculator-body" className="flex-col">
            <View className="flex-row flex-wrap gap-6">
                <ControlGroup label={t('catalogue:howPlans.calculator.planLabel')}>
                    <View testID="plans-calculator-plans" className="flex-row flex-wrap gap-1.5">
                        {plans.map((candidate) => (
                            <PillChip
                                key={candidate.id}
                                size="sm"
                                floor="coarse"
                                testID={`plans-calculator-plan-${candidate.slug}`}
                                label={planLabel(candidate)}
                                selected={candidate.id === plan.id}
                                onPress={() => {
                                    setPlanId(String(candidate.id));
                                    // A band or a balance belongs to the plan it was picked on.
                                    setVariantId(null);
                                    setDurationKey(null);
                                }}
                            />
                        ))}
                    </View>
                    {plan.variants.length > 1 ? (
                        <View
                            testID="plans-calculator-bands"
                            className="flex-row flex-wrap gap-1.5"
                        >
                            {plan.variants.map((candidate) => (
                                <PillChip
                                    key={candidate.id}
                                    size="sm"
                                    floor="coarse"
                                    testID={`plans-calculator-band-${String(candidate.id)}`}
                                    label={t('catalogue:plans.energyBand', {
                                        min: formatter.formatNumber(candidate.energyRange.min),
                                        max: formatter.formatNumber(candidate.energyRange.max),
                                    })}
                                    selected={candidate.id === variant.id}
                                    onPress={() => {
                                        setVariantId(String(candidate.id));
                                    }}
                                />
                            ))}
                        </View>
                    ) : null}
                </ControlGroup>

                <ControlGroup label={t('catalogue:howPlans.calculator.sizeLabel')}>
                    <View testID="plans-calculator-sizes" className="flex-row flex-wrap gap-1.5">
                        {plan.durations.map((candidate) => {
                            const size = balanceDaysFor(candidate.duration);
                            return (
                                <PillChip
                                    key={candidate.duration}
                                    size="sm"
                                    floor="coarse"
                                    testID={`plans-calculator-size-${candidate.duration}`}
                                    label={
                                        candidate.discountPercent > 0
                                            ? t(
                                                  'catalogue:howPlans.calculator.sizeOptionDiscount',
                                                  {
                                                      count: size,
                                                      discount: formatter.formatNumber(
                                                          candidate.discountPercent,
                                                      ),
                                                  },
                                              )
                                            : t('catalogue:howPlans.calculator.sizeOption', {
                                                  count: size,
                                              })
                                    }
                                    selected={candidate.duration === option.duration}
                                    onPress={() => {
                                        setDurationKey(candidate.duration);
                                    }}
                                />
                            );
                        })}
                    </View>
                </ControlGroup>

                <ControlGroup label={t('catalogue:howPlans.calculator.weekdaysLabel')}>
                    <View testID="plans-calculator-weekdays" className="flex-row flex-wrap gap-1">
                        {WEEKDAYS.map((weekday) => (
                            <PillChip
                                key={weekday}
                                size="sm"
                                floor="coarse"
                                testID={`plans-calculator-weekday-${String(weekday)}`}
                                label={weekdayName(formatter, weekday, 'short')}
                                accessibilityLabel={weekdayName(formatter, weekday, 'long')}
                                selected={weekdays.includes(weekday)}
                                className="min-w-[50px]"
                                onPress={() => {
                                    toggleWeekday(weekday);
                                }}
                            />
                        ))}
                    </View>
                </ControlGroup>
            </View>

            <View
                testID="plans-calculator-stats"
                className="mt-6 flex-row flex-wrap overflow-hidden rounded-lg border border-stroke"
            >
                <Stat
                    testID="plans-calculator-per-day"
                    label={t('catalogue:howPlans.calculator.perDay')}
                    value={formatMoney(formatter, perDay)}
                    note={
                        option.discountPercent > 0
                            ? t('catalogue:howPlans.calculator.perDayDiscount', {
                                  discount: formatter.formatNumber(option.discountPercent),
                              })
                            : t('catalogue:howPlans.calculator.perDayLocked')
                    }
                />
                <Stat
                    testID="plans-calculator-total"
                    label={t('catalogue:howPlans.calculator.total')}
                    value={formatMoney(formatter, total)}
                    note={t('catalogue:howPlans.calculator.totalNote', {
                        count: days,
                        plan: plan.name,
                    })}
                />
                <Stat
                    testID="plans-calculator-lasts"
                    label={t('catalogue:howPlans.calculator.lasts')}
                    value={
                        hasWeekdays
                            ? t('catalogue:howPlans.calculator.lastsValue', {
                                  count: simulation.weeks.length,
                              })
                            : t('catalogue:howPlans.calculator.none')
                    }
                    note={t('catalogue:howPlans.calculator.lastsNote', {
                        perWeek: formatter.formatNumber(weekdays.length),
                        skipped: formatter.formatNumber(simulation.skippedWeeks),
                    })}
                />
                <Stat
                    testID="plans-calculator-last"
                    label={t('catalogue:howPlans.calculator.lastDelivery')}
                    value={
                        simulation.lastDelivery === null
                            ? t('catalogue:howPlans.calculator.none')
                            : formatter.formatDate(simulation.lastDelivery, {
                                  weekday: 'short',
                                  month: 'short',
                                  day: 'numeric',
                              })
                    }
                    note={t('catalogue:howPlans.calculator.lastDeliveryNote')}
                />
            </View>

            {hasWeekdays ? (
                <View className="mt-4 flex-col">
                    <ScrollView
                        horizontal
                        testID="plans-calculator-weeks"
                        contentContainerClassName="grow"
                        showsHorizontalScrollIndicator
                    >
                        <View className="min-w-[640px] flex-1 flex-col gap-2">
                            <View aria-hidden className="flex-row items-center gap-1.5">
                                <View className="w-[120px]" />
                                {WEEKDAYS.map((weekday) => (
                                    <View key={weekday} className="min-w-0 flex-1 items-center">
                                        <Eyebrow>
                                            {weekdayName(formatter, weekday, 'short')}
                                        </Eyebrow>
                                    </View>
                                ))}
                                <View className="w-[90px] items-end">
                                    <Eyebrow>{t('catalogue:howPlans.calculator.left')}</Eyebrow>
                                </View>
                                <View className="w-[100px]" />
                            </View>
                            {visibleWeeks.map((week) => (
                                <View
                                    key={week.index}
                                    testID={`plans-calculator-week-${String(week.index + 1)}`}
                                    className="flex-row items-center gap-1.5"
                                >
                                    <View className="w-[120px] flex-col">
                                        <RNText className="text-sm font-semibold text-content-primary text-start">
                                            {t('catalogue:howPlans.calculator.weekLabel', {
                                                n: formatter.formatNumber(week.index + 1),
                                            })}
                                        </RNText>
                                        <RNText className="text-xs text-content-secondary text-start">
                                            {weekRangeLabel(formatter, week.start, week.end)}
                                        </RNText>
                                    </View>
                                    {week.cells.map((cell) => (
                                        <Cell
                                            key={cell.weekday}
                                            cell={cell}
                                            formatter={formatter}
                                        />
                                    ))}
                                    <RNText
                                        testID={`plans-calculator-week-${String(week.index + 1)}-left`}
                                        className="w-[90px] text-sm font-semibold tabular-nums text-content-primary text-end"
                                    >
                                        {t('catalogue:howPlans.calculator.leftValue', {
                                            count: week.remaining,
                                        })}
                                    </RNText>
                                    <View className="w-[100px] items-end">
                                        <PillChip
                                            size="xs"
                                            floor="coarse"
                                            testID={`plans-calculator-week-${String(week.index + 1)}-skip`}
                                            label={
                                                week.skipped
                                                    ? t('catalogue:howPlans.calculator.skipped')
                                                    : t('catalogue:howPlans.calculator.skipWeek')
                                            }
                                            accessibilityLabel={t(
                                                'catalogue:howPlans.calculator.skipWeekNamed',
                                                {
                                                    n: formatter.formatNumber(week.index + 1),
                                                },
                                            )}
                                            selected={week.skipped}
                                            onPress={() => {
                                                toggleSkip(week.index);
                                            }}
                                        />
                                    </View>
                                </View>
                            ))}
                        </View>
                    </ScrollView>
                    {hiddenWeeks > 0 ? (
                        <RNText
                            testID="plans-calculator-more"
                            className="mt-2 text-xs text-content-secondary text-start"
                        >
                            {t('catalogue:howPlans.calculator.moreWeeks', { count: hiddenWeeks })}
                        </RNText>
                    ) : null}
                    <View className="mt-3 flex-row flex-wrap gap-4">
                        <LegendSwatch
                            kind="delivery"
                            label={t('catalogue:howPlans.calculator.legendDelivery')}
                        />
                        <LegendSwatch
                            kind="skipped"
                            label={t('catalogue:howPlans.calculator.legendSkipped')}
                        />
                        <LegendSwatch
                            kind="none"
                            label={t('catalogue:howPlans.calculator.legendNone')}
                        />
                    </View>
                </View>
            ) : null}

            <InfoNote testID="plans-calculator-credit" className="mt-4">
                {!hasWeekdays
                    ? t('catalogue:howPlans.calculator.pickWeekday')
                    : credit.unusedDays === 0
                      ? t('catalogue:howPlans.calculator.creditNone', {
                            used: formatter.formatNumber(credit.usedDays),
                        })
                      : t('catalogue:howPlans.calculator.credit', {
                            used: formatter.formatNumber(credit.usedDays),
                            unused: formatter.formatNumber(credit.unusedDays),
                            price: formatMoney(formatter, perDay),
                            credit: formatMoney(formatter, credit.credit),
                        })}
            </InfoNote>
        </View>
    );
}
