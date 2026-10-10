import { Button, cx } from '@healthy360/design-system';
import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { PillChip } from '../../ui/pill-chip.tsx';
import { balanceDaysFor, maxDiscountPercent, mealsPerDayRange } from './plan-balance.ts';
import { StatePill, SubtleButton } from './plan-controls.tsx';
import { PlanPrice } from './plan-price.tsx';

/**
 * A subscription plan in the catalogue — HealthZone's plan card, element for element: the name and
 * its line over a "Current" mark, the big per-day price with the balance under it, four bulleted
 * facts, and the full-width action at the foot ("Choose …", or "Manage plan" on the one you hold).
 *
 * ## Why the card is not itself pressable
 *
 * Every other card on the marketplace is one big button, and that is right for a kitchen or a meal:
 * one target, one destination. A plan card carries *two* controls — the comparison toggle and the
 * main action — and a toggle nested inside a button is unreachable by keyboard on the web,
 * ambiguous to a screen reader, and on touch it opens the plan when the person meant to tick
 * "compare". So the card is a plain grouping element with named controls inside it.
 *
 * ## What the card adds to the drawing, and where
 *
 * The design's three cards are one kitchen's plans. Here the catalogue is many kitchens', so two
 * things ride along in places the drawing already has: the kitchen's name leads the tagline line,
 * and the comparison toggle is a `chip()` in the header's trailing slot — the slot the design gives
 * the "Current" mark — so the card's vertical rhythm (name, price, facts, action) is untouched.
 *
 * ## Every line is a fact the plan publishes
 *
 * The design's bullets ("Under 550 calories", "Priority slots at 12:00") are sample copy. Here each
 * one is derived from the plan record — the meals a day its configurations serve, the calorie
 * bands, the balances it is sold in and the largest discount a longer one earns — so a plan never
 * advertises something its kitchen did not configure.
 */
export interface PlanCardProps {
    readonly plan: SubscriptionPlan;
    readonly onOpen: () => void;
    /** The kitchen's name, resolved by the screen — plans carry only a `kitchenId`. */
    readonly kitchenName?: string | undefined;
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

function Feature({ children, testID }: { readonly children: string; readonly testID?: string }) {
    return (
        <View testID={testID} className="flex-row items-start gap-2">
            {/* The bullet is decoration; the line reads on its own. */}
            <View
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-content-on-brand-subtle"
            />
            <RNText className="flex-1 text-sm leading-normal text-content-primary text-start">
                {children}
            </RNText>
        </View>
    );
}

export function PlanCard({
    plan,
    onOpen,
    kitchenName,
    comparison,
    current,
    testID,
}: PlanCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const resolvedTestID = testID ?? `plan-card-${plan.slug}`;

    const meals = mealsPerDayRange(plan);
    const discount = maxDiscountPercent(plan);
    const balances = plan.durations.map((option) =>
        formatter.formatNumber(balanceDaysFor(option.duration)),
    );
    const bands = plan.variants
        .map((variant) =>
            t('catalogue:plans.energyBand', {
                min: formatter.formatNumber(variant.energyRange.min),
                max: formatter.formatNumber(variant.energyRange.max),
            }),
        )
        .join(' · ');
    const tagline =
        kitchenName === undefined || kitchenName === ''
            ? plan.summary
            : t('catalogue:plans.taglineWithKitchen', {
                  kitchen: kitchenName,
                  summary: plan.summary,
              });

    return (
        <View
            testID={resolvedTestID}
            className={cx(
                // `grow` fills the grid cell, which is what lets the action below pin every card's
                // foot to one baseline across a row.
                'grow self-stretch flex-col rounded-panel bg-surface-raised px-5 pb-6 pt-5',
                current === undefined ? 'border border-stroke' : 'border-2 border-surface-brand',
            )}
        >
            <View className="flex-row items-start justify-between gap-3">
                <View className="min-w-0 flex-1 flex-col gap-1">
                    <RNText
                        accessibilityRole="header"
                        aria-level={3}
                        className="font-display text-xl font-bold tracking-display text-content-primary text-start"
                    >
                        {plan.name}
                    </RNText>
                    <RNText
                        testID={`${resolvedTestID}-tagline`}
                        numberOfLines={2}
                        className="text-sm text-content-secondary text-start"
                    >
                        {tagline}
                    </RNText>
                </View>
                {current === undefined && comparison === undefined ? null : (
                    <View className="shrink-0 flex-col items-end gap-2">
                        {current === undefined ? null : (
                            <StatePill
                                testID={`${resolvedTestID}-current`}
                                tone="brand"
                                label={t('catalogue:plans.currentPlan')}
                            />
                        )}
                        {comparison === undefined ? null : (
                            <PillChip
                                size="sm"
                                floor="coarse"
                                testID={`${resolvedTestID}-compare`}
                                label={t('catalogue:plans.compareLabel')}
                                accessibilityLabel={t('catalogue:plans.compareNamed', {
                                    plan: plan.name,
                                })}
                                selected={comparison.selected}
                                disabled={comparison.disabled}
                                onPress={() => {
                                    comparison.onChange(!comparison.selected);
                                }}
                            />
                        )}
                    </View>
                )}
            </View>

            <View className="mt-5">
                <PlanPrice plan={plan} testID={`${resolvedTestID}-price`} />
            </View>

            <View className="mt-5 flex-col gap-2">
                {meals === null ? null : (
                    <Feature testID={`${resolvedTestID}-meals`}>
                        {meals.min === meals.max
                            ? t('catalogue:plans.featureMeals', { count: meals.min })
                            : t('catalogue:plans.featureMealsRange', {
                                  min: formatter.formatNumber(meals.min),
                                  max: formatter.formatNumber(meals.max),
                              })}
                    </Feature>
                )}
                {bands === '' ? null : (
                    <Feature testID={`${resolvedTestID}-bands`}>
                        {t('catalogue:plans.featureBands', { bands })}
                    </Feature>
                )}
                {balances.length === 0 ? null : (
                    <Feature testID={`${resolvedTestID}-balances`}>
                        {t('catalogue:plans.featureBalances', { sizes: balances.join(' · ') })}
                    </Feature>
                )}
                {discount > 0 ? (
                    <Feature testID={`${resolvedTestID}-discount`}>
                        {t('catalogue:plans.featureDiscount', {
                            discount: formatter.formatNumber(discount),
                        })}
                    </Feature>
                ) : null}
            </View>

            {/* The action sits at the foot, so every card's button lines up across a row. */}
            <View className="mt-auto pt-5">
                {current === undefined ? (
                    <Button
                        testID={`${resolvedTestID}-open`}
                        variant="primary"
                        size="lg"
                        block
                        label={t('catalogue:plans.choosePlan', { plan: plan.name })}
                        onPress={onOpen}
                    />
                ) : (
                    <SubtleButton
                        testID={`${resolvedTestID}-manage`}
                        size="lg"
                        block
                        label={t('catalogue:plans.managePlan')}
                        accessibilityLabel={t('catalogue:plans.managePlanNamed', {
                            plan: plan.name,
                        })}
                        onPress={current.onManage}
                    />
                )}
            </View>
        </View>
    );
}
