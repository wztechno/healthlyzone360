import { Badge, Text } from '@healthy360/design-system';
import type { KitchenOrder, KitchenOrderLine } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

/**
 * Which dish is for which sitting of a subscription day, drawn under the order's plan line.
 *
 * A generated plan day is one order: the plan line at the day's price and one zero-priced line per
 * dish. On their own those lines say what was packed but not for which meal — the customer chose
 * a dish for each sitting, and the order view says so: "Breakfast · Shakshuka", "Lunch · Grilled
 * chicken". The dish lines the plan day names are drawn here, with their allergens, rather than
 * again as rows of their own ({@link visibleOrderLines}).
 */

/** The dish lines a plan day lists under its plan line. */
export function planDayMealLineIds(order: KitchenOrder): ReadonlySet<string> {
    return new Set(
        (order.planDay?.meals ?? [])
            .map((meal) => meal.lineId)
            .filter((lineId): lineId is string => lineId !== null),
    );
}

/** The order's lines, less the dish lines its plan day already draws under the plan line. */
export function visibleOrderLines(order: KitchenOrder): readonly KitchenOrderLine[] {
    const covered = planDayMealLineIds(order);
    return covered.size === 0 ? order.lines : order.lines.filter((line) => !covered.has(line.id));
}

/** Whether this line is the plan line its order's plan day hangs from. */
export function isPlanDayLine(order: KitchenOrder, line: KitchenOrderLine): boolean {
    const planDay = order.planDay;
    return (
        planDay !== null &&
        planDay !== undefined &&
        planDay.planLineId === line.id &&
        planDay.meals.length > 0
    );
}

export function PlanDayMeals({
    order,
    testID,
}: {
    readonly order: KitchenOrder;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const meals = order.planDay?.meals ?? [];
    if (meals.length === 0) return null;

    const lines = new Map(order.lines.map((line) => [line.id, line] as const));

    return (
        <View testID={testID} className="mt-1 flex-col gap-1">
            {meals.map((meal) => {
                const line = meal.lineId === null ? undefined : lines.get(meal.lineId);
                const sitting = t(`kitchen:calendar.slot.${meal.slot}`);
                const key = `${meal.slot}-${String(meal.sequence)}`;
                return (
                    <View
                        key={key}
                        testID={`${testID}-${key}`}
                        className="flex-row flex-wrap items-center gap-x-2 gap-y-1"
                    >
                        <Text variant="caption" tone="secondary">
                            {meal.sequence === 1
                                ? sitting
                                : `${sitting} ${formatter.formatNumber(meal.sequence)}`}
                        </Text>
                        <Text variant="label">{line?.nameEn ?? '—'}</Text>
                        {meal.source === 'repeated' ? (
                            <Badge
                                testID={`${testID}-${key}-repeated`}
                                tone="info"
                                label={t('kitchen:ops.orders.planDay.repeated')}
                            />
                        ) : null}
                        {meal.source === 'substituted' ? (
                            <Badge
                                testID={`${testID}-${key}-substituted`}
                                tone="warning"
                                label={t('kitchen:ops.orders.planDay.substituted')}
                            />
                        ) : null}
                        {(line?.allergens ?? []).map((allergen) => (
                            <Badge
                                key={allergen.allergenCode}
                                tone={allergen.containment === 'contains' ? 'danger' : 'warning'}
                                label={allergen.allergenCode}
                            />
                        ))}
                    </View>
                );
            })}
        </View>
    );
}
