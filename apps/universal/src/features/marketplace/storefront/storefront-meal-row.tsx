import { Button } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { findAmount } from '@healthy360/nutrition';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';
import { allergenKey, formatMoney, nutrientValue } from '../format.ts';
import { PackSuffix } from '../pack-suffix.tsx';

/**
 * One dish on a kitchen's storefront — HealthZone `§isStorefront`, the Menu tab's row: a square
 * thumbnail, the name, a line of description, energy and protein, the allergen line, then the price
 * and Add on the row's foot.
 *
 * ## Why this is not {@link MealCard} with a prop
 *
 * `MealCard` is a *browse* card: a 4:3 photograph leading, four macro tiles, sized to be compared
 * against three neighbours across a grid of every kitchen's food. This is a *menu* row — the reader
 * has already chosen the kitchen and is reading its list — so the photograph is a thumbnail and the
 * figures are one line of text rather than four tiles. Folding the two into one component would be
 * a card branching on `layout` through its image, its body and its footer.
 *
 * ## The row is not one pressable
 *
 * Add is always offered (`useBasketAdd` turns an anonymous press into the guest-entry question), and
 * a control inside a pressable is an axe `nested-interactive` failure. So the *title* — and the
 * thumbnail beside it, as the design has it — carry the link, and Add stands beside them as a peer.
 * The same rule `MealCard` and `plan-card.tsx` follow.
 *
 * ## Only what the kitchen published
 *
 * The figure line names energy and protein only where the listing carries them: `findAmount` is
 * null for an absent nutrient, where `nutrientValue` would print a zero — and "0 g protein" is a
 * claim about the food. A product with no figures has no line at all. The allergen line appears
 * only when something is declared; the full declaration, including "none", is on the dish's page.
 */
export interface StorefrontMealRowProps {
    readonly meal: MarketplaceMeal;
    readonly onOpen: () => void;
    readonly onAdd: () => void;
    readonly testID?: string | undefined;
}

export function StorefrontMealRow({ meal, onOpen, onAdd, testID }: StorefrontMealRowProps) {
    const { t } = useTranslation();
    const formatter: Formatter = useFormatter();
    const resolvedTestID = testID ?? `storefront-menu-${meal.slug}`;
    const openLabel = t('marketplace:storefront.openMeal', { meal: meal.name });

    const figures = [
        findAmount(meal.nutrition, 'energy') === null
            ? null
            : t('marketplace:storefront.row.energy', {
                  value: formatter.formatNumber(nutrientValue(meal.nutrition, 'energy')),
              }),
        findAmount(meal.nutrition, 'protein') === null
            ? null
            : t('marketplace:storefront.row.protein', {
                  value: formatter.formatNumber(nutrientValue(meal.nutrition, 'protein')),
              }),
    ].filter((figure) => figure !== null);

    return (
        <View
            testID={resolvedTestID}
            className="grow rounded-panel border border-stroke bg-surface-raised p-3 web:hover:border-stroke-strong"
        >
            <View className="flex-row items-stretch gap-3">
                {/*
                 * A fixed square, pinned on the wrapper rather than left to the image: the image's
                 * own aspect box would otherwise take its width from the row and push the text
                 * column out of it. Not focusable — the title beside it is the same link, and two
                 * tab stops for one destination is one too many.
                 */}
                <Pressable
                    testID={`${resolvedTestID}-thumb`}
                    onPress={onOpen}
                    focusable={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    className="h-[100px] w-[100px] shrink-0 overflow-hidden rounded-lg"
                >
                    <EntityImage
                        testID={`${resolvedTestID}-image`}
                        assetId={meal.imagePlaceholderId}
                        variant="card"
                        seed={meal.slug}
                        label={t('marketplace:menu.imageLabel', { meal: meal.name })}
                        aspect="square"
                        decorative
                        flush
                    />
                </Pressable>

                <View className="min-w-0 flex-1 flex-col gap-1">
                    <Pressable
                        testID={`${resolvedTestID}-open`}
                        role="link"
                        accessibilityRole="link"
                        accessibilityLabel={openLabel}
                        focusable
                        onPress={onOpen}
                    >
                        <RNText
                            numberOfLines={2}
                            className="font-display text-base font-bold leading-tight text-content-primary text-start"
                        >
                            {meal.name}
                        </RNText>
                    </Pressable>

                    {meal.description === '' ? null : (
                        <RNText
                            numberOfLines={2}
                            className="text-sm leading-snug text-content-secondary text-start"
                        >
                            {meal.description}
                        </RNText>
                    )}

                    {figures.length === 0 ? null : (
                        <RNText
                            testID={`${resolvedTestID}-figures`}
                            numberOfLines={1}
                            className="text-xs font-medium uppercase tabular-nums tracking-wide text-content-secondary text-start"
                        >
                            {figures.join(t('marketplace:storefront.separator'))}
                        </RNText>
                    )}

                    {meal.allergens.length === 0 ? null : (
                        <RNText
                            testID={`${resolvedTestID}-allergens`}
                            numberOfLines={2}
                            className="text-xs font-medium text-warning-on-subtle text-start"
                        >
                            {t('marketplace:menu.containsAllergens', {
                                allergens: meal.allergens
                                    .map((code) => t(allergenKey(code)))
                                    .join(t('marketplace:common.listSeparator')),
                            })}
                        </RNText>
                    )}

                    <View className="mt-auto flex-row items-center justify-between gap-2 pt-1.5">
                        <RNText
                            testID={`${resolvedTestID}-price`}
                            numberOfLines={1}
                            className="shrink font-display text-base font-bold tabular-nums text-content-primary text-start"
                        >
                            {formatMoney(formatter, meal.price)}
                            <PackSuffix pack={meal.pack} testID={`${resolvedTestID}-pack`} />
                        </RNText>

                        <View className="shrink-0">
                            <Button
                                testID={`${resolvedTestID}-add`}
                                size="sm"
                                variant="primary"
                                label={t('marketplace:menu.add')}
                                accessibilityLabel={t('marketplace:storefront.addLabel', {
                                    meal: meal.name,
                                })}
                                onPress={onAdd}
                            />
                        </View>
                    </View>
                </View>
            </View>
        </View>
    );
}
