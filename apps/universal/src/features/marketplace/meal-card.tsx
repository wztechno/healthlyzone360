import { Badge, Card, Inline, Stack, Text } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { EntityImage } from '../../media/entity-image.tsx';

import { formatMoney, nutrientValue } from './format.ts';

/**
 * A meal on a kitchen's menu.
 *
 * ## Nutrition on the card
 *
 * Energy and protein are on the card, not behind a tap. Neither reference product does this
 * (doc 17, IA-12 and MKT-05 record it as a deliberate divergence, and as a differentiator): in a
 * nutrition-led product, hiding the calorie figure until the detail page works against the entire
 * proposition. Allergens present in the meal are named on the card for the same reason — someone
 * scanning a menu for something they can safely eat should not have to open twelve of them.
 *
 * ## Where pressing it goes
 *
 * Wherever the parent says. Until the catalogue wave landed there was no `/meals/{meal}` to link
 * to, so the menu answered a press with an in-place drawer; now the record exists, every caller
 * navigates to it and the drawer is gone. The card itself never knew the difference — `onPress` is
 * the whole contract, which is why the handoff cost this component nothing but a paragraph.
 */
export interface MealCardProps {
    readonly meal: MarketplaceMeal;
    readonly onPress: () => void;
    readonly testID?: string | undefined;
}

export function MealCard({ meal, onPress, testID }: MealCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const resolvedTestID = testID ?? `meal-card-${meal.slug}`;

    const energy = nutrientValue(meal.nutrition, 'energy');
    const protein = nutrientValue(meal.nutrition, 'protein');

    return (
        <Card
            testID={resolvedTestID}
            padding="none"
            tone="raised"
            onPress={onPress}
            accessibilityLabel={t('marketplace:menu.cardLabel', {
                meal: meal.name,
                energy,
                protein,
            })}
        >
            <EntityImage
                testID={`${resolvedTestID}-image`}
                assetId={meal.imagePlaceholderId}
                variant="card"
                seed={meal.slug}
                label={t('marketplace:menu.imageLabel', { meal: meal.name })}
                aspect="wide"
            />

            <Stack space="sm" className="p-4">
                <Inline space="xs" align="center" wrap>
                    <Text variant="bodyStrong">{meal.name}</Text>
                    <Badge
                        testID={`${resolvedTestID}-item-type`}
                        tone="neutral"
                        icon={null}
                        label={t(`marketplace:itemTypes.${meal.itemType}`)}
                    />
                </Inline>
                <Text tone="secondary" variant="caption" numberOfLines={2}>
                    {meal.description}
                </Text>

                {meal.itemType === 'meal' && meal.nutrition.amounts.length > 0 ? (
                    <Inline space="xs" wrap testID={`${resolvedTestID}-nutrition`}>
                        <Badge
                            tone="neutral"
                            label={t('marketplace:nutrition.energy', { energy })}
                        />
                        <Badge
                            tone="neutral"
                            label={t('marketplace:nutrition.protein', { protein })}
                        />
                    </Inline>
                ) : null}

                {/* Diet classifications are read-only labels, so they are compact `Badge`s (12px,
                    tight padding) rather than touch-height `Chip`s — a card can carry seven of them
                    and they should not dominate it. The label carries the meaning, so no tone icon. */}
                <Inline space="xs" wrap>
                    {meal.dietClassifications.map((diet) => (
                        <Badge
                            key={diet}
                            tone="brand"
                            icon={null}
                            label={t(`marketplace:diets.${diet}`)}
                        />
                    ))}
                </Inline>

                {meal.allergens.length === 0 ? null : (
                    <Text testID={`${resolvedTestID}-allergens`} tone="warning" variant="caption">
                        {t('marketplace:menu.containsAllergens', {
                            allergens: meal.allergens
                                .map((code) => t(`marketplace:allergens.${code}`))
                                .join(t('marketplace:common.listSeparator')),
                        })}
                    </Text>
                )}

                <Text testID={`${resolvedTestID}-price`} variant="bodyStrong">
                    {formatMoney(formatter, meal.price)}
                </Text>
            </Stack>
        </Card>
    );
}
