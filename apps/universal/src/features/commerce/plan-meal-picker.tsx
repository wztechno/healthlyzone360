import { Icon, cx, useBreakpoint } from '@healthy360/design-system';
import type {
    MarketplaceMeal,
    MealSlot,
    PlanSitting,
    SubscriptionPlan,
} from '@healthy360/api-client/contracts';
import type { MealId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../media/entity-image.tsx';
import { publishedFigure } from '../catalogue/meal-readings.ts';
import { TINT_FILL, TINT_INK, TINT_INK_FILL } from '../catalogue/shelf-tints.ts';
import type { ShelfTint } from '../catalogue/shelf-tints.ts';
import { configuredDeliveryDates, fillWeek, pickKey, sittingsOf, weeksOf } from './configurator.ts';
import type { ConfiguratorState } from './configurator.ts';
import { clashingAllergens, useMyAllergenCodes } from './my-allergens.tsx';
import { SetupPane } from './plan-setup-frame.tsx';

const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * Choosing a dish for every sitting of every delivery day.
 *
 * The customer decides what they eat: a plan sells a number of meals a day, and each day of the run
 * is filled here, from any meal the kitchen publishes. {@link PlanDayMeals} is one day — the
 * configurator draws one per delivery date, and the subscription page draws the same row in its
 * day editor, so choosing at purchase and changing later look and behave alike.
 */

/** The translation key for one sitting's name. */
export function sittingLabelKey(slot: MealSlot): string {
    return `commerce:configurator.meals.slot.${slot}`;
}

/** "Lunch", or "Lunch 2" for a configuration's second lunch. */
export function useSittingLabel(): (sitting: PlanSitting) => string {
    const { t } = useTranslation();
    const formatter = useFormatter();
    return (sitting) =>
        sitting.sequence === 1
            ? t(sittingLabelKey(sitting.slot))
            : `${t(sittingLabelKey(sitting.slot))} ${formatter.formatNumber(sitting.sequence)}`;
}

/** The `slot:sequence` key a day's picks are held under. */
export function sittingKey(sitting: PlanSitting): string {
    return `${sitting.slot}:${String(sitting.sequence)}`;
}

/* ── the configurator's step ─────────────────────────────────────────────────────────────────── */

/** A sitting's colour, as the board's rows wear them. */
export const SITTING_TINT: Readonly<Record<MealSlot, ShelfTint>> = {
    breakfast: 'yellow',
    lunch: 'green',
    dinner: 'blue',
    snack: 'pink',
};

const ALL = 'all';

export interface MealsStepProps {
    readonly plan: SubscriptionPlan;
    readonly state: ConfiguratorState;
    readonly patch: (next: Partial<ConfiguratorState>) => void;
    readonly menu: readonly MarketplaceMeal[];
    readonly menuLoading: boolean;
    readonly showIssues: boolean;
}

/**
 * ③ Pick your meals — the accepted board's week grid.
 *
 * The run's delivery days a week at a time, behind week tabs (a tick on a week that is full). The
 * grid is the week's days across and the plan's sittings down; one cell is current — ringed — and a
 * dish from the list below fills it and moves on to the next empty cell. The bar between them names
 * the current cell and carries the quick actions: "Same all week" (this sitting's dish on every day
 * of the week), "Clear", "Fill the rest" (the week's empty cells from the person's own picks —
 * `fillWeek`) and "Clear week". The dishes are every meal the kitchen publishes, filtered by meal
 * type, each with how often it is already in the week and a warning when it crosses the person's
 * allergy list.
 */
export function MealsStep({ plan, state, patch, menu, menuLoading, showIssues }: MealsStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const sittingLabel = useSittingLabel();
    const { atLeast } = useBreakpoint();
    const mine = useMyAllergenCodes();
    const sittings = sittingsOf(plan, state);
    const dates = configuredDeliveryDates(state, plan);
    const weeks = weeksOf(dates);

    const [weekIndex, setWeekIndex] = useState(0);
    const [chosenCell, setChosenCell] = useState<readonly [number, number] | null>(null);
    const [filter, setFilter] = useState<string>(ALL);

    const week = weeks[Math.min(weekIndex, Math.max(weeks.length - 1, 0))] ?? [];
    const order: (readonly [number, number])[] = [];
    week.forEach((_, day) => {
        sittings.forEach((__, sitting) => {
            order.push([day, sitting] as const);
        });
    });
    const pickAt = (day: number, sitting: number, picks = state.mealPicks) => {
        const date = week[day];
        const which = sittings[sitting];
        return date === undefined || which === undefined ? undefined : picks[pickKey(date, which)];
    };
    const firstEmpty = order.find(([day, sitting]) => pickAt(day, sitting) === undefined);
    const [curDay, curSitting] =
        chosenCell !== null && chosenCell[0] < week.length && chosenCell[1] < sittings.length
            ? chosenCell
            : (firstEmpty ?? [0, 0]);
    const curDate = week[curDay];
    const curWhich = sittings[curSitting];
    const curPick = pickAt(curDay, curSitting);
    const curMeal = menu.find((meal) => meal.id === curPick);

    const weekPicked = order.filter(([day, sitting]) => pickAt(day, sitting) !== undefined).length;
    const weekFull = (dates: readonly string[]) =>
        dates.every((date) =>
            sittings.every((sitting) => state.mealPicks[pickKey(date, sitting)] !== undefined),
        );
    const anyPicked = dates.some((date) =>
        sittings.some((sitting) => state.mealPicks[pickKey(date, sitting)] !== undefined),
    );

    const used = new Map<string, number>();
    for (const [day, sitting] of order) {
        const id = pickAt(day, sitting);
        if (id !== undefined) used.set(String(id), (used.get(String(id)) ?? 0) + 1);
    }

    /** The next empty cell after the current one, going round the week. */
    const nextEmpty = (picks: typeof state.mealPicks): readonly [number, number] => {
        const at = order.findIndex(([day, sitting]) => day === curDay && sitting === curSitting);
        for (let step = 1; step <= order.length; step += 1) {
            const cell = order[(at + step) % order.length];
            if (cell !== undefined && pickAt(cell[0], cell[1], picks) === undefined) return cell;
        }
        return [curDay, curSitting] as const;
    };

    const write = (picks: Record<string, MealId>, move: boolean) => {
        patch({ mealPicks: picks });
        setChosenCell(move ? nextEmpty(picks) : [curDay, curSitting]);
    };

    const choose = (meal: MarketplaceMeal) => {
        if (curDate === undefined || curWhich === undefined) return;
        write({ ...state.mealPicks, [pickKey(curDate, curWhich)]: meal.id }, true);
    };

    const noon = (date: string) => `${date}T12:00:00Z`;
    const dayName = (date: string) =>
        formatter.formatDate(noon(date), { weekday: 'short', day: 'numeric', month: 'short' });

    const types = MEAL_SLOTS.filter((type) => menu.some((meal) => meal.mealTypes.includes(type)));
    const shown =
        filter === ALL ? menu : menu.filter((meal) => meal.mealTypes.includes(filter as MealSlot));
    const columns = atLeast('lg') ? 3 : atLeast('md') ? 2 : 1;
    const rows: MarketplaceMeal[][] = [];
    shown.forEach((meal, index) => {
        (rows[Math.floor(index / columns)] ??= []).push(meal);
    });

    return (
        <SetupPane
            testID="configurator-step-meals"
            title={t('commerce:configurator.meals.title')}
            titleEnd={
                <>
                    <View className="h-7 flex-row items-center rounded-full bg-surface-brand-subtle px-2.5">
                        <RNText
                            testID="configurator-meals-progress"
                            accessibilityLabel={t('commerce:configurator.meals.weekCount', {
                                done: formatter.formatNumber(weekPicked),
                                total: formatter.formatNumber(order.length),
                            })}
                            className="text-xs font-semibold tabular-nums text-content-on-brand-subtle"
                        >
                            <RNText className="font-display text-base font-bold">
                                {formatter.formatNumber(weekPicked)}
                            </RNText>
                            {`/${formatter.formatNumber(order.length)}`}
                        </RNText>
                    </View>
                    {weeks.length > 1 ? (
                        <View
                            role="tablist"
                            aria-label={t('commerce:configurator.meals.weeksLabel')}
                            className="ms-auto flex-row flex-wrap gap-1.5"
                        >
                            {weeks.map((each, index) => {
                                const on = index === weekIndex;
                                return (
                                    <Pressable
                                        key={each[0] ?? String(index)}
                                        testID={`configurator-meals-week-${String(index + 1)}`}
                                        role="tab"
                                        aria-selected={on}
                                        accessibilityState={{ selected: on }}
                                        onPress={() => {
                                            setWeekIndex(index);
                                            setChosenCell(null);
                                        }}
                                        className={cx(
                                            'h-10 flex-row items-center gap-1.5 rounded-xl border px-3',
                                            on
                                                ? 'border-content-primary bg-content-primary'
                                                : 'border-stroke-subtle bg-surface-raised hover:bg-surface-sunken',
                                        )}
                                    >
                                        <RNText
                                            className={cx(
                                                'text-sm font-semibold',
                                                on ? 'text-surface-base' : 'text-content-secondary',
                                            )}
                                        >
                                            {t('commerce:configurator.meals.week', {
                                                number: formatter.formatNumber(index + 1),
                                            })}
                                        </RNText>
                                        {weekFull(each) ? (
                                            <Icon
                                                name="check"
                                                size="sm"
                                                className={
                                                    on
                                                        ? 'text-surface-base'
                                                        : 'text-content-on-brand-subtle'
                                                }
                                            />
                                        ) : null}
                                    </Pressable>
                                );
                            })}
                        </View>
                    ) : null}
                </>
            }
        >
            {week.length === 0 || sittings.length === 0 ? (
                <RNText className="mt-4 text-base text-content-secondary text-start">
                    {t('commerce:configurator.meals.noDays')}
                </RNText>
            ) : (
                <>
                    {/* The week grid: days across, sittings down. */}
                    <View
                        testID={`configurator-meals-grid-${String(weekIndex + 1)}`}
                        role="group"
                        aria-label={t('commerce:configurator.meals.week', {
                            number: formatter.formatNumber(weekIndex + 1),
                        })}
                        className="mt-4 flex-col gap-2 rounded-[20px] bg-surface-base p-3"
                    >
                        <View className="flex-row gap-2">
                            <View className="w-[76px]" />
                            {week.map((date, day) => (
                                <View
                                    key={date}
                                    className="min-w-0 flex-1 flex-row items-baseline gap-1.5 px-1"
                                >
                                    <RNText
                                        className={cx(
                                            'font-display text-sm font-bold',
                                            day === curDay
                                                ? 'text-content-on-brand-subtle'
                                                : 'text-content-primary',
                                        )}
                                    >
                                        {formatter.formatDate(noon(date), { weekday: 'short' })}
                                    </RNText>
                                    <RNText
                                        numberOfLines={1}
                                        className="text-xs font-medium text-content-secondary"
                                    >
                                        {formatter.formatDate(noon(date), {
                                            day: 'numeric',
                                            month: 'short',
                                        })}
                                    </RNText>
                                </View>
                            ))}
                        </View>
                        {sittings.map((sitting, row) => {
                            const tint = SITTING_TINT[sitting.slot];
                            return (
                                <View
                                    key={sittingKey(sitting)}
                                    className="flex-row items-center gap-2"
                                >
                                    <View className="w-[76px] flex-row items-center gap-2">
                                        <View
                                            className={cx(
                                                'h-2 w-2 rounded-full',
                                                TINT_INK_FILL[tint],
                                            )}
                                        />
                                        <RNText
                                            numberOfLines={1}
                                            className="shrink text-xs font-semibold text-content-primary"
                                        >
                                            {sittingLabel(sitting)}
                                        </RNText>
                                    </View>
                                    {week.map((date, day) => {
                                        const id = state.mealPicks[pickKey(date, sitting)];
                                        const meal = menu.find((option) => option.id === id);
                                        const current = day === curDay && row === curSitting;
                                        const missing = showIssues && id === undefined;
                                        return (
                                            <Pressable
                                                key={date}
                                                testID={`configurator-meal-${date}-${sitting.slot}-${String(sitting.sequence)}`}
                                                role="button"
                                                accessibilityRole="button"
                                                aria-pressed={current}
                                                accessibilityState={{ selected: current }}
                                                accessibilityLabel={
                                                    meal === undefined
                                                        ? t(
                                                              'commerce:configurator.meals.cellEmpty',
                                                              {
                                                                  slot: sittingLabel(sitting),
                                                                  day: dayName(date),
                                                              },
                                                          )
                                                        : t(
                                                              'commerce:configurator.meals.cellFull',
                                                              {
                                                                  slot: sittingLabel(sitting),
                                                                  day: dayName(date),
                                                                  meal: meal.name,
                                                              },
                                                          )
                                                }
                                                onPress={() => {
                                                    setChosenCell([day, row]);
                                                }}
                                                className={cx(
                                                    'relative h-[76px] min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[14px] bg-surface-raised transition duration-normal ease-standard active:scale-95',
                                                    current
                                                        ? 'border-2 border-surface-brand'
                                                        : meal !== undefined
                                                          ? 'border-[1.5px] border-transparent'
                                                          : cx(
                                                                'border-[1.5px] border-dashed hover:border-surface-brand',
                                                                missing
                                                                    ? 'border-danger-border'
                                                                    : 'border-stroke',
                                                            ),
                                                )}
                                            >
                                                {meal === undefined ? (
                                                    <Icon
                                                        name="plus"
                                                        size="sm"
                                                        className={
                                                            current
                                                                ? 'text-content-on-brand-subtle'
                                                                : 'text-content-secondary'
                                                        }
                                                    />
                                                ) : (
                                                    <>
                                                        <View className="absolute bottom-0 end-0 start-0 top-0">
                                                            <EntityImage
                                                                assetId={meal.imagePlaceholderId}
                                                                photoUrl={meal.photoUrl}
                                                                variant="card"
                                                                seed={meal.slug}
                                                                label={meal.name}
                                                                decorative
                                                                flush
                                                                className="h-full w-full"
                                                            />
                                                        </View>
                                                        <View className="absolute bottom-1 end-1 start-1 h-5 justify-center rounded-[7px] bg-surface-raised/95 px-1.5">
                                                            <RNText
                                                                testID={`configurator-meal-${date}-${sitting.slot}-${String(sitting.sequence)}-value`}
                                                                numberOfLines={1}
                                                                className="text-xs font-semibold text-content-primary"
                                                            >
                                                                {meal.name}
                                                            </RNText>
                                                        </View>
                                                    </>
                                                )}
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            );
                        })}
                    </View>

                    {/* The current cell and the quick actions. */}
                    <View
                        testID="configurator-meals-now"
                        className="mt-3.5 min-h-14 flex-row flex-wrap items-center gap-2.5 rounded-2xl border border-stroke-subtle p-2 ps-3"
                    >
                        {curWhich === undefined ? null : (
                            <View
                                className={cx(
                                    'h-[26px] justify-center rounded-lg px-2.5',
                                    TINT_FILL[SITTING_TINT[curWhich.slot]],
                                )}
                            >
                                <RNText
                                    className={cx(
                                        'text-xs font-bold uppercase tracking-wide',
                                        TINT_INK[SITTING_TINT[curWhich.slot]],
                                    )}
                                >
                                    {sittingLabel(curWhich)}
                                </RNText>
                            </View>
                        )}
                        {curDate === undefined ? null : (
                            <RNText className="font-display text-base font-bold text-content-primary">
                                {dayName(curDate)}
                            </RNText>
                        )}
                        {curMeal === undefined ? null : (
                            <RNText
                                numberOfLines={1}
                                className="min-w-0 shrink text-sm text-content-secondary"
                            >
                                {`· ${curMeal.name}`}
                            </RNText>
                        )}
                        <View className="ms-auto flex-row flex-wrap gap-1.5">
                            {curPick === undefined || curWhich === undefined ? null : (
                                <>
                                    <MiniButton
                                        testID="configurator-meals-same"
                                        icon="refresh"
                                        label={t('commerce:configurator.meals.sameAllWeek')}
                                        onPress={() => {
                                            const next: Record<string, MealId> = {
                                                ...state.mealPicks,
                                            };
                                            for (const date of week)
                                                next[pickKey(date, curWhich)] = curPick;
                                            write(next, true);
                                        }}
                                    />
                                    <MiniButton
                                        testID="configurator-meals-clear"
                                        label={t('commerce:configurator.meals.clear')}
                                        onPress={() => {
                                            if (curDate === undefined) return;
                                            const next: Record<string, MealId> = {
                                                ...state.mealPicks,
                                            };
                                            delete next[pickKey(curDate, curWhich)];
                                            write(next, false);
                                        }}
                                    />
                                </>
                            )}
                            <MiniButton
                                testID="configurator-meals-fill"
                                icon="sparkle"
                                label={t('commerce:configurator.meals.fillRest')}
                                disabled={!anyPicked || weekPicked === order.length}
                                onPress={() => {
                                    write({ ...fillWeek(state, plan, week) }, true);
                                }}
                            />
                            {weekPicked === 0 ? null : (
                                <MiniButton
                                    testID="configurator-meals-clear-week"
                                    icon="close"
                                    tone="danger"
                                    label={t('commerce:configurator.meals.clearWeek', {
                                        number: formatter.formatNumber(weekIndex + 1),
                                    })}
                                    onPress={() => {
                                        const next: Record<string, MealId> = { ...state.mealPicks };
                                        for (const date of week) {
                                            for (const sitting of sittings)
                                                delete next[pickKey(date, sitting)];
                                        }
                                        patch({ mealPicks: next });
                                        setChosenCell([0, 0]);
                                    }}
                                />
                            )}
                        </View>
                    </View>

                    {/* The dishes, by meal type. */}
                    {types.length > 1 ? (
                        <View
                            role="tablist"
                            aria-label={t('commerce:configurator.meals.typeLabel')}
                            className="mt-3.5 flex-row flex-wrap gap-1.5"
                        >
                            {[ALL, ...types].map((type) => {
                                const on = filter === type;
                                const count =
                                    type === ALL
                                        ? menu.length
                                        : menu.filter((meal) =>
                                              meal.mealTypes.includes(type as MealSlot),
                                          ).length;
                                return (
                                    <Pressable
                                        key={type}
                                        testID={`configurator-dish-filter-${type}`}
                                        role="tab"
                                        aria-selected={on}
                                        accessibilityState={{ selected: on }}
                                        onPress={() => {
                                            setFilter(type);
                                        }}
                                        className={cx(
                                            'h-9 flex-row items-center gap-1.5 rounded-full border px-3.5',
                                            on
                                                ? 'border-content-primary bg-content-primary'
                                                : 'border-stroke-subtle bg-surface-raised hover:bg-surface-sunken',
                                        )}
                                    >
                                        <RNText
                                            className={cx(
                                                'text-sm font-semibold',
                                                on ? 'text-surface-base' : 'text-content-secondary',
                                            )}
                                        >
                                            {type === ALL
                                                ? t('commerce:configurator.meals.filterAll')
                                                : t(`marketplace:mealTypes.${type}`)}
                                        </RNText>
                                        <RNText
                                            className={cx(
                                                'text-xs tabular-nums opacity-75',
                                                on ? 'text-surface-base' : 'text-content-secondary',
                                            )}
                                        >
                                            {formatter.formatNumber(count)}
                                        </RNText>
                                    </Pressable>
                                );
                            })}
                        </View>
                    ) : null}

                    <View testID="configurator-dishes" className="mt-3 flex-col gap-2.5">
                        {menuLoading && menu.length === 0 ? (
                            <RNText className="text-sm text-content-secondary text-start">
                                {t('commerce:configurator.meals.loading')}
                            </RNText>
                        ) : null}
                        {rows.map((row, index) => (
                            <View key={row[0]?.id ?? String(index)} className="flex-row gap-2.5">
                                {Array.from({ length: columns }, (_, column) => {
                                    const meal = row[column];
                                    // The empty end of a short row is padded like a dish card, so the
                                    // row splits its width the same way the full rows do.
                                    if (meal === undefined) {
                                        return (
                                            <View
                                                key={column}
                                                aria-hidden
                                                className="min-w-0 flex-1 border-[1.5px] border-transparent p-1.5 pe-[50px]"
                                            />
                                        );
                                    }
                                    return (
                                        <DishCard
                                            key={meal.id}
                                            meal={meal}
                                            on={curPick === meal.id}
                                            times={used.get(String(meal.id)) ?? 0}
                                            clash={
                                                clashingAllergens(meal.allergens, mine).length > 0
                                            }
                                            testID={`configurator-dish-${meal.slug}`}
                                            accessibilityLabel={
                                                curWhich === undefined || curDate === undefined
                                                    ? meal.name
                                                    : t('commerce:configurator.meals.dishFor', {
                                                          meal: meal.name,
                                                          slot: sittingLabel(curWhich),
                                                          day: dayName(curDate),
                                                      })
                                            }
                                            onPress={() => {
                                                choose(meal);
                                            }}
                                        />
                                    );
                                })}
                            </View>
                        ))}
                    </View>
                </>
            )}
        </SetupPane>
    );
}

export interface DishCardProps {
    readonly meal: MarketplaceMeal;
    /** The dish already in the current cell. */
    readonly on: boolean;
    /** How often it is already in the week or day, as the corner count. */
    readonly times: number;
    /** It crosses the person's allergy list. */
    readonly clash: boolean;
    readonly accessibilityLabel: string;
    readonly onPress: () => void;
    readonly testID: string;
}

/**
 * One dish of the picker's list — the accepted Plan setup board's card, shared by the set-up's
 * Pick your meals and the subscription's Meals for a day: the photo, the name, its type and
 * calories, a warning when it crosses the allergy list, how often it is already used, and the +.
 */
export function DishCard({
    meal,
    on,
    times,
    clash,
    accessibilityLabel,
    onPress,
    testID,
}: DishCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const kcal = publishedFigure(meal, 'energy');
    const tag =
        meal.publishedCategory?.name ??
        (meal.mealTypes[0] === undefined ? null : t(`marketplace:mealTypes.${meal.mealTypes[0]}`));
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={onPress}
            className={cx(
                'group relative min-h-[72px] min-w-0 flex-1 flex-row items-center gap-2.5 rounded-2xl border-[1.5px] p-1.5 pe-[50px] transition duration-normal ease-standard hover:-translate-y-px active:scale-[0.98]',
                on
                    ? 'border-surface-brand bg-surface-brand-subtle'
                    : 'border-stroke-subtle bg-surface-raised hover:border-stroke',
            )}
        >
            <View className="h-[60px] w-[60px] overflow-hidden rounded-xl">
                <EntityImage
                    assetId={meal.imagePlaceholderId}
                    photoUrl={meal.photoUrl}
                    variant="card"
                    seed={meal.slug}
                    label={meal.name}
                    decorative
                    flush
                    className="h-full w-full"
                />
            </View>
            <View className="min-w-0 flex-1 flex-col gap-0.5">
                <RNText
                    numberOfLines={2}
                    className="text-sm font-bold leading-[18px] text-content-primary text-start"
                >
                    {meal.name}
                </RNText>
                <RNText numberOfLines={1} className="text-xs text-content-secondary text-start">
                    {[
                        tag,
                        kcal === null
                            ? null
                            : t('commerce:configurator.meals.kcal', {
                                  kcal: formatter.formatNumber(Math.round(kcal)),
                              }),
                    ]
                        .filter((part): part is string => part !== null)
                        .join(' · ')}
                </RNText>
                {clash ? (
                    <View
                        testID={`${testID}-clash`}
                        className="mt-0.5 h-[22px] flex-row items-center gap-1 self-start rounded-full bg-warning-subtle px-2"
                    >
                        <Icon name="alert" size="sm" className="text-warning-on-subtle" />
                        <RNText className="text-xs font-bold text-warning-on-subtle">
                            {t('commerce:configurator.meals.clash')}
                        </RNText>
                    </View>
                ) : null}
            </View>
            {times === 0 ? null : (
                <View className="absolute start-1 top-1 h-5 min-w-5 items-center justify-center rounded-full bg-content-primary px-1">
                    <RNText
                        testID={`${testID}-used`}
                        className="text-xs font-bold tabular-nums text-surface-base"
                    >
                        {t('commerce:configurator.meals.used', {
                            count: formatter.formatNumber(times),
                        })}
                    </RNText>
                </View>
            )}
            <View
                className={cx(
                    'absolute end-2.5 top-1/2 -mt-4 h-8 w-8 items-center justify-center rounded-full transition duration-normal ease-standard',
                    on
                        ? 'bg-surface-brand'
                        : 'bg-surface-brand-subtle group-hover:bg-surface-brand',
                )}
            >
                <Icon
                    name="plus"
                    size="sm"
                    className={
                        on
                            ? 'text-content-on-brand'
                            : 'text-content-on-brand-subtle group-hover:text-content-on-brand'
                    }
                />
            </View>
        </Pressable>
    );
}

/** The board's small bordered action button. */
function MiniButton({
    testID,
    label,
    icon,
    tone = 'neutral',
    disabled = false,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly icon?: 'refresh' | 'sparkle' | 'close' | undefined;
    readonly tone?: 'neutral' | 'danger';
    readonly disabled?: boolean;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
            className={cx(
                'h-[38px] flex-row items-center gap-1.5 rounded-[11px] border bg-surface-raised px-3',
                tone === 'danger'
                    ? 'border-danger-border hover:bg-danger-subtle'
                    : 'border-stroke hover:bg-surface-brand-subtle',
                disabled ? 'opacity-40' : '',
            )}
        >
            {icon === undefined ? null : (
                <Icon
                    name={icon}
                    size="sm"
                    className={tone === 'danger' ? 'text-danger-on-subtle' : 'text-content-primary'}
                />
            )}
            <RNText
                className={cx(
                    'text-sm font-semibold',
                    tone === 'danger' ? 'text-danger-on-subtle' : 'text-content-primary',
                )}
            >
                {label}
            </RNText>
        </Pressable>
    );
}
