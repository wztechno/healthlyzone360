import { Button, Heading, Skeleton } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { formatMoney, publishedEnergyAndProtein } from '../format.ts';
import { QueryStates } from '../query-states.tsx';
import { CardGrid, CardGridItem, TileGrid, TileGridItem } from '../section-header.tsx';
import { HomeHeroLayout } from './home-hero.tsx';
import { HomeMealCard } from './home-meal-card.tsx';
import { CATEGORY_COUNT, POPULAR_COUNT } from './use-home-meals.ts';
import type { HomeCategory, HomeMeals } from './use-home-meals.ts';
import { usePlanOffer } from './use-plan-offer.ts';

/**
 * The sections of the storefront home — HealthZone's `home` screen — as parts a screen composes.
 *
 * Three routes open with this page: `/discover` (everybody), `/` (an anonymous visitor's landing)
 * and `/customer` (the signed-in home). The design draws one home, so all three draw these parts in
 * the design's order — the hero, "Browse by category", "Popular this week", the offer band beside
 * the recommendation card — and differ only in the hero's second button and in what the offer band
 * carries for a subscriber. Every part takes a `testID` prefix so each screen keeps its handles.
 *
 * Vertical rhythm is the design's section padding: 40 above the categories, 44 above the grid and
 * the band.
 */

/** A labelled control for the hero and the band, so screens hand over data rather than buttons. */
export interface HomeAction {
    readonly testID: string;
    readonly label: string;
    readonly onPress: () => void;
}

/* ── hero ────────────────────────────────────────────────────────────────────────────────────── */

export interface HomeHeroProps {
    readonly testID: string;
    readonly meals: HomeMeals;
    /** A standing fact about this person that outranks the catalogue's own — a next delivery. */
    readonly eyebrow?: string | undefined;
    readonly primaryTestID: string;
    /** The second button when there is no order to track. */
    readonly secondary: HomeAction;
}

/**
 * The hero, bound to real data.
 *
 * - **Eyebrow** — the design names a delivery area and a slot, which the product cannot know for a
 *   visitor. Its true counterpart in the same shape is two standing facts about the catalogue: how
 *   many kitchens are cooking it and how many meals are on it, counted over the whole listing. A
 *   screen may pass something more particular — the next subscription delivery.
 * - **Second button** — the design's "Track order #4821" when the person has an order to track,
 *   opening that order; otherwise the screen's own alternative.
 * - **Photograph and overlay** — the top-rated dish, which is also the first card below. Until the
 *   listing answers there is no dish to name, so the overlay waits rather than holding filler.
 */
export function HomeHero({ testID, meals, eyebrow, primaryTestID, secondary }: HomeHeroProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter: Formatter = useFormatter();
    const { heroMeal, latestOrder } = meals;

    const catalogueEyebrow =
        meals.total === null || meals.kitchenCount === null
            ? t('marketplace:discover.heroEyebrow')
            : `${t('marketplace:discover.heroEyebrowKitchens', { count: meals.kitchenCount })} · ${t(
                  'marketplace:discover.heroEyebrowMeals',
                  { count: meals.total },
              )}`;

    const second: HomeAction =
        latestOrder === undefined
            ? secondary
            : {
                  testID: `${testID}-track`,
                  label: t('marketplace:discover.heroTrackOrder', {
                      reference: latestOrder.reference,
                  }),
                  onPress: () => {
                      router.push(`/customer/orders/${String(latestOrder.id)}` as never);
                  },
              };

    return (
        <HomeHeroLayout
            testID={testID}
            eyebrow={eyebrow ?? catalogueEyebrow}
            title={t('marketplace:discover.heroTitle')}
            body={t('marketplace:discover.heroBody')}
            imageLabel={t('marketplace:discover.heroImageLabel')}
            imageAssetId={heroMeal?.imagePlaceholderId}
            imageSeed={testID}
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
                        testID={primaryTestID}
                        size="lg"
                        label={t('marketplace:discover.heroBrowseMeals')}
                        onPress={() => {
                            router.push('/meals');
                        }}
                    />
                    <Button
                        testID={second.testID}
                        size="lg"
                        variant="secondary"
                        label={second.label}
                        onPress={second.onPress}
                    />
                </>
            }
        />
    );
}

