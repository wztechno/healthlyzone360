import { Card, Icon, Text } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { EntityImage, MediaChip } from '../../media/entity-image.tsx';

import { formatMoney, nutrientValue } from './format.ts';
import { TagCluster } from './tag-cluster.tsx';

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
 * Until the Wellness Green pass that claim was only half true: energy and protein were rendered as
 * two neutral badges in the middle of the card, where they read as tags rather than as figures.
 * They are now four numbers in the footer — kcal, protein, carbs, fat — set in the display face
 * beside the price, which is what the paragraph above always meant.
 *
 * ## Why the footer is pinned
 *
 * The price is the one number a shopper compares *across* cards, and in a grid of cards whose
 * heights follow their own content it lands at a different height in every one. `Card`'s `footer`
 * pins it: the body takes the slack and every footer in a row shares one baseline, however long the
 * description or however many diet tags a meal carries. The allergen line above it holds a minimum
 * height for the same reason — a meal with nothing to declare must not pull its numbers up a line
 * relative to its neighbour.
 *
 * ## Two species, one skeleton
 *
 * The grid renders `meal` and `product` items together, and a product has no description, no diet
 * classifications and no nutrition. It gets the same card with those parts absent and **the price
 * in the same place**, because a row that mixes the two still has to let the eye run along one
 * line of prices.
 *
 * ## Where pressing it goes, and what exactly is pressable
 *
 * Wherever the parent says. Until the catalogue wave landed there was no `/meals/{meal}` to link
 * to, so the menu answered a press with an in-place drawer; now the record exists, every caller
 * navigates to it and the drawer is gone. The card itself never knew the difference — `onPress` is
 * the whole contract, which is why the handoff cost this component nothing but a paragraph.
 *
 * The *target* is narrower than it once was. The whole card used to be one `button`; the photograph
 * and the text are now that button and the diet cluster sits beside it, because the cluster has a
 * control of its own and a focusable thing inside a button is an axe `nested-interactive` failure
 * and unreachable to a screen reader besides. The consequence to know about: the footer strip — the
 * four figures and the price — no longer navigates when pressed.
 */
export interface MealCardProps {
    readonly meal: MarketplaceMeal;
    readonly onPress: () => void;
    readonly testID?: string | undefined;
}

/** The four figures the footer carries, in the order a label reads them. */
const STAT_NUTRIENTS = ['energy', 'protein', 'carbohydrate', 'fat'] as const;

interface StatProps {
    readonly label: string;
    readonly value: string;
    readonly testID: string;
}

function Stat({ label, value, testID }: StatProps) {
    return (
        <View className="flex-col gap-0.5">
            <RNText
                testID={testID}
                className="font-display text-base text-content-primary text-start"
            >
                {value}
            </RNText>
            <RNText className="text-xs font-semibold uppercase tracking-widest text-content-secondary text-start">
                {label}
            </RNText>
        </View>
    );
}

