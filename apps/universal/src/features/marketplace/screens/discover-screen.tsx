import { Button, Card, Stack, Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { MEAL_TYPES } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { mealsFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { EntityImage, resolveMarketingImage } from '../../../media/entity-image.tsx';
import { StorefrontHero } from '../../../ui/storefront-hero.tsx';
import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { formatMoney, nutrientValue } from '../format.ts';
import { MealCard } from '../meal-card.tsx';
import { QueryStates } from '../query-states.tsx';
import {
    CardGrid,
    CardGridItem,
    SectionHeader,
    TileGrid,
    TileGridItem,
} from '../section-header.tsx';

/** How many of the collection the front door shows before handing off to the screen that owns it. */
const PREVIEW_COUNT = 4;
/** Rows in the trailing rail. Three is what fits beside the offer panel without scrolling it. */
const RAIL_COUNT = 3;

/**
 * Discover — the marketplace's storefront.
 *
 * ## What changed, and why it is not just a repaint
 *
 * This was a *directory*: a band with a search field, a row of kitchens, and tiles for the
 * catalogue families. It opened by asking where you wanted to go. The storefront opens by showing
 * the food — a claim beside a photograph, the ways into the catalogue, then what is rated highest
 * and one way in.
 *
 * ## The search field is gone from the page, not from the product
 *
 * It moved into the chrome (`shell/marketplace-shell.tsx`), reachable from every marketplace screen
 * rather than only the four that open with a hero. A second copy here would be two inputs on one
 * page writing the same `?q=`, and the moment they disagree one of them is a bug.
 *
 * ## Categories are meal types, and that is a deliberate substitution
 *
 * The design draws categories as dish shapes — bowls, salads, wraps. This product has no such
 * taxonomy; it has `MEAL_TYPES`, and the catalogue already filters on it, so these tiles land on a
 * real filtered result. Diet categories were the closer match by name, but `availability.ts`
 * records `dietCategories: false` — `/diets` has no backend, and tiles pointing there would bounce
 * straight back here.
 *
 * ## Add appears only for people who have a basket
 *
 * Add is on every card, for everybody. It used to be offered only to signed-in people, because
 * reproducing the meal page's guest-entry dialog per grid was a screen's worth of work — that work
 * now lives in `commerce/use-basket-add.tsx` and every grid shares it, so an anonymous visitor
 * presses Add and is asked the same question the meal page asks: carry on as a guest, or sign in.
 */
export function DiscoverScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter: Formatter = useFormatter();
    const basket = useBasketAdd({ labelKey: 'marketplace:nav.discover', testID: 'discover' });

    /*
     * Sorted by rating rather than by a demand signal, because rating is what the catalogue can
     * sort on (`MEAL_SORTS`). The section is named for that — calling it "popular" would claim a
     * measure of demand that nothing here takes.
     */
    const popular = useMealsQuery({ sort: 'rating' });
    const rated = mealsFromPages(popular.data?.pages);
    const topRated = rated.slice(0, PREVIEW_COUNT);
    /*
     * The rail continues the same ranking rather than running a second query. It is honest about
     * what it is — more of the same list — where the design's "because you ordered…" is not
     * available to us: there is no consumer order-history hook, so a rail claiming to know what
     * someone ordered would be inventing the one thing that makes it worth showing.
     */
    const rail = rated.slice(PREVIEW_COUNT, PREVIEW_COUNT + RAIL_COUNT);

    const heroMeal = topRated[0];

    return (
        <Stack space="xl" testID="discover-screen">
            <StorefrontHero
                testID="discover-hero"
                eyebrow={t('marketplace:discover.heroEyebrow')}
                title={t('marketplace:discover.heroTitle')}
                body={t('marketplace:discover.heroBody')}
                imageSeed="discover-hero"
                imageLabel={t('marketplace:discover.heroImageLabel')}
                /*
                 * The photograph is the dish the overlay names — the top-rated meal's own image.
                 * There is no `discover/hero` asset in the manifest, so a fixed slot would have
                 * fallen back to a generated pattern; this way the picture, the caption and the
                 * first card below are the same dish, and stay so as the catalogue changes.
                 */
                imageAssetId={heroMeal?.imagePlaceholderId}
                overlay={
                    heroMeal === undefined
                        ? undefined
                        : {
                              label: t('marketplace:discover.heroOverlayLabel'),
                              value: `${heroMeal.name} · ${formatMoney(formatter, heroMeal.price)}`,
                          }
                }
                actions={
                    <>
                        <Button
                            testID="discover-hero-meals"
                            label={t('marketplace:discover.heroBrowseMeals')}
                            onPress={() => {
                                router.push('/meals');
                            }}
                        />
                        <Button
                            testID="discover-hero-kitchens"
                            variant="secondary"
                            label={t('marketplace:landing.browseKitchens')}
                            onPress={() => {
                                router.push('/kitchens');
                            }}
                        />
                    </>
                }
            />

            <Stack space="sm" testID="discover-categories">
                <SectionHeader
                    title={t('marketplace:discover.categoriesTitle')}
                    action={{
                        label: t('marketplace:discover.allMeals'),
                        onPress: () => {
                            router.push('/meals');
                        },
                    }}
                    testID="discover-categories-header"
                />
                <TileGrid>
                    {MEAL_TYPES.map((mealType) => (
                        <TileGridItem key={mealType}>
                            <Card
                                testID={`discover-category-${mealType}`}
                                padding="md"
                                interactive
                                onPress={() => {
                                    router.push(`/meals?mealType=${mealType}` as never);
                                }}
                                accessibilityLabel={t(`marketplace:mealTypes.${mealType}`)}
                            >
                                <Stack space="xs">
                                    <EntityImage
                                        source={resolveMarketingImage(`discover/${mealType}.tile`)}
                                        decorative
                                        seed={`discover-${mealType}`}
                                        label={t(`marketplace:mealTypes.${mealType}`)}
                                        aspect="wide"
                                    />
                                    <Text variant="bodyStrong">
                                        {t(`marketplace:mealTypes.${mealType}`)}
                                    </Text>
                                </Stack>
                            </Card>
                        </TileGridItem>
                    ))}
                </TileGrid>
            </Stack>

            <Stack space="sm" testID="discover-popular">
                <SectionHeader
                    title={t('marketplace:discover.popularTitle')}
                    meta={t('marketplace:discover.popularMeta')}
                    testID="discover-popular-header"
                />
                <QueryStates
                    query={popular}
                    isEmpty={topRated.length === 0}
                    emptyTitle={t('marketplace:menu.emptyTitle')}
                    emptyBody={t('marketplace:menu.emptyBody')}
                    testID="discover-popular-list"
                >
                    <CardGrid>
                        {topRated.map((meal) => (
                            <CardGridItem key={meal.id}>
                                <MealCard
                                    meal={meal}
                                    onPress={() => {
                                        router.push(`/meals/${String(meal.id)}` as never);
                                    }}
                                    onAdd={() => {
                                        basket.add(meal);
                                    }}
                                />
                            </CardGridItem>
                        ))}
                    </CardGrid>
                </QueryStates>
            </Stack>

            {/*
             * The closing band: one wide panel and a narrower rail beside it, stacking below `lg`.
             * The design's 1.4fr / 1fr, carried as flex weights.
             */}
            <View className="flex-col gap-4 lg:flex-row" testID="discover-closing">
                <View className="flex-1 justify-between gap-6 rounded-xl bg-surface-brand-subtle p-8 lg:flex-[1.4]">
                    <View className="flex-col gap-3">
                        <RNText className="text-xs font-semibold uppercase tracking-widest text-content-on-brand-subtle text-start">
                            {t('marketplace:discover.offerEyebrow')}
                        </RNText>
                        {/*
                         * The design's panel announces a priced bundle. There is no offers
                         * endpoint, and a hardcoded price on a storefront is the one placeholder
                         * that reads as a promise — the footer on this very shell says nothing here
                         * is an offer. So the panel keeps its shape and its job, and says something
                         * the product can actually stand behind.
                         */}
                        <RNText
                            accessibilityRole="header"
                            aria-level={2}
                            className="max-w-[420px] font-display text-3xl leading-tight tracking-display text-content-on-brand-subtle text-start"
                        >
                            {t('marketplace:discover.offerTitle')}
                        </RNText>
                        <RNText className="max-w-[460px] text-base leading-6 text-content-on-brand-subtle text-start">
                            {t('marketplace:discover.offerBody')}
                        </RNText>
                    </View>
                    <View className="flex-row">
                        <Button
                            testID="discover-offer-action"
                            label={t('marketplace:discover.offerAction')}
                            onPress={() => {
                                router.push('/plans');
                            }}
                        />
                    </View>
                </View>

                {rail.length === 0 || heroMeal === undefined ? null : (
                    <Card testID="discover-rail" padding="md" className="flex-1">
                        <Stack space="sm">
                            <RNText className="text-xs font-semibold uppercase tracking-widest text-content-secondary text-start">
                                {t('marketplace:discover.railTitle', { meal: heroMeal.name })}
                            </RNText>
                            {rail.map((meal) => (
                                <Pressable
                                    key={meal.id}
                                    testID={`discover-rail-${meal.slug}`}
                                    role="link"
                                    accessibilityRole="link"
                                    accessibilityLabel={meal.name}
                                    focusable
                                    onPress={() => {
                                        router.push(`/meals/${String(meal.id)}` as never);
                                    }}
                                    className="min-h-touch flex-row items-center gap-3"
                                >
                                    <View className="h-14 w-14 overflow-hidden rounded-lg">
                                        <EntityImage
                                            assetId={meal.imagePlaceholderId}
                                            decorative
                                            seed={meal.slug}
                                            label={meal.name}
                                            aspect="square"
                                            flush
                                        />
                                    </View>
                                    <View className="min-w-0 flex-1 flex-col gap-0.5">
                                        <RNText
                                            numberOfLines={1}
                                            className="text-sm font-semibold text-content-primary text-start"
                                        >
                                            {meal.name}
                                        </RNText>
                                        <RNText
                                            numberOfLines={1}
                                            className="text-xs text-content-secondary text-start"
                                        >
                                            {t('marketplace:discover.railFigures', {
                                                energy: formatter.formatNumber(
                                                    nutrientValue(meal.nutrition, 'energy'),
                                                ),
                                                protein: formatter.formatNumber(
                                                    nutrientValue(meal.nutrition, 'protein'),
                                                ),
                                            })}
                                        </RNText>
                                    </View>
                                    <RNText className="font-display text-base text-content-primary text-end">
                                        {formatMoney(formatter, meal.price)}
                                    </RNText>
                                </Pressable>
                            ))}
                        </Stack>
                    </Card>
                )}
            </View>

            {basket.dialog}
        </Stack>
    );
}