/* ── section header ──────────────────────────────────────────────────────────────────────────── */

/**
 * The design's section opening: the title, one trailing item on its baseline, and a rule under both.
 *
 * Local rather than `../section-header.tsx`'s `SectionHeader`, whose trailing control is a ghost
 * button — a bordered-on-hover box with primary ink — where the design's is a plain muted link
 * ("All 48 meals →") or an eyebrow ("UPDATED 6:00 AM DAILY").
 */
export function HomeSectionHeader({
    testID,
    title,
    trailing,
}: {
    readonly testID: string;
    readonly title: string;
    readonly trailing?: ReactNode;
}) {
    return (
        <View
            testID={testID}
            className="flex-row flex-wrap items-baseline justify-between gap-3 border-b border-stroke-subtle pb-3"
        >
            <Heading testID={`${testID}-title`} level={2} className="font-bold tracking-display">
                {title}
            </Heading>
            {trailing}
        </View>
    );
}

/**
 * A muted text link for a section header. The vertical padding is cancelled by an equal negative
 * margin, so the link has a 44-unit target without making the header row any taller.
 */
function HeaderLink({ testID, label, onPress }: HomeAction) {
    return (
        <Pressable
            testID={testID}
            role="link"
            accessibilityRole="link"
            onPress={onPress}
            className="-my-3 py-3"
        >
            <RNText className="text-sm font-medium text-content-secondary hover:text-content-primary">
                {label}
            </RNText>
        </Pressable>
    );
}

/* ── categories ──────────────────────────────────────────────────────────────────────────────── */

/**
 * "Browse by category" — six equal tiles, each a photograph, a name and a count, landing on the
 * catalogue filtered to it. See `useHomeMeals` for where the six come from: the meal types that
 * have a meal, then the narrower diets with the most, each counted over the whole catalogue.
 *
 * The tiles draw once the count is known, so the row does not grow from four tiles to six as the
 * diets resolve; until then it holds six skeleton tiles of the same size. A failed read draws no
 * tiles — the grid below reports the failure with its retry.
 */
