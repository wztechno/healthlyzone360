import { Icon, cx } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../media/entity-image.tsx';
import { YourAllergens } from '../commerce/my-allergens.tsx';
import { formatMoney } from '../marketplace/format.ts';
import {
    cardFigureDigits,
    isSoldOut,
    leadTag,
    publishedFigure,
    publishedNutrients,
    unavailableReason,
} from './meal-readings.ts';
import { PackSuffix } from '../marketplace/pack-suffix.tsx';
import { useShopViewOnly } from '../marketplace/shop-view-only.tsx';
import { TINT_FILL, TINT_INK, TINT_INK_FILL, shelfTint } from './shelf-tints.ts';
import type { ShelfTint } from './shelf-tints.ts';

/**
 * The meal card, as the accepted Menu board draws the grid.
 *
 * ## Why not `MealCard`
 *
 * The shared `marketplace/meal-card.tsx` is a different card, and bending it into this one would
 * change other screens too, which are theirs to decide. So the board's card is drawn here for this
 * grid: a 190px photograph wearing one tag in its shelf's colour, the name, the kitchen, the four
 * figures somebody choosing by nutrition came for — calories, protein, carbohydrate and fat — and
 * the price opposite a round Add, on the card's bottom edge whatever sits above it.
 *
 * A figure the kitchen did not publish is a dash, never a zero; a meal with none says so in one
 * line instead of four dashes.
 *
 * ## Two targets, never nested
 *
 * The name is the link to the meal and Add is a separate control beside the price — a button inside
 * a pressable card is an axe `nested-interactive` failure. The photograph opens the meal as well,
 * but adds no tab stop and nothing to the accessibility tree: the name is the announced link.
 *
 * The test handles are the shared card's (`meal-card-{slug}`, `-open`, `-add`, `-price`), so a
 * suite that counts cards by their price line counts these too.
 */
export interface MenuMealCardProps {
    readonly meal: MarketplaceMeal;
    readonly onOpen: () => void;
    readonly onAdd: () => void;
    /**
     * The storefront's smaller card: a 160px photograph, no tag and no kitchen line — the page is
     * the kitchen's — and a tighter strip.
     */
    readonly compact?: boolean | undefined;
    readonly testID?: string | undefined;
}

/** The strip's four figures, in the board's order and colours. */
const STRIP: readonly { readonly nutrientId: string; readonly tint: ShelfTint }[] = [
    { nutrientId: 'energy', tint: 'orange' },
    { nutrientId: 'protein', tint: 'green' },
    { nutrientId: 'carbohydrate', tint: 'blue' },
    { nutrientId: 'fat', tint: 'yellow' },
];

