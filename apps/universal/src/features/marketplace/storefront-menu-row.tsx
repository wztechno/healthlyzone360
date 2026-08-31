import { Button, Card, Text } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../media/entity-image.tsx';

import { formatMoney } from './format.ts';

/**
 * One dish on a kitchen's storefront: a square thumbnail, the name, a line of description, the
 * price and an Add control — laid out along a row rather than down a card.
 *
 * ## Why this is not {@link MealCard} with a prop
 *
 * `MealCard` is a *browse* card. It leads with a 4:3 photograph, publishes energy, protein and the
 * allergen line, and is sized to be compared against three neighbours across a grid. This is a
 * *menu* row: the reader has already chosen the kitchen and is now reading its list, so the
 * photograph is a thumbnail and the nutrition figures are one tap away on the dish itself.
 *
 * Folding the two together would mean a card branching on `layout` through its image, its body and
 * its footer — three different components sharing a name. HealthZone draws them as two shapes
 * (`§isCatalog` against `§isStorefront`) because they answer two different questions, and they stay
 * two here for the same reason.
 *
 * ## The row is not one pressable
 *
 * Same rule `MealCard` and `plan-card.tsx` follow: `onAdd` puts a control inside the row, and a
 * focusable thing inside a `button` is an axe `nested-interactive` failure. So the *title* carries
 * the link and Add stands beside it as a peer; without `onAdd` there is nothing to collide with and
 * the whole row becomes the target.
 */
export interface StorefrontMenuRowProps {
    readonly meal: MarketplaceMeal;
    readonly onPress: () => void;
    /** Adds one of this dish to the basket. Omitted for visitors without a basket — see the screen. */
    readonly onAdd?: (() => void) | undefined;
    readonly testID?: string | undefined;
}

export function StorefrontMenuRow({ meal, onPress, onAdd, testID }: StorefrontMenuRowProps) {
    const { t } = useTranslation();
    const formatter: Formatter = useFormatter();
    const resolvedTestID = testID ?? `storefront-menu-${meal.slug}`;

    const wholeRowIsPressable = onAdd === undefined;
    const openLabel = t('marketplace:storefront.openMeal', { meal: meal.name });

    const title = (
        <RNText
            numberOfLines={2}
            className="font-display text-base leading-tight text-content-primary text-start"
        >
            {meal.name}
        </RNText>
    );

    return (
        <Card
            testID={resolvedTestID}
            padding="sm"
            tone="raised"
            interactive={wholeRowIsPressable}
            className="grow"
            onPress={wholeRowIsPressable ? onPress : undefined}
            accessibilityLabel={wholeRowIsPressable ? openLabel : undefined}
        >
            <View className="flex-row items-stretch gap-3">
                {/*
                 * Fixed square, `shrink-0`. React Native Web sets `flex-shrink: 0` on every view
                 * already, but the size has to be pinned on the wrapper rather than left to the
                 * image: `EntityImage`'s own aspect box would otherwise take its width from the row
                 * and push the text column out of it entirely.
                 */}
                <View className="h-[88px] w-[88px] shrink-0 overflow-hidden rounded-lg">
                    <EntityImage
                        testID={`${resolvedTestID}-image`}
                        assetId={meal.imagePlaceholderId}
                        variant="card"
                        seed={meal.slug}
                        label={t('marketplace:menu.imageLabel', { meal: meal.name })}
                        aspect="square"
                        flush
                    />
                </View>

                <View className="min-w-0 flex-1 flex-col">
                    {wholeRowIsPressable ? (
                        title
                    ) : (
                        <Pressable
                            testID={`${resolvedTestID}-open`}
                            role="link"
                            accessibilityRole="link"
                            accessibilityLabel={openLabel}
                            focusable
                            onPress={onPress}
                        >
                            {title}
                        </Pressable>
                    )}

                    {/*
                     * A product carries no description, so the line collapses rather than holding
                     * an empty gap — the price below it stays on the row's baseline either way,
                     * because `mt-auto` measures from whatever is above it.
                     */}
                    {meal.description === '' ? null : (
                        <Text tone="secondary" variant="caption" numberOfLines={2} className="mt-1">
                            {meal.description}
                        </Text>
                    )}

                    <View className="mt-auto flex-row items-center justify-between gap-2 pt-2">
                        <RNText
                            testID={`${resolvedTestID}-price`}
                            numberOfLines={1}
                            className="shrink text-base font-semibold text-content-primary text-start"
                        >
                            {formatMoney(formatter, meal.price)}
                        </RNText>

                        {onAdd === undefined ? null : (
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
                        )}
                    </View>
                </View>
            </View>
        </Card>
    );
}
