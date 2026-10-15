import { Button, Icon } from '@healthy360/design-system';
import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';

/**
 * The comparison bar: the chosen plans, Clear, and Compare — one row, which `/plans` pins to the
 * foot of the page on the web while a selection exists.
 *
 * ## When it is here
 *
 * `/plans` mounts it once at least one plan is selected; each card's own "Compare" chip is what says
 * comparing is possible, so an empty bar would be a standing panel with nothing to say. Once
 * mounted, Compare stays put and reports itself disabled until there are two plans to set side by
 * side, rather than vanishing (a control that vanishes is one a keyboard user cannot find).
 *
 * Each chosen plan is its own remove control — the active-filter chip of `toolbar-row.tsx` — and
 * the selection can hold plans the kitchen choice has hidden: you compare across the catalogue, not
 * only across what is on screen, so the screen resolves the plans from the full set.
 *
 * The count is on the Compare button and is a live region, so adding or removing a plan is
 * announced, not merely redrawn.
 */
export interface PlanComparisonTrayProps {
    /** The chosen plans, in selection order, resolved from the unfiltered set. */
    readonly plans: readonly SubscriptionPlan[];
    /**
     * How many plans are selected, from the URL rather than from `plans`. The two agree once the
     * unfiltered set has loaded; until then the count and the button enablement must follow the URL,
     * not a list that is still resolving, or a shared link to two plans would open disabled.
     */
    readonly selectedCount: number;
    readonly onRemove: (planId: string) => void;
    readonly onClear: () => void;
    readonly onCompare: () => void;
}

export function PlanComparisonTray({
    plans,
    selectedCount,
    onRemove,
    onClear,
    onCompare,
}: PlanComparisonTrayProps) {
    const { t } = useTranslation();

    return (
        <View
            testID="plans-compare-tray"
            role="region"
            aria-label={t('catalogue:plans.compareTrayLabel')}
            className="flex-row items-center gap-3 rounded-panel border border-stroke bg-surface-raised px-4 py-3 shadow-elevation-2"
        >
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="min-w-0 flex-1"
                contentContainerClassName="flex-row items-center gap-2"
            >
                {plans.map((plan) => (
                    <Pressable
                        key={plan.id}
                        testID={`plans-compare-remove-${plan.slug}`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={t('catalogue:plans.compareRemove', { plan: plan.name })}
                        onPress={() => {
                            onRemove(String(plan.id));
                        }}
                        className="min-h-touch flex-row items-center gap-2 rounded-full border border-surface-brand bg-surface-brand-subtle px-4"
                    >
                        <RNText
                            numberOfLines={1}
                            className="max-w-[180px] text-sm font-medium text-content-on-brand-subtle"
                        >
                            {plan.name}
                        </RNText>
                        <Icon name="close" size="sm" className="text-content-on-brand-subtle" />
                    </Pressable>
                ))}
            </ScrollView>

            <View className="flex-row items-center gap-2">
                <Button
                    testID="plans-compare-clear"
                    variant="quiet"
                    size="sm"
                    label={t('catalogue:plans.compareClear')}
                    onPress={onClear}
                />
                <View role="status" aria-live="polite">
                    <Button
                        testID="plans-compare-open"
                        variant="primary"
                        label={t('catalogue:plans.compareCount', { selected: selectedCount })}
                        disabled={selectedCount < 2}
                        onPress={onCompare}
                    />
                </View>
            </View>
        </View>
    );
}