export function MenuMealCard({ meal, onOpen, onAdd, compact = false, testID }: MenuMealCardProps) {
    const viewOnly = useShopViewOnly();
    const { t } = useTranslation();
    const formatter = useFormatter();
    const [hovered, setHovered] = useState(false);
    const id = testID ?? `meal-card-${meal.slug}`;

    const tag = leadTag(meal, t);
    const tint = shelfTint(meal.publishedCategory?.code);
    const energy = publishedFigure(meal, 'energy');
    const protein = publishedFigure(meal, 'protein');
    const soldOut = isSoldOut(meal);
    const dash = t('catalogue:card.noFigure');
    const nutrients = publishedNutrients(meal);
    const addLabel = !soldOut
        ? t('marketplace:discover.addLabel', { meal: meal.name })
        : unavailableReason(meal) === 'sold-out'
          ? t('catalogue:card.soldOut')
          : t('catalogue:card.unavailable');

    return (
        <View
            testID={id}
            onPointerEnter={() => {
                setHovered(true);
            }}
            onPointerLeave={() => {
                setHovered(false);
            }}
            className={cx(
                'grow flex-col overflow-hidden rounded-2xl border border-stroke-subtle bg-surface-raised transition duration-normal ease-standard',
                hovered ? '-translate-y-1 shadow-elevation-card-hover' : '',
            )}
        >
            {/* The photograph opens the meal but is hidden from assistive technology; the tag
                sits over it as a sibling so it is still read, before the name. */}
            <View className={cx('relative overflow-hidden', compact ? 'h-[160px]' : 'h-[190px]')}>
                <Pressable
                    testID={`${id}-media`}
                    onPress={onOpen}
                    focusable={false}
                    aria-hidden
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    className="h-full"
                >
                    <View
                        className={cx(
                            'h-full transition duration-slow ease-standard',
                            hovered ? 'scale-105' : '',
                        )}
                    >
                        <EntityImage
                            testID={`${id}-image`}
                            assetId={meal.imagePlaceholderId}
                            photoUrl={meal.photoUrl}
                            variant="card"
                            seed={meal.slug}
                            label={t('marketplace:menu.imageLabel', { meal: meal.name })}
                            aspect="wide"
                            flush
                            decorative
                            className="h-full"
                        />
                    </View>
                </Pressable>
                {tag === null || compact ? null : (
                    <View
                        pointerEvents="none"
                        className={cx(
                            'absolute start-2.5 top-2.5 h-[26px] justify-center rounded-full px-2.5',
                            TINT_FILL[tint],
                        )}
                    >
                        <RNText
                            testID={`${id}-tag`}
                            numberOfLines={1}
                            className={cx('text-xs font-semibold', TINT_INK[tint])}
                        >
                            {tag}
                        </RNText>
                    </View>
                )}
            </View>

            <View className={cx('flex-1 flex-col', compact ? 'px-3.5 pb-3.5 pt-3' : 'px-4 py-3.5')}>
                <View className="flex-row items-start justify-between gap-2">
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
                        className="min-w-0 shrink self-start"
                    >
                        <RNText
                            numberOfLines={2}
                            className="text-base font-semibold leading-snug text-content-primary text-start"
                        >
                            {meal.name}
                        </RNText>
                    </Pressable>
                    {/* A rating only where there is one: "Not rated yet" on most of a new menu
                        is a line of nothing repeated down the grid. */}
                    {meal.rating === null ? null : (
                        <RNText
                            testID={`${id}-rating`}
                            className="shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-content-primary"
                        >
                            {t('catalogue:card.rating', {
                                value: formatter.formatNumber(meal.rating, {
                                    minimumFractionDigits: 1,
                                    maximumFractionDigits: 1,
                                }),
                            })}
                        </RNText>
                    )}
                </View>
                {compact ? null : (
                    <RNText
                        numberOfLines={1}
                        className="mt-1 text-sm text-content-secondary text-start"
                    >
                        {meal.kitchenName}
                    </RNText>
                )}

                {nutrients.length === 0 ? (
                    <RNText
                        testID={`${id}-figures`}
                        className="mt-3 self-start text-sm text-content-secondary text-start"
                    >
                        {t('catalogue:card.noNutrition')}
                    </RNText>
                ) : (
                    <View
                        testID={`${id}-figures`}
                        aria-label={t('catalogue:card.stripLabel')}
                        className="mt-3 flex-row gap-1 rounded-2xl bg-surface-base p-1"
                    >
                        {STRIP.map((cell) => {
                            const nutrient = nutrients.find(
                                (entry) => entry.nutrientId === cell.nutrientId,
                            );
                            const isEnergy = cell.nutrientId === 'energy';
                            const value =
                                nutrient === undefined
                                    ? dash
                                    : formatter.formatNumber(nutrient.value, {
                                          maximumFractionDigits: cardFigureDigits(nutrient),
                                          minimumFractionDigits: cardFigureDigits(nutrient),
                                      });
                            return (
                                <View
                                    key={cell.nutrientId}
                                    testID={`${id}-nutrient-${cell.nutrientId}`}
                                    className={cx(
                                        'relative flex-1 flex-col items-center gap-0.5 overflow-hidden rounded-lg px-0.5 pb-1.5 pt-2',
                                        isEnergy ? TINT_FILL[cell.tint] : 'bg-surface-raised',
                                    )}
                                >
                                    <View
                                        aria-hidden
                                        className={cx(
                                            'absolute top-0 h-[3px] rounded-b-sm transition-all duration-slow ease-standard',
                                            hovered
                                                ? 'end-[10%] start-[10%]'
                                                : 'end-[22%] start-[22%]',
                                            TINT_INK_FILL[cell.tint],
                                        )}
                                    />
                                    <RNText
                                        numberOfLines={1}
                                        className={cx(
                                            compact
                                                ? 'text-sm font-bold tabular-nums'
                                                : 'text-base font-bold tabular-nums',
                                            isEnergy ? TINT_INK[cell.tint] : 'text-content-primary',
                                        )}
                                    >
                                        {value}
                                        {isEnergy || nutrient === undefined ? null : (
                                            <RNText className="text-xs font-semibold text-content-secondary">
                                                {t(`catalogue:card.unit.${nutrient.unit}`, {
                                                    defaultValue: nutrient.unit,
                                                })}
                                            </RNText>
                                        )}
                                    </RNText>
                                    <RNText
                                        numberOfLines={1}
                                        className={cx(
                                            'text-xs font-semibold uppercase tracking-wide',
                                            isEnergy
                                                ? TINT_INK[cell.tint]
                                                : 'text-content-secondary',
                                        )}
                                    >
                                        {t(`catalogue:card.strip.${cell.nutrientId}`)}
                                    </RNText>
                                </View>
                            );
                        })}
                    </View>
                )}

                <YourAllergens allergens={meal.allergens} testID={`${id}-your-allergens`} />

                {/* `mt-auto` keeps the price and Add on the bottom edge in every card of a row. */}
                <View className="mt-auto flex-row items-center justify-between gap-3 pt-3">
                    <RNText
                        testID={`${id}-price`}
                        numberOfLines={1}
                        className="shrink font-display text-lg font-bold tabular-nums text-content-primary text-start"
                    >
                        {formatMoney(formatter, meal.price)}
                        <PackSuffix pack={meal.pack} testID={`${id}-pack`} />
                    </RNText>
                    {/* Staff view the shop and add nothing (`shop-view-only.tsx`). */}
                    {viewOnly ? null : (
                        <Pressable
                            testID={`${id}-add`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={addLabel}
                            disabled={soldOut}
                            accessibilityState={{ disabled: soldOut }}
                            onPress={onAdd}
                            className={cx(
                                'h-11 shrink-0 flex-row items-center justify-center rounded-full',
                                soldOut
                                    ? 'bg-surface-sunken px-3.5'
                                    : 'w-11 bg-surface-brand transition duration-fast ease-standard active:scale-90',
                            )}
                        >
                            {soldOut ? (
                                <RNText className="text-sm font-semibold text-content-secondary">
                                    {addLabel}
                                </RNText>
                            ) : (
                                <Icon name="plus" className="text-content-on-brand" />
                            )}
                        </Pressable>
                    )}
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
                    photoUrl={meal.photoUrl}
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