export function MealCard({ meal, onPress, testID }: MealCardProps) {
    const { t } = useTranslation();
    const formatter: Formatter = useFormatter();
    const resolvedTestID = testID ?? `meal-card-${meal.slug}`;

    const energy = nutrientValue(meal.nutrition, 'energy');
    const protein = nutrientValue(meal.nutrition, 'protein');
    const isMeal = meal.itemType === 'meal';
    const hasNutrition = isMeal && meal.nutrition.amounts.length > 0;
    const hasAllergens = meal.allergens.length > 0;

    const footer = (
        <View className="flex-col gap-3 px-4 pb-4 pt-3">
            {/*
             * Fixed minimum height whether or not there is anything to declare, so the numbers row
             * below never shifts between neighbouring cards. "No declared allergens" is stated
             * rather than left blank: on a card people scan for safety, silence and safety look the
             * same and only one of them is true.
             */}
            <View className="min-h-[18px] flex-row items-center gap-2">
                <View
                    className={
                        hasAllergens
                            ? 'h-1.5 w-1.5 rounded-full bg-warning'
                            : 'h-1.5 w-1.5 rounded-full bg-surface-brand'
                    }
                />
                <RNText
                    testID={`${resolvedTestID}-allergens`}
                    numberOfLines={1}
                    className={
                        hasAllergens
                            ? 'flex-1 text-xs text-warning-on-subtle text-start'
                            : 'flex-1 text-xs text-content-secondary text-start'
                    }
                >
                    {hasAllergens
                        ? t('marketplace:menu.containsAllergens', {
                              allergens: meal.allergens
                                  .map((code) => t(`marketplace:allergens.${code}`))
                                  .join(t('marketplace:common.listSeparator')),
                          })
                        : t('marketplace:menu.noDeclaredAllergens')}
                </RNText>
            </View>

            <View className="flex-row items-end justify-between gap-3 border-t border-surface-sunken pt-3">
                {hasNutrition ? (
                    <View
                        testID={`${resolvedTestID}-nutrition`}
                        className="flex-1 flex-row flex-wrap gap-x-4 gap-y-2"
                    >
                        {STAT_NUTRIENTS.map((nutrient) => (
                            <Stat
                                key={nutrient}
                                testID={`${resolvedTestID}-stat-${nutrient}`}
                                label={t(`marketplace:menu.stats.${nutrient}`)}
                                value={formatter.formatNumber(
                                    nutrientValue(meal.nutrition, nutrient),
                                )}
                            />
                        ))}
                    </View>
                ) : (
                    // A product carries no figures, but the price still has to land where the
                    // meal's does — so the space stays, empty.
                    <View className="flex-1" />
                )}

                <RNText
                    testID={`${resolvedTestID}-price`}
                    className="font-display text-2xl leading-tight text-surface-brand text-end"
                >
                    {formatMoney(formatter, meal.price)}
                </RNText>
            </View>
        </View>
    );

    return (
        <Card
            testID={resolvedTestID}
            padding="none"
            tone="raised"
            interactive
            footer={footer}
            /*
             * Fills the grid cell. `Card`'s own `self-stretch` is a *cross-axis* keyword and
             * `CardGridItem` is a column, so it was only ever stretching the card's width — the
             * height still came from the content, which is why a card with three lines of tags
             * stood taller than its neighbour with two. `grow` is the main-axis half of the same
             * idea, and `flexBasis` is left at `auto` deliberately: `flex-1` would set it to zero,
             * which collapses a card whose parent has no definite height (a rail, a native
             * ScrollView) rather than sizing it to its content.
             */
            className="grow"
        >
            {/*
             * The press target is this region rather than the card, and that is forced by the tag
             * cluster below it. The cluster carries a `+3 more` control, and a focusable control
             * inside a `button` is an axe `nested-interactive` failure — serious, which is what the
             * accessibility gate blocks on — as well as being genuinely unreachable to a screen
             * reader, which reads a button's label and never its innards. So the media and the text
             * are one target and the cluster is its sibling. The card's remaining strip, the
             * figures and the price, is information rather than a target; it was pressable before
             * and is not now, which is the price of the control being reachable at all.
             */}
            <Pressable
                testID={`${resolvedTestID}-open`}
                role="button"
                accessibilityRole="button"
                focusable
                onPress={onPress}
                accessibilityLabel={t('marketplace:menu.cardLabel', {
                    meal: meal.name,
                    energy,
                    protein,
                })}
                className="flex-col"
            >
                <EntityImage
                    testID={`${resolvedTestID}-image`}
                    assetId={meal.imagePlaceholderId}
                    variant="card"
                    seed={meal.slug}
                    label={t('marketplace:menu.imageLabel', { meal: meal.name })}
                    aspect="card"
                    flush
                    overlayStart={<MediaChip label={meal.kitchenName} />}
                />

                <View className="flex-col gap-2 px-4 pt-4">
                    <View className="flex-row items-start gap-2">
                        <RNText
                            numberOfLines={2}
                            className="flex-1 font-display text-lg leading-tight text-content-primary text-start"
                        >
                            {meal.name}
                        </RNText>
                        {/* Decorative: the region is already a button and announces its own name. */}
                        <Icon name="chevronEnd" className="mt-0.5 text-content-secondary" />
                    </View>

                    {/*
                     * A minimum height rather than a fixed one. Two lines is what most descriptions
                     * run to, and reserving that much stops a one-line meal sitting beside a
                     * two-line one with its tags a step higher — while a product, which has no
                     * description at all, collapses the row entirely rather than holding an empty
                     * gap.
                     */}
                    {meal.description === '' ? null : (
                        <Text
                            tone="secondary"
                            variant="caption"
                            numberOfLines={2}
                            className="min-h-[40px]"
                        >
                            {meal.description}
                        </Text>
                    )}
                </View>
            </Pressable>

            {/*
             * Clamped to two lines above `md`. A meal carries up to nine classifications and they
             * were the last thing making neighbouring cards different heights — see
             * `tag-cluster.tsx` for why the count is measured rather than fixed, and why phones
             * keep the unclamped row.
             */}
            {/*
             * Not an empty wrapper when there is nothing to put in it: the card body spaces its
             * children with a gap, so a zero-height view here would still push a product — which
             * has no classifications at all — a step away from its own footer.
             */}
            {meal.dietClassifications.length === 0 ? null : (
                <View className="px-4">
                    <TagCluster
                        testID={`${resolvedTestID}-diets`}
                        title={t('marketplace:menu.dietTagsTitle', { meal: meal.name })}
                        tags={meal.dietClassifications.map((diet) => ({
                            key: diet,
                            label: t(`marketplace:diets.${diet}`),
                        }))}
                    />
                </View>
            )}
        </Card>
    );
}
