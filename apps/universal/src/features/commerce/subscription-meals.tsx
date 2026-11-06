import { FadeIn, Icon, cx, useBreakpoint, useToast } from '@healthy360/design-system';
import type {
    ChosenMeal,
    MarketplaceMeal,
    PlanSitting,
    SubscriptionMealChoice,
    SubscriptionPlanDay,
    SubscriptionPlanDays,
} from '@healthy360/api-client/contracts';
import type { MealId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { EntityImage } from '../../media/entity-image.tsx';
import { TINT_INK_FILL } from '../catalogue/shelf-tints.ts';
import { weeksOf } from './configurator.ts';
import { clashingAllergens, useAllergenNames, useMyAllergenCodes } from './my-allergens.tsx';
import { DishCard, SITTING_TINT, sittingKey, useSittingLabel } from './plan-meal-picker.tsx';
import { DialogFailure } from './subscription-editors.tsx';
import { Bone } from '../../ui/shop-skeletons.tsx';

export interface SubscriptionMealsProps {
    readonly days: SubscriptionPlanDays | undefined;
    readonly loading: boolean;
    /** The kitchen's meals — what a day may be changed to, and each tile's photo. */
    readonly menu: readonly MarketplaceMeal[];
    readonly menuLoading: boolean;
    /** False on a paused, cancelled or finished subscription: the days are shown, never changed. */
    readonly canChange: boolean;
    readonly busy: boolean;
    readonly pending: boolean;
    readonly error: unknown;
    /** The plan's name, under the window's title. */
    readonly planName: string;
    /** How long before a delivery its meals lock — the note beside the title. */
    readonly cutoffHours: number;
    /** Called as the editor opens, so an earlier refusal never greets a fresh attempt. */
    readonly onOpen: () => void;
    readonly onSave: (date: string, meals: readonly ChosenMeal[], saved: () => void) => void;
}

const noon = (date: string) => `${date}T12:00:00Z`;

/** `Mon 2 Nov`, for a calendar date in every time zone. */
function useDayLabel(): (date: string) => string {
    const formatter = useFormatter();
    return (date) =>
        formatter.formatDate(noon(date), { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * The customer's meals, a column a day (Shop · Subscription, pin 1).
 *
 * The run a week at a time behind week tabs; each day a column with its date, Change (or Locked
 * once its cut-off has passed), and each sitting as a photo tile — its kind in the corner, its dish
 * along the foot, an amber ring and flag when it crosses the allergy list, a dashed "Choose a meal"
 * when nothing is chosen. A day nobody chose for says so (Repeated) and a kitchen's swap says so
 * (Swapped). Change opens Meals for a day.
 */
export function SubscriptionMeals({
    days,
    loading,
    menu,
    menuLoading,
    canChange,
    busy,
    pending,
    error,
    planName,
    cutoffHours,
    onOpen,
    onSave,
}: SubscriptionMealsProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const dayLabel = useDayLabel();
    const { atLeast } = useBreakpoint();
    const [editing, setEditing] = useState<SubscriptionPlanDay | null>(null);
    const [weekIndex, setWeekIndex] = useState<number | null>(null);

    const all = days?.days ?? [];
    const weeks = weeksOf(all.map((day) => day.date));
    // Opens on the week of the first day still open to change.
    const firstOpen = all.find((day) => day.editable)?.date;
    const openingWeek = Math.max(
        0,
        weeks.findIndex((week) => firstOpen !== undefined && week.includes(firstOpen)),
    );
    const shownWeek = Math.min(weekIndex ?? openingWeek, Math.max(weeks.length - 1, 0));
    const weekDates = new Set(weeks[shownWeek] ?? []);
    const weekDays = all.filter((day) => weekDates.has(day.date));
    const sittings = days?.sittings ?? [];
    const missing = weekDays.reduce(
        (count, day) =>
            count +
            sittings.filter(
                (sitting) =>
                    !day.meals.some(
                        (meal) => sittingKey(meal) === sittingKey(sitting) && meal.mealName !== '',
                    ),
            ).length,
        0,
    );
    const columns = atLeast('xl') ? 5 : atLeast('md') ? 3 : 2;
    const rows: SubscriptionPlanDay[][] = [];
    weekDays.forEach((day, index) => {
        (rows[Math.floor(index / columns)] ??= []).push(day);
    });

    return (
        <View
            testID="subscription-meals"
            className="flex-col overflow-hidden rounded-[22px] border border-stroke-subtle bg-surface-raised"
        >
            <View className="flex-row flex-wrap items-center gap-2.5 px-5 pb-1 pt-[18px]">
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="text-lg font-bold text-content-primary text-start"
                >
                    {t('commerce:choices.sectionTitle')}
                </RNText>
                {canChange ? (
                    <View
                        testID="subscription-meals-cutoff"
                        className="min-h-[26px] flex-row items-center gap-1.5 rounded-full border border-stroke-subtle bg-surface-base px-2.5 py-1"
                    >
                        <Icon name="clock" size="sm" className="text-content-on-brand-subtle" />
                        <RNText className="shrink text-xs font-semibold text-content-secondary text-start">
                            {t('commerce:choices.cutoffNote', { count: cutoffHours })}
                        </RNText>
                    </View>
                ) : null}
                {weeks.length > 1 ? (
                    <View
                        role="tablist"
                        aria-label={t('commerce:configurator.meals.weeksLabel')}
                        className="ms-auto flex-row flex-wrap gap-1.5"
                    >
                        {weeks.map((week, index) => {
                            const on = index === shownWeek;
                            return (
                                <Pressable
                                    key={week[0] ?? String(index)}
                                    testID={`subscription-meals-week-${String(index + 1)}`}
                                    role="tab"
                                    aria-selected={on}
                                    accessibilityState={{ selected: on }}
                                    onPress={() => {
                                        setWeekIndex(index);
                                    }}
                                    className={cx(
                                        'h-[34px] justify-center rounded-full border px-3',
                                        on
                                            ? 'border-content-primary bg-content-primary'
                                            : 'border-stroke bg-surface-raised hover:bg-surface-sunken',
                                    )}
                                >
                                    <RNText
                                        className={cx(
                                            'text-sm font-semibold',
                                            on ? 'text-surface-base' : 'text-content-primary',
                                        )}
                                    >
                                        {t('commerce:configurator.meals.week', {
                                            number: formatter.formatNumber(index + 1),
                                        })}
                                    </RNText>
                                </Pressable>
                            );
                        })}
                    </View>
                ) : null}
            </View>

            {loading || days === undefined ? (
                <View testID="subscription-meals-loading" aria-busy className="px-5 pb-5 pt-1">
                    {[0, 1, 2].map((row) => (
                        <View
                            key={row}
                            aria-hidden
                            className={cx(
                                'flex-row items-center gap-3 py-3',
                                row === 0 ? null : 'border-t border-stroke-subtle',
                            )}
                        >
                            <Bone heightClassName="h-3.5" widthClassName="w-12" />
                            <Bone heightClassName="h-11" widthClassName="w-11" rounded="lg" />
                            <View className="min-w-0 flex-1 gap-2">
                                <Bone
                                    heightClassName="h-3.5"
                                    widthClassName={row === 1 ? 'w-2/5' : 'w-1/2'}
                                />
                                <Bone heightClassName="h-3" widthClassName="w-1/4" />
                            </View>
                        </View>
                    ))}
                </View>
            ) : all.length === 0 ? (
                <RNText
                    testID="subscription-meals-empty"
                    className="self-start px-5 pb-5 pt-3 text-sm text-content-secondary text-start"
                >
                    {t('commerce:choices.empty')}
                </RNText>
            ) : (
                <View className="flex-col gap-2.5 px-5 pb-5 pt-3.5">
                    {rows.map((row) => (
                        <View key={row[0]?.date} className="flex-row gap-2.5">
                            {row.map((day) => (
                                <DayColumn
                                    key={day.date}
                                    day={day}
                                    sittings={sittings}
                                    menu={menu}
                                    onChange={
                                        canChange && day.editable
                                            ? () => {
                                                  onOpen();
                                                  setEditing(day);
                                              }
                                            : null
                                    }
                                    locked={canChange && !day.editable}
                                    disabled={busy}
                                />
                            ))}
                            {Array.from({ length: columns - row.length }, (_, gap) => (
                                <View key={`gap-${String(gap)}`} className="min-w-0 flex-1" />
                            ))}
                        </View>
                    ))}
                </View>
            )}

            {canChange && missing > 0 ? (
                <View
                    testID="subscription-meals-missing"
                    className="mx-5 mb-[18px] flex-row items-center gap-2 rounded-[14px] bg-surface-base px-3 py-2.5"
                >
                    <Icon name="infoCircle" size="md" className="text-content-on-brand-subtle" />
                    <RNText className="shrink text-sm text-content-secondary text-start">
                        {t('commerce:choices.stillToChoose', { count: missing })}
                    </RNText>
                </View>
            ) : null}

            {days === undefined || editing === null ? null : (
                <MealsDayWindow
                    day={editing}
                    sittings={days.sittings}
                    title={t('commerce:choices.title', { date: dayLabel(editing.date) })}
                    planName={planName}
                    menu={menu}
                    menuLoading={menuLoading}
                    pending={pending}
                    error={error}
                    onClose={() => {
                        setEditing(null);
                    }}
                    onSave={(meals) => {
                        const date = editing.date;
                        onSave(date, meals, () => {
                            setEditing(null);
                            // Shop · Subscription, pin 7: nothing used to say it had worked.
                            toast.show({
                                testID: 'subscription-meals-saved',
                                tone: 'success',
                                title: t('commerce:choices.title', { date: dayLabel(date) }),
                                message: t('commerce:choices.saved'),
                            });
                        });
                    }}
                />
            )}
        </View>
    );
}

function DayColumn({
    day,
    sittings,
    menu,
    onChange,
    locked,
    disabled,
}: {
    readonly day: SubscriptionPlanDay;
    readonly sittings: readonly PlanSitting[];
    readonly menu: readonly MarketplaceMeal[];
    readonly onChange: (() => void) | null;
    readonly locked: boolean;
    readonly disabled: boolean;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const sittingLabel = useSittingLabel();
    const mine = useMyAllergenCodes();
    const bySitting = new Map<string, SubscriptionMealChoice>(
        day.meals.map((meal) => [sittingKey(meal), meal] as const),
    );
    const repeated = day.meals.some((meal) => meal.source === 'repeated');
    const swapped = day.meals.some((meal) => meal.source === 'substituted');

    return (
        <View
            testID={`subscription-meals-day-${day.date}`}
            className={cx(
                'min-w-0 flex-1 flex-col gap-2 rounded-[18px] border border-stroke-subtle bg-surface-base p-2.5',
                locked ? 'opacity-75' : null,
            )}
        >
            <View className="flex-row items-center gap-1.5 px-0.5 pb-1 pt-0.5">
                <RNText className="font-display text-lg font-bold tracking-display text-content-primary">
                    {formatter.formatDate(noon(day.date), { day: 'numeric' })}
                </RNText>
                <RNText className="text-xs font-semibold text-content-secondary">
                    {formatter.formatDate(noon(day.date), { weekday: 'short' })}
                </RNText>
                {onChange !== null ? (
                    <Pressable
                        testID={`subscription-meals-day-${day.date}-change`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityState={{ disabled }}
                        disabled={disabled}
                        onPress={onChange}
                        className="ms-auto h-[30px] flex-row items-center gap-1 rounded-full border border-stroke bg-surface-raised px-2.5 hover:bg-surface-brand-subtle"
                    >
                        <Icon name="rotateCw" size="sm" className="text-content-primary" />
                        <RNText className="text-xs font-semibold text-content-primary">
                            {t('commerce:choices.change')}
                        </RNText>
                    </Pressable>
                ) : locked ? (
                    <View
                        testID={`subscription-meals-day-${day.date}-locked`}
                        className="ms-auto h-6 flex-row items-center gap-1 rounded-full bg-surface-raised px-2"
                    >
                        <Icon name="clock" size="sm" className="text-content-secondary" />
                        <RNText className="text-xs font-semibold text-content-secondary">
                            {t('commerce:choices.locked')}
                        </RNText>
                    </View>
                ) : null}
            </View>
            {repeated || swapped ? (
                <View className="flex-row flex-wrap gap-1">
                    {repeated ? (
                        <DayChip
                            testID={`subscription-meals-day-${day.date}-repeated`}
                            label={t('commerce:choices.repeated')}
                        />
                    ) : null}
                    {swapped ? (
                        <DayChip
                            testID={`subscription-meals-day-${day.date}-swapped`}
                            label={t('commerce:choices.substituted')}
                        />
                    ) : null}
                </View>
            ) : null}
            {sittings.map((sitting) => {
                const choice = bySitting.get(sittingKey(sitting));
                const meal =
                    choice === undefined
                        ? undefined
                        : menu.find((each) => each.id === choice.mealId);
                const chosen = choice !== undefined && choice.mealName !== '';
                const clash =
                    meal !== undefined && clashingAllergens(meal.allergens, mine).length > 0;
                const id = `subscription-meals-day-${day.date}-${sitting.slot}-${String(sitting.sequence)}`;
                if (!chosen) {
                    return (
                        <View
                            key={sittingKey(sitting)}
                            testID={id}
                            className="h-[78px] flex-row items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-stroke bg-surface-raised"
                        >
                            <Icon name="plus" size="sm" className="text-content-secondary" />
                            <RNText className="text-xs font-semibold text-content-secondary">
                                {`${sittingLabel(sitting)} · ${t('commerce:choices.notChosen')}`}
                            </RNText>
                        </View>
                    );
                }
                return (
                    <View
                        key={sittingKey(sitting)}
                        testID={id}
                        className={cx(
                            'relative h-[78px] overflow-hidden rounded-[14px] bg-surface-brand-subtle',
                            clash ? 'border-2 border-warning-strong' : null,
                        )}
                    >
                        {meal === undefined ? null : (
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
                        )}
                        <View className="absolute start-1.5 top-1.5 h-5 flex-row items-center gap-1 rounded-[7px] bg-surface-raised/95 px-1.5">
                            <View
                                className={cx(
                                    'h-1.5 w-1.5 rounded-full',
                                    TINT_INK_FILL[SITTING_TINT[sitting.slot]],
                                )}
                            />
                            <RNText className="text-xs font-bold uppercase tracking-wide text-content-primary">
                                {sittingLabel(sitting)}
                            </RNText>
                        </View>
                        {clash ? (
                            <View
                                testID={`${id}-clash`}
                                className="absolute end-1.5 top-1.5 h-[22px] w-[22px] items-center justify-center rounded-full bg-warning-strong"
                            >
                                <Icon name="alert" size="sm" className="text-warning-on-strong" />
                            </View>
                        ) : null}
                        <View className="absolute bottom-1 end-1 start-1 h-6 justify-center rounded-lg bg-surface-raised/95 px-2">
                            <RNText
                                numberOfLines={1}
                                className="text-xs font-semibold text-content-primary text-start"
                            >
                                {choice.mealName}
                            </RNText>
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

function DayChip({ label, testID }: { readonly label: string; readonly testID: string }) {
    return (
        <View
            testID={testID}
            className="h-[22px] justify-center rounded-full bg-surface-raised px-2"
        >
            <RNText className="text-xs font-semibold text-content-secondary">{label}</RNText>
        </View>
    );
}

const ALL = 'all';

/**
 * Meals for a day (Shop · Subscription, pins 4–6) — the set-up's Pick your meals parts in a window
 * of fixed height: the day's sittings as photo cells across the top (the current one ringed, one on
 * the allergy list flagged amber and named), the current cell and the meal-type tabs, then the
 * kitchen's dishes, which scroll inside the window while the page behind stays put. Save stays off
 * until every sitting has a dish. A bottom sheet below `md`.
 */
function MealsDayWindow({
    day,
    sittings,
    title,
    planName,
    menu,
    menuLoading,
    pending,
    error,
    onClose,
    onSave,
}: {
    readonly day: SubscriptionPlanDay;
    readonly sittings: readonly PlanSitting[];
    readonly title: string;
    readonly planName: string;
    readonly menu: readonly MarketplaceMeal[];
    readonly menuLoading: boolean;
    readonly pending: boolean;
    readonly error: unknown;
    readonly onClose: () => void;
    readonly onSave: (meals: readonly ChosenMeal[]) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const sittingLabel = useSittingLabel();
    const allergenNames = useAllergenNames();
    const mine = useMyAllergenCodes();
    const { atLeast } = useBreakpoint();
    const sheet = !atLeast('md');
    const [picks, setPicks] = useState<Readonly<Record<string, MealId>>>(() =>
        Object.fromEntries(day.meals.map((meal) => [sittingKey(meal), meal.mealId] as const)),
    );
    const firstEmpty = sittings.find((sitting) => picks[sittingKey(sitting)] === undefined);
    const opening = firstEmpty ?? sittings[0];
    const [current, setCurrent] = useState<string>(
        opening === undefined ? '' : sittingKey(opening),
    );
    const [filter, setFilter] = useState<string>(ALL);

    const chosen = sittings.filter((sitting) => picks[sittingKey(sitting)] !== undefined).length;
    const complete = chosen === sittings.length;
    const currentSitting = sittings.find((sitting) => sittingKey(sitting) === current);
    const dateLabel = formatter.formatDate(noon(day.date), {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    });
    const types = (['breakfast', 'lunch', 'dinner', 'snack'] as const).filter((type) =>
        menu.some((meal) => meal.mealTypes.includes(type)),
    );
    const shown =
        filter === ALL
            ? menu
            : menu.filter((meal) => meal.mealTypes.includes(filter as (typeof types)[number]));
    const columns = sheet ? 1 : 3;
    const rows: MarketplaceMeal[][] = [];
    shown.forEach((meal, index) => {
        (rows[Math.floor(index / columns)] ??= []).push(meal);
    });
    const used = new Map<string, number>();
    for (const sitting of sittings) {
        const id = picks[sittingKey(sitting)];
        if (id !== undefined) used.set(String(id), (used.get(String(id)) ?? 0) + 1);
    }

    const choose = (meal: MarketplaceMeal) => {
        if (currentSitting === undefined) return;
        const next = { ...picks, [current]: meal.id };
        setPicks(next);
        // On to the next sitting still empty, as the set-up's grid does.
        const after = sittings.find((sitting) => next[sittingKey(sitting)] === undefined);
        if (after !== undefined) setCurrent(sittingKey(after));
    };

    const countLabel = t('commerce:choices.chosenCount', {
        done: formatter.formatNumber(chosen),
        total: formatter.formatNumber(sittings.length),
    });

    return (
        <Modal visible transparent animationType="none" onRequestClose={onClose}>
            <View
                className={cx('flex-1', sheet ? 'justify-end' : 'items-center justify-center p-4')}
            >
                <Pressable
                    testID="subscription-meals-dialog-backdrop"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    focusable={false}
                    onPress={onClose}
                    className="absolute inset-0 bg-surface-inverse/50"
                />
                <View className={cx('w-full', sheet ? '' : 'max-w-[880px]')}>
                    <FadeIn>
                        <View
                            testID="subscription-meals-dialog"
                            role="dialog"
                            aria-modal
                            aria-label={title}
                            className={cx(
                                // The height is on the panel, not on `FadeIn`: an `Animated.View`
                                // drops `className` on the web, and the dish list needs a window of
                                // fixed height to scroll inside.
                                'w-full flex-col overflow-hidden bg-surface-raised shadow-elevation-4',
                                sheet ? 'h-[92vh]' : 'h-[660px] max-h-[92vh]',
                                sheet ? 'rounded-t-[28px]' : 'rounded-[28px]',
                            )}
                        >
                            {/* head */}
                            <View
                                className={cx(
                                    'relative flex-row items-center gap-3.5 border-b border-stroke-subtle pb-4 pe-[18px] ps-[22px]',
                                    sheet ? 'pt-[22px]' : 'pt-[18px]',
                                )}
                            >
                                {sheet ? (
                                    <View
                                        aria-hidden
                                        className="absolute start-0 end-0 top-2 items-center"
                                    >
                                        <View className="h-[5px] w-10 rounded-full bg-stroke" />
                                    </View>
                                ) : (
                                    <View className="h-[46px] w-[46px] items-center justify-center rounded-[15px] bg-surface-brand-subtle">
                                        <Icon
                                            name="calendar"
                                            size="lg"
                                            className="text-content-on-brand-subtle"
                                        />
                                    </View>
                                )}
                                <View className="min-w-0 flex-1">
                                    <RNText
                                        accessibilityRole="header"
                                        aria-level={2}
                                        className="font-display text-xl font-bold leading-7 text-content-primary text-start"
                                    >
                                        {title}
                                    </RNText>
                                    <RNText className="text-sm text-content-secondary text-start">
                                        {planName}
                                    </RNText>
                                </View>
                                {sheet ? null : (
                                    <View className="h-7 justify-center rounded-full bg-surface-brand-subtle px-3">
                                        <RNText className="text-xs font-bold text-content-on-brand-subtle">
                                            {countLabel}
                                        </RNText>
                                    </View>
                                )}
                                <Pressable
                                    testID="subscription-meals-dialog-close"
                                    role="button"
                                    accessibilityRole="button"
                                    accessibilityLabel={t('common:action.close')}
                                    onPress={onClose}
                                    className="h-10 w-10 items-center justify-center rounded-full bg-surface-base hover:bg-surface-sunken"
                                >
                                    <Icon name="close" size="sm" className="text-content-primary" />
                                </Pressable>
                            </View>

                            {/* the day's sittings */}
                            <View
                                className={cx(
                                    'flex-row flex-wrap gap-2.5',
                                    sheet ? 'px-4 pb-0.5 pt-3' : 'px-[22px] pb-1 pt-4',
                                )}
                            >
                                {sittings.map((sitting) => {
                                    const key = sittingKey(sitting);
                                    const meal = menu.find((each) => each.id === picks[key]);
                                    const on = key === current;
                                    const clashing =
                                        meal === undefined
                                            ? []
                                            : clashingAllergens(meal.allergens, mine);
                                    const cellID = `subscription-meals-dialog-cell-${sitting.slot}-${String(sitting.sequence)}`;
                                    return (
                                        <View
                                            key={key}
                                            className={cx(
                                                'min-w-0 flex-col gap-1.5',
                                                sheet ? 'w-[47%] grow' : 'flex-1',
                                            )}
                                        >
                                            <View className="flex-row items-center gap-1.5">
                                                <View
                                                    className={cx(
                                                        'h-[7px] w-[7px] rounded-full',
                                                        TINT_INK_FILL[SITTING_TINT[sitting.slot]],
                                                    )}
                                                />
                                                <RNText className="text-xs font-bold uppercase tracking-wider text-content-secondary">
                                                    {sittingLabel(sitting)}
                                                </RNText>
                                            </View>
                                            <Pressable
                                                testID={cellID}
                                                role="button"
                                                accessibilityRole="button"
                                                aria-pressed={on}
                                                accessibilityState={{ selected: on }}
                                                accessibilityLabel={
                                                    meal === undefined
                                                        ? t(
                                                              'commerce:configurator.meals.cellEmpty',
                                                              {
                                                                  slot: sittingLabel(sitting),
                                                                  day: dateLabel,
                                                              },
                                                          )
                                                        : t(
                                                              'commerce:configurator.meals.cellFull',
                                                              {
                                                                  slot: sittingLabel(sitting),
                                                                  day: dateLabel,
                                                                  meal: meal.name,
                                                              },
                                                          )
                                                }
                                                onPress={() => {
                                                    setCurrent(key);
                                                }}
                                                className={cx(
                                                    'relative items-center justify-center overflow-hidden rounded-2xl',
                                                    sheet ? 'h-[68px]' : 'h-[86px]',
                                                    on
                                                        ? 'border-2 border-surface-brand bg-surface-brand-subtle'
                                                        : meal !== undefined
                                                          ? clashing.length > 0
                                                              ? 'border-2 border-warning-strong'
                                                              : 'border-[1.5px] border-transparent'
                                                          : 'border-[1.5px] border-dashed border-stroke bg-surface-raised hover:border-surface-brand',
                                                )}
                                            >
                                                {meal === undefined ? (
                                                    on ? (
                                                        <View className="flex-row items-center gap-1.5">
                                                            <Icon
                                                                name="plus"
                                                                size="sm"
                                                                className="text-content-on-brand-subtle"
                                                            />
                                                            <RNText className="text-sm font-bold text-content-on-brand-subtle">
                                                                {t(
                                                                    'commerce:configurator.meals.placeholder',
                                                                )}
                                                            </RNText>
                                                        </View>
                                                    ) : (
                                                        <Icon
                                                            name="plus"
                                                            size="md"
                                                            className="text-content-secondary"
                                                        />
                                                    )
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
                                                        {clashing.length > 0 ? (
                                                            <View className="absolute end-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-full bg-warning-strong">
                                                                <Icon
                                                                    name="alert"
                                                                    size="sm"
                                                                    className="text-warning-on-strong"
                                                                />
                                                            </View>
                                                        ) : null}
                                                        <View className="absolute bottom-1 end-1 start-1 h-6 justify-center rounded-lg bg-surface-raised/95 px-2">
                                                            <RNText
                                                                testID={`${cellID}-value`}
                                                                numberOfLines={1}
                                                                className="text-xs font-semibold text-content-primary text-start"
                                                            >
                                                                {meal.name}
                                                            </RNText>
                                                        </View>
                                                    </>
                                                )}
                                            </Pressable>
                                            {clashing.length > 0 ? (
                                                <View
                                                    testID={`${cellID}-clash`}
                                                    className="flex-row items-center gap-1"
                                                >
                                                    <Icon
                                                        name="alert"
                                                        size="sm"
                                                        className="text-warning-on-subtle"
                                                    />
                                                    <RNText className="shrink text-xs font-semibold text-warning-on-subtle text-start">
                                                        {t('commerce:myAllergens.badge', {
                                                            count: clashing.length,
                                                            allergens: allergenNames(clashing),
                                                        })}
                                                    </RNText>
                                                </View>
                                            ) : null}
                                        </View>
                                    );
                                })}
                            </View>

                            {/* the current cell and the meal types */}
                            <View
                                className={cx(
                                    'flex-row flex-wrap items-center gap-2.5',
                                    sheet ? 'px-4 pt-3' : 'px-[22px] pt-3.5',
                                )}
                            >
                                {currentSitting === undefined ? null : (
                                    <View className="h-[30px] flex-row items-center gap-1.5 rounded-full bg-surface-inverse px-3">
                                        <RNText className="text-xs font-bold uppercase tracking-wide text-content-inverse">
                                            {sittingLabel(currentSitting)}
                                        </RNText>
                                        <RNText className="text-xs font-semibold text-content-inverse opacity-80">
                                            {dateLabel}
                                        </RNText>
                                    </View>
                                )}
                                {types.length > 1 ? (
                                    <View
                                        role="tablist"
                                        aria-label={t('commerce:configurator.meals.typeLabel')}
                                        className={cx(
                                            'flex-row flex-wrap gap-1.5',
                                            sheet ? 'w-full' : 'ms-auto',
                                        )}
                                    >
                                        {[ALL, ...types].map((type) => {
                                            const on = filter === type;
                                            const count =
                                                type === ALL
                                                    ? menu.length
                                                    : menu.filter((meal) =>
                                                          meal.mealTypes.includes(
                                                              type as (typeof types)[number],
                                                          ),
                                                      ).length;
                                            return (
                                                <Pressable
                                                    key={type}
                                                    testID={`subscription-meals-dialog-filter-${type}`}
                                                    role="tab"
                                                    aria-selected={on}
                                                    accessibilityState={{ selected: on }}
                                                    onPress={() => {
                                                        setFilter(type);
                                                    }}
                                                    className={cx(
                                                        'h-8 flex-row items-center gap-1.5 rounded-full border px-3',
                                                        on
                                                            ? 'border-content-primary bg-content-primary'
                                                            : 'border-stroke bg-surface-raised hover:bg-surface-sunken',
                                                    )}
                                                >
                                                    <RNText
                                                        className={cx(
                                                            'text-sm font-semibold',
                                                            on
                                                                ? 'text-surface-base'
                                                                : 'text-content-primary',
                                                        )}
                                                    >
                                                        {type === ALL
                                                            ? t(
                                                                  'commerce:configurator.meals.filterAll',
                                                              )
                                                            : t(`marketplace:mealTypes.${type}`)}
                                                    </RNText>
                                                    <RNText
                                                        className={cx(
                                                            'text-xs tabular-nums opacity-75',
                                                            on
                                                                ? 'text-surface-base'
                                                                : 'text-content-secondary',
                                                        )}
                                                    >
                                                        {formatter.formatNumber(count)}
                                                    </RNText>
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                ) : null}
                            </View>

                            {/* the dishes, scrolling inside the window */}
                            <ScrollView
                                testID="subscription-meals-dialog-dishes"
                                className="mt-3 min-h-0 flex-1"
                                contentContainerClassName={cx(
                                    'flex-col gap-2.5 pb-4',
                                    sheet ? 'px-4' : 'px-[22px]',
                                )}
                            >
                                {menuLoading && menu.length === 0 ? (
                                    <RNText className="text-sm text-content-secondary text-start">
                                        {t('commerce:configurator.meals.loading')}
                                    </RNText>
                                ) : null}
                                {rows.map((row, index) => (
                                    <View
                                        key={row[0]?.id ?? String(index)}
                                        className="flex-row gap-2.5"
                                    >
                                        {Array.from({ length: columns }, (_, column) => {
                                            const meal = row[column];
                                            if (meal === undefined) {
                                                return (
                                                    <View
                                                        key={column}
                                                        aria-hidden
                                                        // Padded like a dish card, so a short row
                                                        // splits its width as the full rows do.
                                                        className="min-w-0 flex-1 border-[1.5px] border-transparent p-1.5 pe-[50px]"
                                                    />
                                                );
                                            }
                                            return (
                                                <DishCard
                                                    key={meal.id}
                                                    meal={meal}
                                                    on={picks[current] === meal.id}
                                                    times={used.get(String(meal.id)) ?? 0}
                                                    clash={
                                                        clashingAllergens(meal.allergens, mine)
                                                            .length > 0
                                                    }
                                                    testID={`subscription-meals-dialog-dish-${meal.slug}`}
                                                    accessibilityLabel={
                                                        currentSitting === undefined
                                                            ? meal.name
                                                            : t(
                                                                  'commerce:configurator.meals.dishFor',
                                                                  {
                                                                      meal: meal.name,
                                                                      slot: sittingLabel(
                                                                          currentSitting,
                                                                      ),
                                                                      day: dateLabel,
                                                                  },
                                                              )
                                                    }
                                                    onPress={() => {
                                                        choose(meal);
                                                    }}
                                                />
                                            );
                                        })}
                                    </View>
                                ))}
                            </ScrollView>

                            {/* the foot */}
                            <View
                                className={cx(
                                    'flex-col gap-2 border-t border-stroke-subtle bg-surface-raised',
                                    sheet
                                        ? 'px-4 pb-[22px] pt-3'
                                        : 'pb-4 pe-[18px] ps-[22px] pt-3.5',
                                )}
                            >
                                <DialogFailure error={error} testID="subscription-meals-failure" />
                                <View className="flex-row items-center gap-3">
                                    <View className="min-w-0 flex-col gap-1.5">
                                        <RNText
                                            testID="subscription-meals-dialog-count"
                                            className="text-sm font-bold text-content-primary"
                                        >
                                            {countLabel}
                                        </RNText>
                                        <View
                                            className={cx(
                                                'h-1.5 flex-row overflow-hidden rounded-full bg-surface-base',
                                                sheet ? 'w-[110px]' : 'w-[180px]',
                                            )}
                                        >
                                            <View
                                                className="h-full rounded-full bg-surface-brand"
                                                style={{ flex: chosen }}
                                            />
                                            <View
                                                style={{
                                                    flex: Math.max(0, sittings.length - chosen),
                                                }}
                                            />
                                        </View>
                                    </View>
                                    <View className="flex-1" />
                                    {sheet ? null : (
                                        <Pressable
                                            testID="subscription-meals-cancel"
                                            role="button"
                                            accessibilityRole="button"
                                            onPress={onClose}
                                            className="h-[50px] items-center justify-center rounded-[15px] border border-stroke bg-surface-raised px-[22px] hover:bg-surface-sunken"
                                        >
                                            <RNText className="text-base font-bold text-content-primary">
                                                {t('commerce:common.cancel')}
                                            </RNText>
                                        </Pressable>
                                    )}
                                    <Pressable
                                        testID="subscription-meals-save"
                                        role="button"
                                        accessibilityRole="button"
                                        aria-disabled={!complete || pending}
                                        accessibilityState={{
                                            disabled: !complete || pending,
                                            busy: pending,
                                        }}
                                        disabled={!complete || pending}
                                        onPress={() => {
                                            onSave(
                                                sittings.flatMap((sitting) => {
                                                    const mealId = picks[sittingKey(sitting)];
                                                    return mealId === undefined
                                                        ? []
                                                        : [
                                                              {
                                                                  slot: sitting.slot,
                                                                  sequence: sitting.sequence,
                                                                  mealId,
                                                              },
                                                          ];
                                                }),
                                            );
                                        }}
                                        className={cx(
                                            'h-[50px] min-w-[150px] items-center justify-center rounded-[15px] px-[22px]',
                                            sheet ? 'flex-1' : null,
                                            complete && !pending
                                                ? 'bg-surface-brand hover:opacity-90'
                                                : 'bg-stroke',
                                        )}
                                    >
                                        <RNText
                                            className={cx(
                                                'text-base font-bold',
                                                complete && !pending
                                                    ? 'text-content-on-brand'
                                                    : 'text-content-secondary',
                                            )}
                                        >
                                            {t('commerce:choices.confirm')}
                                        </RNText>
                                    </Pressable>
                                </View>
                            </View>
                        </View>
                    </FadeIn>
                </View>
            </View>
        </Modal>
    );
}
