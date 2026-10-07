import { Button } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../media/entity-image.tsx';
import { formatMoney } from '../marketplace/format.ts';
import { isSoldOut, leadTag, publishedFigure, unavailableReason } from './meal-readings.ts';
import { PackSuffix } from '../marketplace/pack-suffix.tsx';

/**
 * HealthZone's meal card, as the menu grid draws it (`customer.dc.html`, `§isCatalog`).
 *
 * ## Why not `MealCard`
 *
 * The shared `marketplace/meal-card.tsx` is a different card: a 4:3 photograph wearing the kitchen
 * chip, the name with a star rating on its baseline, two lines of description, an allergen line,
 * four macro tiles and a ruled footer. The design's card is a 158px photograph with one tag, the
 * name, one line of small figures — `620 CAL · 48G P · ★ 4.8` — and the price opposite Add. Bending
 * the shared card into that would change the home page and the storefront too, which are other
 * screens' to decide, so the design's card is drawn here for this grid.
 *
 * ## Two targets, never nested
 *
 * The name is the link to the meal and Add is a separate control beside the price — a button inside
 * a pressable card is an axe `nested-interactive` failure. The photograph opens the meal as well,
 * as the design's `onClick` does, but adds no tab stop and nothing to the accessibility tree: the
 * name is the announced link.
 *
 * The test handles are the shared card's (`meal-card-{slug}`, `-open`, `-add`, `-price`), so a
 * suite that counts cards by their price line counts these too.
 */
export interface MenuMealCardProps {
    readonly meal: MarketplaceMeal;
    readonly onOpen: () => void;
    readonly onAdd: () => void;
    readonly testID?: string | undefined;
}

/** The design's mono figure line: 11px, tracked, uppercase — Inter at the bottom of the scale. */
const FIGURE_CLASS =
    'text-xs font-medium uppercase tracking-wide tabular-nums text-content-secondary';

export function MenuMealCard({ meal, onOpen, onAdd, testID }: MenuMealCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const id = testID ?? `meal-card-${meal.slug}`;

    const tag = leadTag(meal, t);
    const energy = publishedFigure(meal, 'energy');
    const protein = publishedFigure(meal, 'protein');
    const soldOut = isSoldOut(meal);
    const dash = t('catalogue:card.noFigure');

    return (
        <View
            testID={id}
            className="grow flex-col overflow-hidden rounded-xl border border-stroke bg-surface-raised"
        >
            {/* The photograph opens the meal but is hidden from assistive technology; the tag
                sits over it as a sibling so it is still read, before the name. */}
            <View className="relative h-[158px]">
                <Pressable
                    testID={`${id}-media`}
                    onPress={onOpen}
                    focusable={false}
                    aria-hidden
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    className="h-full"
                >
                    <EntityImage
                        testID={`${id}-image`}
                        assetId={meal.imagePlaceholderId}
                        variant="card"
                        seed={meal.slug}
                        label={t('marketplace:menu.imageLabel', { meal: meal.name })}
                        aspect="wide"
                        flush
                        decorative
                        className="h-full"
                    />
                </Pressable>
                {tag === null ? null : (
                    <View
                        pointerEvents="none"
                        className="absolute start-2.5 top-2.5 rounded-full bg-surface-raised px-2.5 py-1"
                    >
                        <RNText
                            testID={`${id}-tag`}
                            numberOfLines={1}
                            className="text-xs font-medium uppercase tracking-wide text-content-primary"
                        >
                            {tag}
                        </RNText>
                    </View>
                )}
            </View>

            <View className="flex-1 flex-col gap-2 p-[14px]">
                <Pressable
                    testID={`${id}-open`}
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={t('marketplace:menu.cardLabel', {
                        meal: meal.name,
                        energy: energy ?? dash,
                        protein: protein ?? dash,
                    })}
                    onPress={onOpen}
                    className="self-start"
                >
                    <RNText
                        numberOfLines={2}
                        className="font-display text-lg font-bold leading-tight tracking-display text-content-primary text-start"
                    >
                        {meal.name}
                    </RNText>
                </Pressable>

                <View testID={`${id}-figures`} className="flex-row flex-wrap gap-x-2.5">
                    <RNText className={FIGURE_CLASS}>
                        {t('catalogue:card.calories', {
                            value: energy === null ? dash : formatter.formatNumber(energy),
                        })}
                    </RNText>
                    <RNText className={FIGURE_CLASS}>
                        {t('catalogue:card.protein', {
                            value: protein === null ? dash : formatter.formatNumber(protein),
                        })}
                    </RNText>
                    <RNText testID={`${id}-rating`} className={FIGURE_CLASS}>
                        {meal.rating === null
                            ? t('catalogue:card.notRated')
                            : t('catalogue:card.rating', {
                                  value: formatter.formatNumber(meal.rating, {
                                      minimumFractionDigits: 1,
                                      maximumFractionDigits: 1,
                                  }),
                              })}
                    </RNText>
                </View>

                <View className="mt-auto flex-row items-center justify-between gap-3 pt-2.5">
                    <RNText
                        testID={`${id}-price`}
                        numberOfLines={1}
                        className="shrink font-display text-lg font-bold tabular-nums text-content-primary text-start"
                    >
                        {formatMoney(formatter, meal.price)}
                        <PackSuffix pack={meal.pack} testID={`${id}-pack`} />
                    </RNText>
                    <View className="shrink-0">
                        <Button
                            testID={`${id}-add`}
                            size="sm"
                            variant="primary"
                            label={
                                !soldOut
                                    ? t('marketplace:menu.add')
                                    : unavailableReason(meal) === 'sold-out'
                                      ? t('catalogue:card.soldOut')
                                      : t('catalogue:card.unavailable')
                            }
                            disabled={soldOut}
                            onPress={onAdd}
                        />
                    </View>
                </View>
            </View>
        </View>
    );
}

