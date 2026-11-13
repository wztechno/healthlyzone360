import { Icon, cx } from '@healthy360/design-system';
import type { PlanVariant, SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { formatMoney } from '../marketplace/format.ts';
import { useShopViewOnly } from '../marketplace/shop-view-only.tsx';
import { balanceDaysFor, balanceTotal, listDayPrice, maxDiscountPercent } from './plan-balance.ts';
import { cheapestVariant } from './plan-catalogue.ts';
import { TINT_FILL, TINT_INK, TINT_INK_FILL } from './shelf-tints.ts';
import type { ShelfTint } from './shelf-tints.ts';

/**
 * A subscription plan in the catalogue, as the accepted shop board draws it: a tinted head with the
 * plan's name, its calorie band and the price a day; then a day of the plan as a row of seven, its
 * meals a day, snacks a day and days, the whole-plan total, and Compare beside "Start this plan".
 *
 * ## Why the card is not itself pressable
 *
 * A plan card carries *three* controls — the name (the plan's page), Compare and Start — and a
 * toggle nested inside a button is unreachable by keyboard on the web, ambiguous to a screen reader,
 * and on touch it opens the plan when the person meant to tick "compare". So the card is a plain
 * grouping element with named controls inside it.
 *
 * ## Every figure is one the plan publishes
 *
 * The price is the cheapest configuration's per delivery day (`plan-price.tsx` explains the unit),
 * or the configuration the finder matched. The week row is what a delivery day of the plan holds —
 * the plan does not say which weekdays it delivers, the customer chooses that — so no day is drawn
 * as off. The balances it is sold in and the largest discount a longer one earns sit under the
 * total in one quiet line.
 */
export interface PlanCardProps {
    readonly plan: SubscriptionPlan;
    /** "Start this plan" — the screen decides where that goes. */
    readonly onOpen: () => void;
    /** The plan's own page, from its name. */
    readonly onView?: (() => void) | undefined;
    /** The kitchen's name, resolved by the screen — plans carry only a `kitchenId`. */
    readonly kitchenName?: string | undefined;
    /** The head's colour. */
    readonly tint?: ShelfTint | undefined;
    /** The configuration to quote — the finder's match; else the cheapest. */
    readonly variant?: PlanVariant | undefined;
    /** Marks the finder's best match. */
    readonly match?: boolean | undefined;
    /** Omit to render the card without a comparison control (the diet page does). */
    readonly comparison?:
        | {
              readonly selected: boolean;
              readonly onChange: (selected: boolean) => void;
              /** True once three plans are selected and this is not one of them. */
              readonly disabled: boolean;
          }
        | undefined;
    /** Present when the signed-in person holds a live subscription to this plan. */
    readonly current?: { readonly onManage: () => void } | undefined;
    readonly testID?: string | undefined;
}

/** The meals of a delivery day as coloured squares, the board's order: breakfast, lunch, dinner. */
const MEAL_DOTS: Readonly<Record<number, readonly ShelfTint[]>> = {
    1: ['green'],
    2: ['green', 'blue'],
    3: ['orange', 'green', 'blue'],
};

export function PlanCard({
    plan,
    onOpen,
    onView,
    kitchenName,
    tint = 'green',
    variant,
    match = false,
    comparison,
    current,
    testID,
}: PlanCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const id = testID ?? `plan-card-${plan.slug}`;
    // Staff only look: the button opens the same page, and says so (`shop-view-only.tsx`).
    const viewOnly = useShopViewOnly();

    const quoted = variant ?? cheapestVariant(plan);
    const firstOption = plan.durations[0];
    const discount = maxDiscountPercent(plan);
    const balances = plan.durations.map((option) =>
        formatter.formatNumber(balanceDaysFor(option.duration)),
    );
    const meals = quoted?.mealsPerDay ?? 0;
    const snacks = quoted?.snacksPerDay ?? 0;
    const dots: readonly ShelfTint[] = [
        ...(MEAL_DOTS[Math.min(3, Math.max(1, meals))] ?? []),
        ...(snacks > 0 ? (['pink'] as const) : []),
    ];
    const weekdays = [1, 2, 3, 4, 5, 6, 7].map((day) =>
        formatter.formatDate(`2024-01-0${String(day)}`, { weekday: 'narrow', timeZone: 'UTC' }),
    );

    return (
        <View
            testID={id}
            className={cx(
                'grow self-stretch flex-col overflow-hidden rounded-3xl border-2 bg-surface-raised',
                match || current !== undefined
                    ? 'border-surface-brand shadow-elevation-2'
                    : 'border-stroke-subtle',
            )}
        >
            <View className={cx('relative px-[18px] py-4', TINT_FILL[tint])}>
                {match && current === undefined ? (
                    <View
                        testID={`${id}-match`}
                        className="absolute end-3 top-3 h-[26px] flex-row items-center gap-1 rounded-full bg-surface-brand px-2.5"
                    >
                        <Icon name="check" size="sm" className="text-content-on-brand" />
                        <RNText className="text-xs font-bold uppercase tracking-wide text-content-on-brand">
                            {t('catalogue:plans.bestMatch')}
                        </RNText>
                    </View>
                ) : current !== undefined ? (
                    <View
                        testID={`${id}-current`}
                        className="absolute end-3 top-3 h-[26px] justify-center rounded-full bg-surface-brand px-2.5"
                    >
                        <RNText className="text-xs font-bold uppercase tracking-wide text-content-on-brand">
                            {t('catalogue:plans.currentPlan')}
                        </RNText>
                    </View>
                ) : null}

                <Icon name="calendarDays" className={TINT_INK[tint]} />
                <Pressable
                    testID={`${id}-name`}
                    role="link"
                    accessibilityRole="link"
                    disabled={onView === undefined}
                    onPress={onView}
                    className="mt-2 self-start"
                >
                    <RNText
                        accessibilityRole="header"
                        aria-level={3}
                        className={cx('font-display text-lg font-bold text-start', TINT_INK[tint])}
                    >
                        {plan.name}
                    </RNText>
                </Pressable>
                <RNText
                    testID={`${id}-tagline`}
                    numberOfLines={1}
                    className={cx('text-xs opacity-85 text-start', TINT_INK[tint])}
                >
                    {kitchenName === undefined || kitchenName === ''
                        ? plan.summary
                        : t('catalogue:plans.taglineWithKitchen', {
                              kitchen: kitchenName,
                              summary: plan.summary,
                          })}
                </RNText>
                {quoted === null || quoted === undefined ? null : (
                    <>
                        <View
                            testID={`${id}-bands`}
                            className="mt-2 h-6 flex-row items-center gap-1 self-start rounded-full bg-surface-raised px-2.5"
                        >
                            <Icon name="heartPulse" size="sm" className="text-content-primary" />
                            <RNText className="text-xs font-semibold tabular-nums text-content-primary">
                                {t('catalogue:plans.bandPerDay', {
                                    min: formatter.formatNumber(quoted.energyRange.min),
                                    max: formatter.formatNumber(quoted.energyRange.max),
                                })}
                            </RNText>
                        </View>
                        <View className="mt-3 flex-row items-baseline gap-1.5">
                            <RNText
                                testID={`${id}-price-amount`}
                                className={cx(
                                    'font-display text-3xl font-bold tabular-nums tracking-display',
                                    TINT_INK[tint],
                                )}
                            >
                                {formatMoney(formatter, listDayPrice(quoted))}
                            </RNText>
                            <RNText className={cx('text-sm font-semibold', TINT_INK[tint])}>
                                {t('catalogue:plans.aDay')}
                            </RNText>
                        </View>
                    </>
                )}
            </View>

            <View className="flex-1 flex-col gap-[11px] px-[18px] pb-4 pt-3.5">
                <View
                    aria-label={t('catalogue:plans.dayHolds', { count: meals })}
                    className="flex-row gap-[5px]"
                >
                    {weekdays.map((day, index) => (
                        <View
                            key={index}
                            className="flex-1 flex-col items-center gap-[3px] rounded-xl bg-surface-base pb-[5px] pt-1.5"
                        >
                            <RNText className="text-xs font-semibold text-content-secondary">
                                {day}
                            </RNText>
                            {dots.map((dot, dotIndex) => (
                                <View
                                    key={dotIndex}
                                    className={cx('h-[11px] w-[11px] rounded', TINT_INK_FILL[dot])}
                                />
                            ))}
                        </View>
                    ))}
                </View>

                <View className="flex-row gap-1.5">
                    {[
                        {
                            key: 'meals',
                            value: formatter.formatNumber(meals),
                            label: t('catalogue:plans.mealsADay'),
                        },
                        {
                            key: 'snacks',
                            value: formatter.formatNumber(snacks),
                            label: t('catalogue:plans.snacksADay'),
                        },
                        {
                            key: 'days',
                            value:
                                firstOption === undefined
                                    ? t('catalogue:card.noFigure')
                                    : formatter.formatNumber(balanceDaysFor(firstOption.duration)),
                            label: t('catalogue:plans.daysLabel'),
                        },
                    ].map((fact) => (
                        <View
                            key={fact.key}
                            testID={`${id}-${fact.key}`}
                            className="flex-1 flex-col items-center rounded-xl bg-surface-base px-0.5 py-1.5"
                        >
                            <RNText className="font-display text-base font-bold tabular-nums text-content-primary">
                                {fact.value}
                            </RNText>
                            <RNText className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
                                {fact.label}
                            </RNText>
                        </View>
                    ))}
                </View>

                {firstOption === undefined || quoted === null || quoted === undefined ? null : (
                    <View className="flex-col gap-0.5">
                        <View className="flex-row items-center justify-between">
                            <RNText className="text-sm text-content-secondary">
                                {t('catalogue:plans.wholePlan')}
                            </RNText>
                            <RNText
                                testID={`${id}-price-balance`}
                                className="font-display text-base font-bold tabular-nums text-content-primary"
                            >
                                {formatMoney(formatter, balanceTotal(quoted, firstOption))}
                            </RNText>
                        </View>
                        <RNText className="text-xs text-content-secondary text-start">
                            <RNText testID={`${id}-balances`}>
                                {t('catalogue:plans.featureBalances', {
                                    sizes: balances.join(' · '),
                                })}
                            </RNText>
                            {discount > 0 ? (
                                <RNText testID={`${id}-discount`}>
                                    {t('catalogue:plans.discountTail', {
                                        discount: formatter.formatNumber(discount),
                                    })}
                                </RNText>
                            ) : null}
                        </RNText>
                    </View>
                )}

                <View className="mt-auto flex-row items-center gap-2 pt-1">
                    {comparison === undefined ? null : (
                        <Pressable
                            testID={`${id}-compare`}
                            role="checkbox"
                            accessibilityRole="checkbox"
                            aria-checked={comparison.selected}
                            accessibilityState={{
                                checked: comparison.selected,
                                selected: comparison.selected,
                                disabled: comparison.disabled,
                            }}
                            accessibilityLabel={t('catalogue:plans.compareNamed', {
                                plan: plan.name,
                            })}
                            disabled={comparison.disabled}
                            onPress={() => {
                                comparison.onChange(!comparison.selected);
                            }}
                            className={cx(
                                'h-11 flex-row items-center gap-2 rounded-[14px] border-[1.5px] pe-3.5 ps-2.5',
                                comparison.selected
                                    ? 'border-surface-brand bg-surface-brand-subtle'
                                    : 'border-stroke',
                                comparison.disabled ? 'opacity-40' : '',
                            )}
                        >
                            <View
                                className={cx(
                                    'h-[22px] w-[22px] items-center justify-center rounded-[7px] border-2',
                                    comparison.selected
                                        ? 'border-surface-brand bg-surface-brand'
                                        : 'border-stroke',
                                )}
                            >
                                {comparison.selected ? (
                                    <Icon
                                        name="check"
                                        size="sm"
                                        className="text-content-on-brand"
                                    />
                                ) : null}
                            </View>
                            <RNText
                                className={cx(
                                    'text-sm font-semibold',
                                    comparison.selected
                                        ? 'text-content-on-brand-subtle'
                                        : 'text-content-primary',
                                )}
                            >
                                {t('catalogue:plans.compareLabel')}
                            </RNText>
                        </Pressable>
                    )}
                    {current === undefined ? (
                        <Pressable
                            testID={`${id}-open`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={t('catalogue:plans.choosePlan', {
                                plan: plan.name,
                            })}
                            onPress={onOpen}
                            className="h-11 flex-1 flex-row items-center justify-between rounded-[14px] bg-surface-brand px-4 hover:bg-surface-canopy"
                        >
                            <RNText className="text-sm font-bold text-content-on-brand">
                                {viewOnly
                                    ? t('catalogue:plans.viewPlanShort')
                                    : t('catalogue:plans.startPlan')}
                            </RNText>
                            <Icon
                                name="chevronForward"
                                size="sm"
                                className="text-content-on-brand"
                            />
                        </Pressable>
                    ) : (
                        <Pressable
                            testID={`${id}-manage`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={t('catalogue:plans.managePlanNamed', {
                                plan: plan.name,
                            })}
                            onPress={current.onManage}
                            className="h-11 flex-1 items-center justify-center rounded-[14px] border-[1.5px] border-surface-brand bg-surface-brand-subtle"
                        >
                            <RNText className="text-sm font-bold text-content-on-brand-subtle">
                                {t('catalogue:plans.managePlan')}
                            </RNText>
                        </Pressable>
                    )}
                </View>
            </View>
        </View>
    );
}
