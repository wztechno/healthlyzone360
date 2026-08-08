import { Button, Icon, IconButton, Inline, Stack, Text } from '@healthy360/design-system';
import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EntityImage } from '../../media/entity-image.tsx';

/**
 * The comparison tray.
 *
 * ## Why it is always here, even empty
 *
 * The comparison action cannot appear and disappear: a person who has selected nothing still needs
 * to be told that comparing is possible and why the button is dormant, and the tests — and screen
 * readers — expect `plans-compare-open` to exist and report itself disabled rather than to be missing
 * (a control that vanishes is a control a keyboard user cannot find). So the tray is persistent; it
 * is *slim* when empty and fills with what you have chosen, rather than materialising from nowhere.
 *
 * The count is a live region, so adding or removing a plan is announced, not merely redrawn. Each
 * chosen plan keeps its own remove control — one target that both opened and removed would be
 * unrecoverable by accident (`Chip`'s docstring makes the same argument). The selection can hold
 * plans that the current filters have hidden, which is deliberate: you compare across the catalogue,
 * not only across whatever is on screen right now, so the tray resolves its plans from the full set.
 */
export interface PlanComparisonTrayProps {
    /** The chosen plans, in selection order, resolved from the unfiltered set (for the thumbnails). */
    readonly plans: readonly SubscriptionPlan[];
    /**
     * How many plans are selected, from the URL rather than from `plans`. The two agree once the
     * unfiltered set has loaded; until then the count and the button enablement must follow the URL,
     * not a list that is still resolving, or a shared link to two plans would open disabled.
     */
    readonly selectedCount: number;
    readonly max: number;
    readonly onRemove: (planId: string) => void;
    readonly onClear: () => void;
    readonly onCompare: () => void;
}

export function PlanComparisonTray({
    plans,
    selectedCount,
    max,
    onRemove,
    onClear,
    onCompare,
}: PlanComparisonTrayProps) {
    const { t } = useTranslation();
    const count = selectedCount;

    return (
        <View
            testID="plans-compare-tray"
            role="region"
            aria-label={t('catalogue:plans.compareTrayLabel')}
            className="rounded-panel border border-stroke-default bg-surface-raised p-4 shadow-elevation-1"
        >
            <Stack space="sm">
                <Inline space="sm" align="center" justify="between" wrap>
                    <Stack space="none">
                        <Text variant="bodyStrong">{t('catalogue:plans.compareTitle')}</Text>
                        <Text
                            testID="plans-compare-count"
                            role="status"
                            aria-live="polite"
                            variant="caption"
                            tone="secondary"
                        >
                            {t('catalogue:plans.compareSelected', { selected: count })}
                        </Text>
                    </Stack>

                    <Inline space="sm" align="center" wrap>
                        {count > 0 ? (
                            <Button
                                testID="plans-compare-clear"
                                variant="ghost"
                                size="sm"
                                label={t('catalogue:plans.compareClear')}
                                onPress={onClear}
                            />
                        ) : null}
                        <Button
                            testID="plans-compare-open"
                            variant="primary"
                            label={t('catalogue:plans.compareOpen')}
                            disabled={count < 2}
                            onPress={onCompare}
                        />
                    </Inline>
                </Inline>

                {count === 0 ? (
                    <Text testID="plans-compare-empty" variant="caption" tone="secondary">
                        {t('catalogue:plans.compareEmpty')}
                    </Text>
                ) : (
                    <Inline space="sm" wrap>
                        {plans.map((plan) => (
                            <View
                                key={plan.id}
                                testID={`plans-compare-item-${plan.slug}`}
                                className="flex-row items-center gap-2 rounded-lg border border-stroke-subtle bg-surface-base py-1 pe-1 ps-2"
                            >
                                <EntityImage
                                    assetId={plan.imagePlaceholderId}
                                    variant="card"
                                    seed={plan.slug}
                                    label={plan.name}
                                    aspect="square"
                                    decorative
                                    className="h-8 w-8 rounded-md"
                                />
                                <Text variant="caption" numberOfLines={1} className="max-w-[140px]">
                                    {plan.name}
                                </Text>
                                <IconButton
                                    testID={`plans-compare-remove-${plan.slug}`}
                                    size="sm"
                                    label={t('catalogue:plans.compareRemove', { plan: plan.name })}
                                    icon={<Icon name="close" size="sm" />}
                                    onPress={() => {
                                        onRemove(String(plan.id));
                                    }}
                                />
                            </View>
                        ))}
                    </Inline>
                )}

                {count >= max ? (
                    <Text testID="plans-compare-full" variant="caption" tone="secondary">
                        {t('catalogue:plans.compareFull')}
                    </Text>
                ) : null}
            </Stack>
        </View>
    );
}