export interface RelatedMealCardProps {
    readonly meal: MarketplaceMeal;
    readonly onOpen: () => void;
    readonly testID?: string | undefined;
}

/**
 * The smaller card under a meal — HealthZone's "Pairs well with" row: a 140px photograph, then the
 * name and its calories opposite the price. It carries no control of its own, so the whole card is
 * the one target.
 */
export function RelatedMealCard({ meal, onOpen, testID }: RelatedMealCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const id = testID ?? `meal-card-${meal.slug}`;

    const energy = publishedFigure(meal, 'energy');
    const protein = publishedFigure(meal, 'protein');
    const dash = t('catalogue:card.noFigure');

    return (
        <Pressable
            testID={id}
            role="link"
            accessibilityRole="link"
            accessibilityLabel={t('marketplace:menu.cardLabel', {
                meal: meal.name,
                energy: energy ?? dash,
                protein: protein ?? dash,
            })}
            onPress={onOpen}
            className="grow flex-col overflow-hidden rounded-xl border border-stroke bg-surface-raised hover:border-stroke-strong"
        >
            <View className="h-[140px]">
                <EntityImage
                    testID={`${id}-image`}
                    assetId={meal.imagePlaceholderId}
                    variant="card"
                    seed={meal.slug}
                    label={t('marketplace:menu.imageLabel', { meal: meal.name })}
                    aspect="wide"
                    flush
                    decorative
                    className="h-full"
                />
            </View>
            <View className="flex-1 flex-row items-center justify-between gap-2 p-[14px]">
                <View className="min-w-0 flex-1 flex-col">
                    <RNText
                        numberOfLines={2}
                        className="text-base font-semibold leading-snug text-content-primary text-start"
                    >
                        {meal.name}
                    </RNText>
                    <RNText className="text-xs tabular-nums text-content-secondary text-start">
                        {t('catalogue:card.calories', {
                            value: energy === null ? dash : formatter.formatNumber(energy),
                        })}
                    </RNText>
                </View>
                <RNText
                    testID={`${id}-price`}
                    numberOfLines={1}
                    className="shrink-0 font-display text-lg font-bold tabular-nums text-content-primary"
                >
                    {formatMoney(formatter, meal.price)}
                    <PackSuffix pack={meal.pack} testID={`${id}-pack`} />
                </RNText>
            </View>
        </Pressable>
    );
}
