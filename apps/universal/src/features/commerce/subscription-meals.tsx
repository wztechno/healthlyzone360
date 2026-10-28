import { Badge, Button, Dialog, Skeleton, Stack, cx } from '@healthy360/design-system';
import type {
    ChosenMeal,
    MarketplaceMeal,
    SubscriptionMealChoice,
    SubscriptionPlanDay,
    SubscriptionPlanDays,
} from '@healthy360/api-client/contracts';
import type { MealId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { PlanDayMeals, sittingKey, useSittingLabel } from './plan-meal-picker.tsx';
import { DialogFailure } from './subscription-editors.tsx';
import { CardPanel } from './summary-card.tsx';

export interface SubscriptionMealsProps {
    readonly days: SubscriptionPlanDays | undefined;
    readonly loading: boolean;
    /** The kitchen's meals — what a day may be changed to. */
    readonly menu: readonly MarketplaceMeal[];
    readonly menuLoading: boolean;
    /** False on a paused, cancelled or finished subscription: the days are shown, never changed. */
    readonly canChange: boolean;
    readonly busy: boolean;
    readonly pending: boolean;
    readonly error: unknown;
    /** Called as the editor opens, so an earlier refusal never greets a fresh attempt. */
    readonly onOpen: () => void;
    readonly onSave: (date: string, meals: readonly ChosenMeal[], saved: () => void) => void;
}

/** `Mon 2 Nov`, for a calendar date in every time zone. */
function useDayLabel(): (date: string) => string {
    const formatter = useFormatter();
    return (date) =>
        formatter.formatDate(`${date}T12:00:00Z`, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
        });
}

