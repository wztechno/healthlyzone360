import { Button, Select } from '@healthy360/design-system';
import type {
    MarketplaceMeal,
    MealSlot,
    PlanSitting,
    SubscriptionPlan,
} from '@healthy360/api-client/contracts';
import type { MealId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import {
    configuredDeliveryDates,
    missingPicks,
    pickKey,
    repeatFirstWeek,
    REPEAT_WINDOW_DAYS,
    sittingsOf,
} from './configurator.ts';
import type { ConfiguratorState } from './configurator.ts';
import { daysBetween } from './dates.ts';
import {
    YourAllergens,
    clashingAllergens,
    useAllergenNames,
    useMyAllergenCodes,
} from './my-allergens.tsx';
import { CardPanel } from './summary-card.tsx';

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

export interface PlanDayMealsProps {
    /** `YYYY-MM-DD`. */
    readonly date: string;
    readonly sittings: readonly PlanSitting[];
    /** The dish in each sitting, by `slot:sequence`. */
    readonly picks: Readonly<Record<string, MealId | undefined>>;
    readonly onPick: (sitting: PlanSitting, mealId: MealId) => void;
    readonly menu: readonly MarketplaceMeal[];
    readonly menuLoading?: boolean | undefined;
    /** Draws a sitting with no dish as an error once the person has tried to move on. */
    readonly showMissing?: boolean | undefined;
    /** Hide the date — a dialog that already names the day in its title. */
    readonly hideDate?: boolean | undefined;
    readonly testID: string;
}

/** The `slot:sequence` key a day's picks are held under. */
export function sittingKey(sitting: PlanSitting): string {
    return `${sitting.slot}:${String(sitting.sequence)}`;
}

export function PlanDayMeals({
    date,
    sittings,
    picks,
    onPick,
    menu,
    menuLoading = false,
    showMissing = false,
    hideDate = false,
    testID,
}: PlanDayMealsProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const mine = useMyAllergenCodes();
    const allergenNames = useAllergenNames();
    const sittingLabel = useSittingLabel();
    // Midday UTC, so the calendar day reads the same in every time zone.
    const day = formatter.formatDate(`${date}T12:00:00Z`, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    });

    /** An option names the clash before it is picked, so the list itself warns. */
    const options = menu.map((meal) => {
        const clashing = clashingAllergens(meal.allergens, mine);
        return {
            value: String(meal.id),
            label:
                clashing.length === 0
                    ? meal.name
                    : t('commerce:myAllergens.option', {
                          meal: meal.name,
                          count: clashing.length,
                          allergens: allergenNames(clashing),
                      }),
        };
    });

    return (
        <View testID={testID} className="flex-col gap-2 md:flex-row md:items-start md:gap-4">
            {hideDate ? null : (
                <RNText
                    testID={`${testID}-date`}
                    className="self-start text-sm font-semibold text-content-primary text-start md:w-[120px] md:pt-2"
                >
                    {day}
                </RNText>
            )}
            <View className="min-w-0 flex-col gap-3 md:flex-1 md:flex-row md:flex-wrap">
                {sittings.map((sitting) => {
                    const mealId = picks[sittingKey(sitting)];
                    const meal = menu.find((option) => option.id === mealId);
                    return (
                        <View
                            key={sittingKey(sitting)}
                            className="min-w-0 flex-col md:min-w-[180px] md:flex-1"
                        >
                            <Select
                                testID={`${testID}-${sitting.slot}-${String(sitting.sequence)}`}
                                label={sittingLabel(sitting)}
                                searchable
                                loading={menuLoading}
                                value={mealId === undefined ? null : String(mealId)}
                                placeholder={t('commerce:configurator.meals.placeholder')}
                                error={
                                    showMissing && mealId === undefined
                                        ? t('commerce:configurator.meals.missing')
                                        : undefined
                                }
                                onChange={(next) => {
                                    const chosen = menu.find(
                                        (option) => String(option.id) === next,
                                    );
                                    if (chosen !== undefined) onPick(sitting, chosen.id);
                                }}
                                options={options}
                            />
                            <YourAllergens
                                allergens={meal?.allergens}
                                testID={`${testID}-${sitting.slot}-${String(sitting.sequence)}-your-allergens`}
                                className="mt-1"
                            />
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

/* ── the configurator's step ─────────────────────────────────────────────────────────────────── */

export interface MealsStepProps {
    readonly plan: SubscriptionPlan;
    readonly state: ConfiguratorState;
    readonly patch: (next: Partial<ConfiguratorState>) => void;
    readonly menu: readonly MarketplaceMeal[];
    readonly menuLoading: boolean;
    readonly showIssues: boolean;
}

/**
 * ③ Meals — every delivery day of the run, a dish for each sitting.
 *
 * The days are the ones the delivery step produces, grouped a week at a time so a long run reads
 * as weeks. "Repeat week 1" copies the first week onto every later day of the same weekday,
 * filling only what is still empty, so a person can set a week and adjust from there.
 */
export function MealsStep({ plan, state, patch, menu, menuLoading, showIssues }: MealsStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const sittings = sittingsOf(plan, state);
    const dates = configuredDeliveryDates(state, plan);
    const first = dates[0];

    const total = dates.length * sittings.length;
    const done = total - missingPicks(state, plan);

    const weeks: string[][] = [];
    for (const date of dates) {
        const index = Math.floor(
            (first === undefined ? 0 : (daysBetween(first, date) ?? 0)) / REPEAT_WINDOW_DAYS,
        );
        (weeks[index] ??= []).push(date);
    }

    const laterWeeks = dates.length > (weeks[0]?.length ?? 0);
    const firstWeekFilled = (weeks[0] ?? []).every((date) =>
        sittings.every((sitting) => state.mealPicks[pickKey(date, sitting)] !== undefined),
    );

    const pick = (date: string, sitting: PlanSitting, mealId: MealId) => {
        patch({ mealPicks: { ...state.mealPicks, [pickKey(date, sitting)]: mealId } });
    };

    return (
        <View testID="configurator-step-meals" className="flex-col gap-4">
            <View className="flex-row flex-wrap items-center justify-between gap-2">
                <RNText
                    testID="configurator-meals-progress"
                    className="self-center text-sm text-content-secondary text-start"
                >
                    {t('commerce:configurator.meals.progress', {
                        done: formatter.formatNumber(done),
                        total: formatter.formatNumber(total),
                    })}
                </RNText>
                {laterWeeks ? (
                    <Button
                        testID="configurator-meals-repeat"
                        variant="secondary"
                        size="sm"
                        label={t('commerce:configurator.meals.repeatWeek')}
                        disabled={!firstWeekFilled}
                        onPress={() => {
                            patch({ mealPicks: repeatFirstWeek(state, plan) });
                        }}
                    />
                ) : null}
            </View>

            {weeks.map((week, index) => (
                <CardPanel
                    key={week[0] ?? String(index)}
                    testID={`configurator-meals-week-${String(index + 1)}`}
                    className="gap-4"
                >
                    {weeks.length > 1 ? (
                        <RNText
                            accessibilityRole="header"
                            aria-level={3}
                            className="self-start text-base font-semibold text-content-primary text-start"
                        >
                            {t('commerce:configurator.meals.week', {
                                number: formatter.formatNumber(index + 1),
                            })}
                        </RNText>
                    ) : null}
                    {week.map((date) => (
                        <PlanDayMeals
                            key={date}
                            testID={`configurator-meal-${date}`}
                            date={date}
                            sittings={sittings}
                            picks={Object.fromEntries(
                                sittings.map((sitting) => [
                                    sittingKey(sitting),
                                    state.mealPicks[pickKey(date, sitting)],
                                ]),
                            )}
                            onPick={(sitting, mealId) => {
                                pick(date, sitting, mealId);
                            }}
                            menu={menu}
                            menuLoading={menuLoading}
                            showMissing={showIssues}
                        />
                    ))}
                </CardPanel>
            ))}
        </View>
    );
}