export function HomeCategories({
    testID,
    meals,
}: {
    readonly testID: string;
    readonly meals: HomeMeals;
}) {
    const { t } = useTranslation();
    const router = useRouter();

    const allLabel =
        meals.total === null
            ? t('marketplace:discover.allMeals')
            : t('marketplace:discover.allMealsCount', { count: meals.total });

    const tileName = (category: HomeCategory) =>
        category.kind === 'shelf' ? category.name : t(`marketplace:diets.${category.value}`);

    const href = (category: HomeCategory) =>
        category.kind === 'shelf'
            ? `/meals?category=${encodeURIComponent(category.value)}`
            : `/meals?diet=${category.value}`;

    return (
        <View testID={`${testID}-categories`} className="mt-10 flex-col">
            <HomeSectionHeader
                testID={`${testID}-categories-header`}
                title={t('marketplace:discover.categoriesTitle')}
                trailing={
                    <HeaderLink
                        testID={`${testID}-categories-header-action`}
                        label={allLabel}
                        onPress={() => {
                            router.push('/meals');
                        }}
                    />
                }
            />
            {meals.query.isError && meals.categories.length === 0 ? null : (
                <View className="mt-4">
                    <TileGrid>
                        {!meals.settled
                            ? Array.from({ length: CATEGORY_COUNT }, (_, index) => (
                                  <TileGridItem key={index}>
                                      <View
                                          testID={`${testID}-category-skeleton-${String(index + 1)}`}
                                          className="grow gap-3 rounded-panel border border-stroke-subtle bg-surface-raised p-3"
                                      >
                                          <Skeleton heightClassName="h-24" variant="shimmer" />
                                          <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                                      </View>
                                  </TileGridItem>
                              ))
                            : meals.categories.map((category) => {
                                  const name = tileName(category);
                                  const count =
                                      category.count === null
                                          ? '—'
                                          : t('marketplace:discover.tileCount', {
                                                count: category.count,
                                            });
                                  return (
                                      <TileGridItem key={`${category.kind}-${category.value}`}>
                                          <Pressable
                                              testID={`${testID}-category-${category.value}`}
                                              role="link"
                                              accessibilityRole="link"
                                              accessibilityLabel={`${name}, ${count}`}
                                              onPress={() => {
                                                  router.push(href(category) as never);
                                              }}
                                              className="grow gap-3 rounded-panel border border-stroke-subtle bg-surface-raised p-3 hover:border-surface-brand"
                                          >
                                              <View className="h-24 overflow-hidden rounded">
                                                  <EntityImage
                                                      assetId={
                                                          category.imageMeal?.imagePlaceholderId
                                                      }
                                                      seed={`${testID}-category-${category.value}`}
                                                      label={name}
                                                      aspect="wide"
                                                      decorative
                                                      flush
                                                      className="h-24"
                                                  />
                                              </View>
                                              <View>
                                                  <RNText
                                                      numberOfLines={1}
                                                      className="font-display text-base font-bold tracking-display text-content-primary text-start"
                                                  >
                                                      {name}
                                                  </RNText>
                                                  <RNText className="mt-0.5 text-sm tabular-nums text-content-secondary text-start">
                                                      {count}
                                                  </RNText>
                                              </View>
                                          </Pressable>
                                      </TileGridItem>
                                  );
                              })}
                    </TileGrid>
                </View>
            )}
        </View>
    );
}

/* ── popular ─────────────────────────────────────────────────────────────────────────────────── */

export interface HomePopularProps {
    readonly testID: string;
    readonly meals: HomeMeals;
    /** `useBasketAdd().add` — Add is on every card, and a signed-out press asks how to continue. */
    readonly onAdd: (meal: MarketplaceMeal) => void;
}

/**
 * The design's "Popular this week" grid, titled for what it is: the top of the rating ranking.
 * The design's "updated 6:00 AM daily" is replaced by what the ranking actually is — nothing here
 * refreshes on a schedule.
 *
 * Each card's tag is the design's: the first card is "today's hero", the dish the hero pictures;
 * the others carry their narrowest diet, as the design's "HIGH PROTEIN" and "VEGETARIAN" do, or the
 * kitchen that cooks them when they have none.
 */
export function HomePopular({ testID, meals, onAdd }: HomePopularProps) {
    const { t } = useTranslation();
    const router = useRouter();

    const tagFor = (meal: MarketplaceMeal, index: number) => {
        if (index === 0) return t('marketplace:discover.heroOverlayLabel');
        const diet = meal.dietClassifications.find((value) => value !== 'omnivore');
        return diet === undefined ? meal.kitchenName : t(`marketplace:diets.${diet}`);
    };

    return (
        <View testID={`${testID}-popular`} className="mt-11 flex-col">
            <HomeSectionHeader
                testID={`${testID}-popular-header`}
                title={t('marketplace:discover.popularTitle')}
                trailing={
                    <Eyebrow testID={`${testID}-popular-header-meta`}>
                        {t('marketplace:discover.popularMeta')}
                    </Eyebrow>
                }
            />
            <View className="mt-5">
                {meals.query.isPending ? (
                    <CardGrid testID={`${testID}-popular-list-loading`}>
                        {Array.from({ length: POPULAR_COUNT }, (_, index) => (
                            <CardGridItem key={index}>
                                <View className="grow overflow-hidden rounded-xl border border-stroke-subtle bg-surface-raised">
                                    <Skeleton heightClassName="h-44" variant="shimmer" />
                                    <View className="gap-2.5 p-4">
                                        <Skeleton heightClassName="h-5" widthClassName="w-3/4" />
                                        <Skeleton heightClassName="h-4" />
                                        <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                                    </View>
                                </View>
                            </CardGridItem>
                        ))}
                    </CardGrid>
                ) : (
                    <QueryStates
                        query={meals.query}
                        isEmpty={meals.popular.length === 0}
                        emptyTitle={t('marketplace:menu.emptyTitle')}
                        emptyBody={t('marketplace:menu.emptyBody')}
                        testID={`${testID}-popular-list`}
                    >
                        <CardGrid>
                            {meals.popular.map((meal, index) => (
                                <CardGridItem key={meal.id}>
                                    <HomeMealCard
                                        meal={meal}
                                        tag={tagFor(meal, index)}
                                        onOpen={() => {
                                            router.push(`/meals/${String(meal.id)}` as never);
                                        }}
                                        onAdd={() => {
                                            onAdd(meal);
                                        }}
                                    />
                                </CardGridItem>
                            ))}
                        </CardGrid>
                    </QueryStates>
                )}
            </View>
        </View>
    );
}