/**
 * The customer's meals, day by day — what each delivery will carry, and a Change on every day
 * still open.
 *
 * The customer chose every meal when they subscribed; this is where they see them and change one
 * day before its cut-off. A day nobody chose for (a skip pushed the balance onto it) is said to be
 * so; the kitchen repeats the customer's own meals for that weekday unless they choose.
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
    onOpen,
    onSave,
}: SubscriptionMealsProps) {
    const { t } = useTranslation();
    const dayLabel = useDayLabel();
    const [editing, setEditing] = useState<SubscriptionPlanDay | null>(null);

    return (
        <CardPanel testID="subscription-meals" className="gap-3">
            <RNText
                accessibilityRole="header"
                aria-level={2}
                className="self-start text-base font-semibold text-content-primary text-start"
            >
                {t('commerce:choices.sectionTitle')}
            </RNText>

            {loading || days === undefined ? (
                <Skeleton testID="subscription-meals-loading" heightClassName="h-24" />
            ) : days.days.length === 0 ? (
                <RNText
                    testID="subscription-meals-empty"
                    className="self-start text-sm text-content-secondary text-start"
                >
                    {t('commerce:choices.empty')}
                </RNText>
            ) : (
                <View className="flex-col">
                    {days.days.map((day, index) => (
                        <MealDayRow
                            key={day.date}
                            day={day}
                            sittings={days.sittings}
                            first={index === 0}
                            label={dayLabel(day.date)}
                            onChange={
                                canChange && day.editable
                                    ? () => {
                                          onOpen();
                                          setEditing(day);
                                      }
                                    : null
                            }
                            disabled={busy}
                        />
                    ))}
                </View>
            )}

            {days === undefined || editing === null ? null : (
                <MealDayDialog
                    day={editing}
                    sittings={days.sittings}
                    title={t('commerce:choices.title', { date: dayLabel(editing.date) })}
                    menu={menu}
                    menuLoading={menuLoading}
                    pending={pending}
                    error={error}
                    onClose={() => {
                        setEditing(null);
                    }}
                    onSave={(meals) => {
                        onSave(editing.date, meals, () => {
                            setEditing(null);
                        });
                    }}
                />
            )}
        </CardPanel>
    );
}

function MealDayRow({
    day,
    sittings,
    first,
    label,
    onChange,
    disabled,
}: {
    readonly day: SubscriptionPlanDay;
    readonly sittings: SubscriptionPlanDays['sittings'];
    readonly first: boolean;
    readonly label: string;
    readonly onChange: (() => void) | null;
    readonly disabled: boolean;
}) {
    const { t } = useTranslation();
    const sittingLabel = useSittingLabel();
    const bySitting = new Map<string, SubscriptionMealChoice>(
        day.meals.map((meal) => [sittingKey(meal), meal] as const),
    );
    const repeated = day.meals.some((meal) => meal.source === 'repeated');
    const swapped = day.meals.some((meal) => meal.source === 'substituted');

    return (
        <View
            testID={`subscription-meals-day-${day.date}`}
            className={cx(
                'flex-col gap-2 py-3 md:flex-row md:items-start md:gap-4',
                first ? null : 'border-t border-stroke-subtle',
            )}
        >
            <View className="flex-row flex-wrap items-center gap-2 md:w-[160px]">
                <RNText className="self-center text-sm font-semibold text-content-primary text-start">
                    {label}
                </RNText>
                {repeated ? (
                    <Badge
                        testID={`subscription-meals-day-${day.date}-repeated`}
                        tone="info"
                        label={t('commerce:choices.repeated')}
                    />
                ) : null}
                {swapped ? (
                    <Badge
                        testID={`subscription-meals-day-${day.date}-swapped`}
                        tone="warning"
                        label={t('commerce:choices.substituted')}
                    />
                ) : null}
            </View>
            <View className="min-w-0 flex-col gap-1 md:flex-1">
                {sittings.map((sitting) => {
                    const meal = bySitting.get(sittingKey(sitting));
                    return (
                        <View
                            key={sittingKey(sitting)}
                            testID={`subscription-meals-day-${day.date}-${sitting.slot}-${String(sitting.sequence)}`}
                            className="flex-row flex-wrap gap-x-2"
                        >
                            <RNText className="w-[88px] text-sm text-content-secondary text-start">
                                {sittingLabel(sitting)}
                            </RNText>
                            <RNText
                                className={cx(
                                    'min-w-0 shrink text-sm text-start',
                                    meal === undefined
                                        ? 'text-content-secondary'
                                        : 'text-content-primary',
                                )}
                            >
                                {meal === undefined || meal.mealName === ''
                                    ? t('commerce:choices.notChosen')
                                    : meal.mealName}
                            </RNText>
                        </View>
                    );
                })}
            </View>
            {onChange === null ? null : (
                <View className="self-start">
                    <Button
                        testID={`subscription-meals-day-${day.date}-change`}
                        variant="quiet"
                        size="sm"
                        label={t('commerce:choices.change')}
                        disabled={disabled}
                        onPress={onChange}
                    />
                </View>
            )}
        </View>
    );
}

function MealDayDialog({
    day,
    sittings,
    title,
    menu,
    menuLoading,
    pending,
    error,
    onClose,
    onSave,
}: {
    readonly day: SubscriptionPlanDay;
    readonly sittings: SubscriptionPlanDays['sittings'];
    readonly title: string;
    readonly menu: readonly MarketplaceMeal[];
    readonly menuLoading: boolean;
    readonly pending: boolean;
    readonly error: unknown;
    readonly onClose: () => void;
    readonly onSave: (meals: readonly ChosenMeal[]) => void;
}) {
    const { t } = useTranslation();
    const [picks, setPicks] = useState<Readonly<Record<string, MealId>>>(() =>
        Object.fromEntries(day.meals.map((meal) => [sittingKey(meal), meal.mealId] as const)),
    );
    const complete = sittings.every((sitting) => picks[sittingKey(sitting)] !== undefined);

    return (
        <Dialog
            testID="subscription-meals-dialog"
            open
            onClose={onClose}
            title={title}
            actions={
                <>
                    <Button
                        testID="subscription-meals-cancel"
                        variant="quiet"
                        label={t('commerce:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="subscription-meals-save"
                        label={t('commerce:choices.confirm')}
                        loading={pending}
                        disabled={!complete}
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
                    />
                </>
            }
        >
            <Stack space="md">
                <PlanDayMeals
                    testID="subscription-meals-dialog-day"
                    date={day.date}
                    sittings={sittings}
                    picks={picks}
                    onPick={(sitting, mealId) => {
                        setPicks((current) => ({ ...current, [sittingKey(sitting)]: mealId }));
                    }}
                    menu={menu}
                    menuLoading={menuLoading}
                    hideDate
                />
                <DialogFailure error={error} testID="subscription-meals-failure" />
            </Stack>
        </Dialog>
    );
}
