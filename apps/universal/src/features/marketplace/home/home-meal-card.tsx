import { Button } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { findAmount } from '@healthy360/nutrition';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';
import { formatMoney, nutrientValue } from '../format.ts';
import { PackSuffix } from '../pack-suffix.tsx';

export interface HomeMealCardProps {
    readonly meal: MarketplaceMeal;
    /** The pill on the photograph's top-leading corner. */
    readonly tag: string;
    readonly onOpen: () => void;
    readonly onAdd: () => void;
    readonly testID?: string | undefined;
}

/**
 * One card of the home's "Popular this week" grid, drawn to the design's card rather than through
 * `../meal-card.tsx`.
 *
 * The two are different cards in the design: the catalogue's is the tighter one (158-unit image,
 * name, a figure line, price) and this one is the shop window — a 176-unit photograph wearing one
 * tag, the name over a two-line description, a figure line pinned to the foot of the body, a hairline,
 * then the price and Add. Folding both into one component would have one card branching through
 * its whole layout on where it is shown.
 *
 * ## Two controls, so the card is not one
 *
 * Add is a control, and a control inside a pressable card is an axe `nested-interactive` failure —
 * the reason `plan-card.tsx` is not one target either. So the name and description are the link to
 * the meal, the photograph opens it too (no extra tab stop: the link beside it is the announced
 * one), and Add stands apart.
 *
 * ## The figure line states only what was published
 *
 * Energy and protein appear when the kitchen published them — `findAmount` is null for a nutrient
 * the set does not carry, and "0 CAL" would be a claim about the food. The rating reads "Not rated
 * yet" in its slot until somebody has rated the dish, rather than a star with nothing after it.
 */
export function HomeMealCard({ meal, tag, onOpen, onAdd, testID }: HomeMealCardProps) {
    const { t } = useTranslation();
    const formatter: Formatter = useFormatter();
    const id = testID ?? `meal-card-${meal.slug}`;

    const energy =
        findAmount(meal.nutrition, 'energy') === null
            ? null
            : formatter.formatNumber(nutrientValue(meal.nutrition, 'energy'));
    const protein =
        findAmount(meal.nutrition, 'protein') === null
            ? null
            : formatter.formatNumber(nutrientValue(meal.nutrition, 'protein'));

    const figures: { readonly key: string; readonly text: string; readonly label?: string }[] = [];
    if (energy !== null) {
        figures.push({
            key: 'energy',
            text: t('marketplace:discover.cardEnergy', { value: energy }),
        });
    }
    if (protein !== null) {
        figures.push({
            key: 'protein',
            text: t('marketplace:discover.cardProtein', { value: protein }),
        });
    }
    figures.push(
        meal.rating === null
            ? { key: 'rating', text: t('marketplace:discover.notRated') }
            : {
                  key: 'rating',
                  text: t('marketplace:discover.cardRating', {
                      value: formatter.formatNumber(meal.rating, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                      }),
                  }),
                  label: t('marketplace:discover.cardRatingLabel', {
                      meal: meal.name,
                      value: formatter.formatNumber(meal.rating, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                      }),
                  }),
              },
    );

    return (
        <View
            testID={id}
            className="grow overflow-hidden rounded-xl border border-stroke-subtle bg-surface-raised"
        >
            <View className="relative h-44">
                {/*
                 * The photograph opens the meal for a pointer, as the design's `onClick` does, but
                 * adds no tab stop: the title link below is the announced one.
                 */}
                <Pressable
                    testID={`${id}-media`}
                    onPress={onOpen}
                    focusable={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                >
                    <EntityImage
                        testID={`${id}-image`}
                        assetId={meal.imagePlaceholderId}
                        seed={meal.slug}
                        label={t('marketplace:menu.imageLabel', { meal: meal.name })}
                        aspect="card"
                        decorative
                        flush
                        className="h-44"
                    />
                </Pressable>
                {/* A sibling of the hidden photograph, so the tag is still read out. */}
                <View className="pointer-events-none absolute start-2.5 top-2.5 rounded-full bg-surface-base px-2.5 py-1">
                    <RNText
                        testID={`${id}-tag`}
                        numberOfLines={1}
                        className="text-xs font-medium uppercase tracking-wide text-content-primary"
                    >
                        {tag}
                    </RNText>
                </View>
            </View>

            <View className="flex-1 flex-col gap-2.5 p-4">
                <Pressable
                    testID={`${id}-open`}
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={meal.name}
                    onPress={onOpen}
                    className="flex-col gap-1"
                >
                    <RNText
                        numberOfLines={2}
                        className="font-display text-lg font-bold leading-tight tracking-display text-content-primary text-start"
                    >
                        {meal.name}
                    </RNText>
                    {meal.description === '' ? null : (
                        <RNText
                            numberOfLines={2}
                            className="text-sm leading-[20px] text-content-secondary text-start"
                        >
                            {meal.description}
                        </RNText>
                    )}
                </Pressable>

                {/*
                 * Each figure its own text node in a row with a gap: as bare siblings inside one
                 * text, React Native Web collapses the gap and the row reads as one number.
                 */}
                <View
                    testID={`${id}-figures`}
                    className="mt-auto flex-row flex-wrap gap-x-3 gap-y-1"
                >
                    {figures.map((figure) => (
                        <RNText
                            key={figure.key}
                            testID={`${id}-figure-${figure.key}`}
                            {...(figure.label === undefined
                                ? {}
                                : { accessibilityLabel: figure.label })}
                            className="text-xs font-medium uppercase tracking-wide tabular-nums text-content-secondary"
                        >
                            {figure.text}
                        </RNText>
                    ))}
                </View>

                <View className="flex-row items-center justify-between gap-2.5 border-t border-stroke-subtle pt-3">
                    <RNText
                        testID={`${id}-price`}
                        numberOfLines={1}
                        className="shrink font-display text-xl font-bold tabular-nums text-content-primary text-start"
                    >
                        {formatMoney(formatter, meal.price)}
                        <PackSuffix pack={meal.pack} testID={`${id}-pack`} />
                    </RNText>
                    <View className="shrink-0">
                        <Button
                            testID={`${id}-add`}
                            size="sm"
                            label={t('marketplace:menu.add')}
                            accessibilityLabel={t('marketplace:discover.addLabel', {
                                meal: meal.name,
                            })}
                            onPress={onAdd}
                        />
                    </View>
                </View>
            </View>
        </View>
    );
}