/* ── closing band ────────────────────────────────────────────────────────────────────────────── */

/** What the offer band says. A subscriber's home hands in their subscription instead. */
export interface HomeOffer {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly action: HomeAction;
}

export interface HomeClosingProps {
    readonly testID: string;
    readonly meals: HomeMeals;
    readonly offer?: HomeOffer | undefined;
}

/**
 * The closing band: the brand-subtle offer panel and the recommendation card beside it, the
 * design's `1.4fr 1fr`, stacking below `lg`.
 *
 * ## The offer
 *
 * The design's is a priced bundle with an end date; there is no offers endpoint. The one discount
 * this product publishes is a plan's run discount, so the band names the best of those and opens
 * the plans (`usePlanOffer`). With no discount to name it pitches plans without a figure. A screen
 * may replace it — the signed-in home puts the person's running subscription here.
 *
 * Copy and button share one wrapping row aligned on their foot, the design's `flex-end` + `wrap`:
 * the copy takes its natural width up to the panel's, and the button drops beneath it when the two
 * do not fit on one line.
 *
 * ## The card
 *
 * "Because you ordered …" when the person's latest order names a dish the catalogue lists, and the
 * meals most like it; otherwise more of the rating ranking, titled as such. Drawn only when there is
 * something past the grid to show — an empty card beside the panel would be a box with a heading.
 */
