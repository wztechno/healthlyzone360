import { Icon } from '@healthy360/design-system';
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
            className="mx-auto h-[68px] w-full max-w-[600px] flex-row items-center gap-3 rounded-[22px] bg-content-primary pe-2.5 ps-[18px] shadow-elevation-4"
        >
            <RNText className="font-display text-base font-bold text-surface-base">
                {t('catalogue:plans.compareChosen', { count: selectedCount })}
            </RNText>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="min-w-0 flex-1"
                contentContainerClassName="flex-row items-center gap-1.5"
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
                        className="h-8 flex-row items-center gap-1 rounded-full bg-surface-base/15 px-2.5"
                    >
                        <RNText
                            numberOfLines={1}
                            className="max-w-[140px] text-xs font-semibold text-surface-base"
                        >
                            {plan.name}
                        </RNText>
                        <Icon name="close" size="sm" className="text-surface-base" />
                    </Pressable>
                ))}
            </ScrollView>
            <View role="status" aria-live="polite">
                <Pressable
                    testID="plans-compare-open"
                    role="button"
                    accessibilityRole="button"
                    disabled={selectedCount < 2}
                    accessibilityState={{ disabled: selectedCount < 2 }}
                    onPress={onCompare}
                    className={
                        selectedCount < 2
                            ? 'h-12 justify-center rounded-[14px] bg-surface-brand px-[18px] opacity-50'
                            : 'h-12 justify-center rounded-[14px] bg-surface-brand px-[18px] hover:bg-surface-canopy'
                    }
                >
                    <RNText className="text-sm font-bold text-content-on-brand">
                        {t('catalogue:plans.compareCount', { selected: selectedCount })}
                    </RNText>
                </Pressable>
            </View>
            <Pressable
                testID="plans-compare-clear"
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('catalogue:plans.compareClear')}
                onPress={onClear}
                className="h-10 w-10 items-center justify-center rounded-xl bg-surface-base/15"
            >
                <Icon name="close" size="sm" className="text-surface-base" />
            </Pressable>
        </View>
    );
}
