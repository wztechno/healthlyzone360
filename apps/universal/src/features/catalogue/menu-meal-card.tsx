import { Icon, cx } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../media/entity-image.tsx';
import { YourAllergens, clashingAllergens, useMyAllergenCodes } from '../commerce/my-allergens.tsx';
import { formatMoney } from '../marketplace/format.ts';
import {
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
    /**
     * The Menu's phone card (Shop · Menu, phone board): two to a row — a 112px photograph with its
     * tag, a two-line name, the compact strip, and Add as a 34px disc in a 44px target.
     */
    readonly phone?: boolean | undefined;
    readonly testID?: string | undefined;
}

export function MenuMealCard({
    meal,
    onOpen,
    onAdd,
    compact: compactProp = false,
    phone = false,
    testID,
}: MenuMealCardProps) {
    // The phone card takes the compact strip and drops the kitchen line, but keeps its tag.
    const compact = compactProp || phone;
    const viewOnly = useShopViewOnly();
    const { t } = useTranslation();
    const formatter = useFormatter();
    const [hovered, setHovered] = useState(false);
    const id = testID ?? `meal-card-${meal.slug}`;

    const tag = leadTag(meal, t);
    const clashes = clashingAllergens(meal.allergens, useMyAllergenCodes()).length > 0;
    const tint = shelfTint(meal.publishedCategory?.code);
    const energy = publishedFigure(meal, 'energy');
    const protein = publishedFigure(meal, 'protein');
    const soldOut = isSoldOut(meal);
    const dash = t('catalogue:card.noFigure');
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
            <View
                className={cx(
                    'relative overflow-hidden',
                    phone ? 'h-[112px]' : compact ? 'h-[160px]' : 'h-[190px]',
                )}
            >
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
                {/* A dish on the person's allergy list says so where the tag would sit; the
                    warning outranks the tag. */}
                <View pointerEvents="none" className="absolute end-2.5 start-2.5 top-2.5">
                    <YourAllergens
                        allergens={meal.allergens}
                        testID={`${id}-your-allergens`}
                        variant="badge"
                    />
                </View>
                {tag === null || (compact && !phone) || clashes ? null : (
                    <View
                        pointerEvents="none"
                        className={cx(
                            'absolute justify-center rounded-full',
                            phone
                                ? 'start-2 top-2 h-[22px] px-2'
                                : 'start-2.5 top-2.5 h-[26px] px-2.5',
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

            <View
                className={cx(
                    'flex-1 flex-col',
                    phone ? 'p-2.5' : compact ? 'px-3.5 pb-3.5 pt-3' : 'px-4 py-3.5',
                )}
            >
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
                            className={cx(
                                'font-semibold text-content-primary text-start',
                                phone ? 'h-9 text-sm leading-[18px]' : 'text-base leading-snug',
                            )}
                        >
                            {meal.name}
                        </RNText>
                    </Pressable>
                    {/* A rating only where there is one: "Not rated yet" on most of a new menu
                        is a line of nothing repeated down the grid. */}
                    {meal.rating === null || phone ? null : (
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

                <CardNutrients id={id} meal={meal} compact={compact} />

                {/* `mt-auto` keeps the price and Add on the bottom edge in every card of a row. */}
                <View
                    className={cx(
                        'mt-auto flex-row items-center justify-between',
                        phone ? 'gap-1 pt-1.5' : 'gap-3 pt-3',
                    )}
                >
                    <RNText
                        testID={`${id}-price`}
                        numberOfLines={1}
                        className={cx(
                            'shrink font-display font-bold tabular-nums text-content-primary text-start',
                            phone ? 'text-base' : 'text-lg',
                        )}
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
                                    : phone
                                      ? '-me-1.5 w-11 active:scale-90'
                                      : 'w-11 bg-surface-brand transition duration-fast ease-standard active:scale-90',
                            )}
                        >
                            {soldOut ? (
                                <RNText className="text-sm font-semibold text-content-secondary">
                                    {addLabel}
                                </RNText>
                            ) : phone ? (
                                <View className="h-[34px] w-[34px] items-center justify-center rounded-full bg-surface-brand">
                                    <Icon name="plus" size="sm" className="text-content-on-brand" />
                                </View>
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

/** The three macros under the calories, in the board's order and colours. */
const MACROS: readonly {
    readonly nutrientId: string;
    readonly tint: ShelfTint;
    readonly kcalPerGram: number;
}[] = [
    { nutrientId: 'protein', tint: 'green', kcalPerGram: 4 },
    { nutrientId: 'carbohydrate', tint: 'blue', kcalPerGram: 4 },
    { nutrientId: 'fat', tint: 'yellow', kcalPerGram: 9 },
];

/**
 * The card's nutrition (Shop · Menu pins 1–2, Kitchens + storefront pin 1): the calories first as
 * a pill, beside a thin bar split by where those calories come from; then protein, carbs and fat
 * in three columns, each a colour dot, whole grams and a plain label. Nothing is cut to one line
 * and nothing is upper case, so it reads the same in a four-column grid and a storefront's compact
 * card. A figure the kitchen did not publish is a dash, never a zero; a dish with none says so in
 * one quiet pill.
 *
 * The testIDs are the old strip's (`-figures`, `-nutrient-{id}`).
 */
function CardNutrients({
    id,
    meal,
    compact,
}: {
    readonly id: string;
    readonly meal: MarketplaceMeal;
    readonly compact: boolean;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const nutrients = publishedNutrients(meal);
    const dash = t('catalogue:card.noFigure');

    if (nutrients.length === 0) {
        return (
            <View
                testID={`${id}-figures`}
                className="mt-3 h-7 flex-row items-center gap-1.5 self-start rounded-full bg-surface-base px-2.5"
            >
                <Icon name="infoCircle" size="sm" className="text-content-secondary" />
                <RNText className="text-xs text-content-secondary">
                    {t('catalogue:card.noNutrition')}
                </RNText>
            </View>
        );
    }

    const find = (nutrientId: string) => nutrients.find((entry) => entry.nutrientId === nutrientId);
    const energy = find('energy');
    // Where the calories come from, by the macros' own energy — the bar's three widths.
    const shares = MACROS.map((macro) => (find(macro.nutrientId)?.value ?? 0) * macro.kcalPerGram);
    const total = shares.reduce((sum, share) => sum + share, 0);
    // Whole grams; under one gram keeps its tenth, so a trace is not a zero.
    const grams = (value: number) =>
        formatter.formatNumber(value, {
            maximumFractionDigits: Math.abs(value) < 1 ? 1 : 0,
            minimumFractionDigits: 0,
        });

    return (
        <View
            testID={`${id}-figures`}
            aria-label={t('catalogue:card.stripLabel')}
            className={cx(
                'mt-3 rounded-[14px] bg-surface-base',
                compact ? 'px-[9px] pb-[9px] pt-2' : 'px-3 pb-[11px] pt-2.5',
            )}
        >
            <View className="flex-row items-center justify-between gap-2.5">
                <View
                    testID={`${id}-nutrient-energy`}
                    className={cx(
                        'h-7 flex-row items-center gap-1 rounded-full',
                        compact ? 'px-2' : 'px-2.5',
                        TINT_FILL.orange,
                    )}
                >
                    <Icon name="flame" size="sm" className={TINT_INK.orange} />
                    <RNText
                        className={cx(
                            'font-display text-base font-bold tabular-nums',
                            TINT_INK.orange,
                        )}
                    >
                        {energy === undefined
                            ? dash
                            : formatter.formatNumber(Math.round(energy.value))}
                    </RNText>
                    <RNText className={cx('text-xs font-semibold', TINT_INK.orange)}>
                        {t('catalogue:card.unit.kcal')}
                    </RNText>
                </View>
                {total <= 0 ? null : (
                    <View
                        aria-hidden
                        className={cx(
                            'h-1.5 shrink flex-row gap-0.5 overflow-hidden rounded-full bg-stroke-subtle',
                            compact ? 'w-10 min-w-[28px]' : 'w-[84px] min-w-[48px]',
                        )}
                    >
                        {MACROS.map((macro, index) => (
                            <View
                                key={macro.nutrientId}
                                className={cx('h-full', TINT_INK_FILL[macro.tint])}
                                style={{ flex: shares[index] ?? 0 }}
                            />
                        ))}
                    </View>
                )}
            </View>
            <View className={cx('flex-row', compact ? 'mt-2 gap-1' : 'mt-[9px] gap-1.5')}>
                {MACROS.map((macro) => {
                    const nutrient = find(macro.nutrientId);
                    return (
                        <View
                            key={macro.nutrientId}
                            testID={`${id}-nutrient-${macro.nutrientId}`}
                            className={cx(
                                'min-w-0 flex-1 flex-row items-start',
                                compact ? 'gap-1' : 'gap-1.5',
                            )}
                        >
                            <View
                                className={cx(
                                    'mt-[5px] rounded-full',
                                    compact ? 'h-1.5 w-1.5' : 'h-2 w-2',
                                    TINT_INK_FILL[macro.tint],
                                )}
                            />
                            <View className="min-w-0 shrink">
                                <RNText
                                    className={cx(
                                        'font-bold tabular-nums text-content-primary text-start',
                                        compact
                                            ? 'text-sm leading-[18px]'
                                            : 'text-sm leading-[18px]',
                                    )}
                                >
                                    {nutrient === undefined
                                        ? dash
                                        : `${grams(nutrient.value)} ${t(
                                              `catalogue:card.unit.${nutrient.unit}`,
                                              {
                                                  defaultValue: nutrient.unit,
                                              },
                                          )}`}
                                </RNText>
                                <RNText className="text-xs leading-4 text-content-secondary text-start">
                                    {t(`catalogue:card.strip.${macro.nutrientId}`)}
                                </RNText>
                            </View>
                        </View>
                    );
                })}
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