export function HomeClosing({ testID, meals, offer }: HomeClosingProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter: Formatter = useFormatter();
    const planOffer = usePlanOffer();

    const shown: HomeOffer =
        offer ??
        (planOffer === null
            ? {
                  eyebrow: t('marketplace:discover.offerFallbackEyebrow'),
                  title: t('marketplace:discover.offerFallbackTitle'),
                  body: t('marketplace:discover.offerFallbackBody'),
                  action: {
                      testID: `${testID}-offer-action`,
                      label: t('marketplace:discover.offerFallbackAction'),
                      onPress: () => {
                          router.push('/plans');
                      },
                  },
              }
            : {
                  eyebrow: t('marketplace:discover.offerEyebrow'),
                  title: t('marketplace:discover.offerTitle', {
                      count: planOffer.weeks,
                      percent: formatter.formatNumber(planOffer.percent),
                  }),
                  body: t('marketplace:discover.offerBody'),
                  action: {
                      testID: `${testID}-offer-action`,
                      label: t('marketplace:discover.offerAction'),
                      onPress: () => {
                          router.push('/plans');
                      },
                  },
              });

    const { rail } = meals;

    return (
        <View testID={`${testID}-closing`} className="mt-11 flex-col gap-4 lg:flex-row">
            <View
                testID={`${testID}-offer`}
                className="flex-row flex-wrap items-end justify-between gap-6 rounded-xl bg-surface-brand-subtle p-6 sm:px-9 sm:py-8 lg:flex-[1.4]"
            >
                <View className="max-w-full flex-col">
                    <Eyebrow testID={`${testID}-offer-eyebrow`} tone="primary">
                        {shown.eyebrow}
                    </Eyebrow>
                    <RNText
                        testID={`${testID}-offer-title`}
                        accessibilityRole="header"
                        aria-level={2}
                        className="mt-3 max-w-[460px] font-display text-3xl font-bold leading-[34px] sm:text-4xl sm:leading-[38px] tracking-display text-content-primary text-start"
                    >
                        {shown.title}
                    </RNText>
                    <RNText
                        testID={`${testID}-offer-body`}
                        className="mt-2 text-base text-content-primary text-start"
                    >
                        {shown.body}
                    </RNText>
                </View>
                <View className="shrink-0 flex-row">
                    <Button
                        testID={shown.action.testID}
                        size="lg"
                        label={shown.action.label}
                        onPress={shown.action.onPress}
                    />
                </View>
            </View>

            {rail.meals.length === 0 ? null : (
                <View
                    testID={`${testID}-rail`}
                    className="rounded-xl border border-stroke-subtle bg-surface-raised p-6 lg:flex-1"
                >
                    <Eyebrow testID={`${testID}-rail-title`}>
                        {rail.orderedName === null
                            ? t('marketplace:discover.railTitle')
                            : t('marketplace:discover.becauseYouOrdered', {
                                  meal: rail.orderedName,
                              })}
                    </Eyebrow>
                    <View className="mt-4 flex-col gap-3">
                        {rail.meals.map((meal) => {
                            const figures = publishedEnergyAndProtein(meal.nutrition);
                            return (
                                <Pressable
                                    key={meal.id}
                                    testID={`${testID}-rail-${meal.slug}`}
                                    role="link"
                                    accessibilityRole="link"
                                    accessibilityLabel={meal.name}
                                    onPress={() => {
                                        router.push(`/meals/${String(meal.id)}` as never);
                                    }}
                                    className="min-h-touch flex-row items-center gap-3"
                                >
                                    <View className="h-14 w-14 overflow-hidden rounded">
                                        <EntityImage
                                            assetId={meal.imagePlaceholderId}
                                            decorative
                                            seed={meal.slug}
                                            label={meal.name}
                                            aspect="square"
                                            flush
                                        />
                                    </View>
                                    <View className="min-w-0 flex-1 flex-col">
                                        <RNText
                                            numberOfLines={1}
                                            className="text-base font-semibold leading-tight text-content-primary text-start"
                                        >
                                            {meal.name}
                                        </RNText>
                                        {figures === null ? null : (
                                            <RNText
                                                numberOfLines={1}
                                                className="text-sm tabular-nums text-content-secondary text-start"
                                            >
                                                {t('marketplace:discover.railFigures', {
                                                    energy: formatter.formatNumber(figures.energy),
                                                    protein: formatter.formatNumber(
                                                        figures.protein,
                                                    ),
                                                })}
                                            </RNText>
                                        )}
                                    </View>
                                    <RNText className="shrink-0 font-display text-base font-bold tabular-nums text-content-primary text-end">
                                        {formatMoney(formatter, meal.price)}
                                    </RNText>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>
            )}
        </View>
    );
}

/**
 * The three sections below the hero, in the design's order. A screen that wants something between
 * them composes the parts itself.
 */
export function HomeSections({
    testID,
    meals,
    onAdd,
    offer,
}: {
    readonly testID: string;
    readonly meals: HomeMeals;
    readonly onAdd: (meal: MarketplaceMeal) => void;
    readonly offer?: HomeOffer | undefined;
}) {
    return (
        <>
            <HomeCategories testID={testID} meals={meals} />
            <HomePopular testID={testID} meals={meals} onAdd={onAdd} />
            <HomeClosing testID={testID} meals={meals} offer={offer} />
        </>
    );
}
