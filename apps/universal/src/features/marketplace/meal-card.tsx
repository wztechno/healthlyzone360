import {
    Badge,
    Card,
    Chip,
    ImagePlaceholder,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

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
 * ## Why pressing it opens a drawer rather than navigating
 *
 * The meal catalogue — `/meals/{meal}`, with the full nutrition-facts panel, the ingredient list
 * and the ordering controls — belongs to the catalogue wave. Linking there now would be a link into
 * a page that does not exist, which is a dead control with extra steps. So this wave answers the
 * press in place, with the figures it genuinely has, and says plainly that the full record is
 * coming. When `/meals/{meal}` lands, the drawer's "open full details" control becomes a link and
 * nothing else about this component changes.
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
            <ImagePlaceholder
                testID={`${resolvedTestID}-image`}
                seed={meal.slug}
                label={t('marketplace:menu.imageLabel', { meal: meal.name })}
                aspect="wide"
            />

            <Stack space="sm" className="p-4">
                <Text variant="bodyStrong">{meal.name}</Text>
                <Text tone="secondary" variant="caption" numberOfLines={2}>
                    {meal.description}
                </Text>

                <Inline space="xs" wrap testID={`${resolvedTestID}-nutrition`}>
                    <Badge tone="neutral" label={t('marketplace:nutrition.energy', { energy })} />
                    <Badge tone="neutral" label={t('marketplace:nutrition.protein', { protein })} />
                </Inline>

                <Inline space="xs" wrap>
                    {meal.dietClassifications.map((diet) => (
                        <Chip key={diet} label={t(`marketplace:diets.${diet}`)} tone="brand" />
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
