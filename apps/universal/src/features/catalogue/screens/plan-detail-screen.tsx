import {
    Badge,
    Breadcrumbs,
    Button,
    Card,
    EmptyState,
    Heading,
    Inline,
    MeterBar,
    Rating,
    SegmentedControl,
    Stack,
    TagRow,
    Text,
    useBreakpoint,
} from '@healthy360/design-system';

import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { EntityImage } from '../../../media/entity-image.tsx';
import type { PlanVariant, SubscriptionPlan } from '@healthy360/api-client/contracts';
import { SubscriptionPlanId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { mealsFromPages, useMealsQuery, usePlanQuery } from '../../../data/catalogue-hooks.ts';
import { discountedTotalMinorUnits, weeksFor } from '../../commerce/configurator.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { useSession } from '../../../session/session-provider.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { recordResumeIntent } from '../../marketplace/resume-intent.ts';
import { CardGrid, CardGridItem } from '../../marketplace/section-header.tsx';
import { MealCard } from '../../marketplace/meal-card.tsx';

/**
 * `/plans/{plan}` — one subscription plan.
 *
 * ## Cards at a reading width, the price beside them
 *
 * The page is held to {@link PAGE_MAX_WIDTH} and centred, and each part of the plan is its own card:
 * the overview (a small picture beside the name rather than a full-width banner), the band, what
 * arrives each day, the macros when the band publishes any, the durations, the sample week and the
 * delivery note. From `lg` the price and the call to action sit in a card beside them that stays in
 * view; below it, that card follows the content.
 *
 * ## Marketing above, transaction below, and never interleaved
 *
 * Doc 17, IA-13 records the reference product merging the two on one page, so that somebody
 * re-configuring a plan scrolls through testimonials to reach the price. Here the order is fixed:
 * what the plan is, then the band, then the macros, then the composition, then the durations and
 * the price, then the call to action. Nothing marketing-shaped appears below the configuration.
 *
 * ## Ranges, drawn as relative bars
 *
 * A macro range is not progress toward anything, so a meter that filled to 100 % would be a lie
 * with a nice gradient. The bars here share one scale — the largest macro figure in the band — so
 * their *lengths* compare the three macronutrients against each other, while the text next to each
 * one carries the actual range. Doc 09, RBN-03 and IMP-01: a rotating menu has no single true
 * protein figure, and a point value would be false precision.
 *
 * ## The call to action
 *
 * A signed-in press goes straight to `/customer/subscriptions/new`, carrying both the plan and the
 * variant the person was looking at — so the configurator opens on the calorie band they chose here
 * rather than resetting to the advertised one. An anonymous visitor gets a real navigation to
 * sign-in with the page recorded, so the plan is one press away once they are back.
 *
 * Until the commerce wave landed, this control opened a prototype dialog naming the endpoint it was
 * waiting on. Replacing it was the whole handoff: one branch, and the notice is gone.
 */
export interface PlanDetailScreenProps {
    readonly planId: string | undefined;
}

const DAYS_PER_WEEK = 7;

/** The page's reading width: the content column and the price card beside it, and no wider. */
const PAGE_MAX_WIDTH = 1080;
/** The price card beside the content from `lg`. */
const ASIDE_WIDTH = 320;
/** The plan's picture in the overview card, beside its name rather than above the page. */
const IMAGE_WIDTH = 200;

/** The three macro ranges of a variant, in label order, with their translation keys. */
function macroRanges(variant: PlanVariant) {
    return [
        { nutrientId: 'protein', range: variant.proteinRange },
        { nutrientId: 'carbohydrate', range: variant.carbohydrateRange },
        { nutrientId: 'fat', range: variant.fatRange },
    ] as const;
}

export function PlanDetailScreen({ planId }: PlanDetailScreenProps) {
    const { t } = useTranslation();
    const basket = useBasketAdd({ labelKey: 'catalogue:nav.plans', testID: 'plan-detail' });
    const router = useRouter();
    const formatter = useFormatter();
    const { me } = useSession();
    const signedIn = me !== null;
    const wide = useBreakpoint().atLeast('lg');

    const parsed = planId === undefined ? null : SubscriptionPlanId.safeParse(planId);
    const plan = usePlanQuery(parsed);
    const item: SubscriptionPlan | undefined = plan.data;

    const kitchen = useKitchenQuery(item?.kitchenId ?? null);

    const [variantId, setVariantId] = useState<string | null>(null);

    // The middle variant is the advertised one, so it is what an unopened page should be showing.
    const selected: PlanVariant | undefined =
        item === undefined
            ? undefined
            : (item.variants.find((variant) => String(variant.id) === variantId) ??
              item.variants[Math.floor(item.variants.length / 2)]);

    // The sample menu is drawn from the kitchen's own menu in one request rather than five
    // `getMeal` calls; the plan publishes identifiers, and this is the query that already holds
    // that kitchen's meals.
    const kitchenMeals = useMealsQuery(
        item === undefined ? undefined : { kitchenIds: [item.kitchenId], limit: 50 },
    );
    const sampleIds = new Set((item?.sampleMealIds ?? []).map((id) => String(id)));
    const sampleMeals = mealsFromPages(kitchenMeals.data?.pages).filter((meal) =>
        sampleIds.has(String(meal.id)),
    );

    const browseAction = (
        <Button
            testID="plan-detail-browse"
            variant="secondary"
            label={t('catalogue:plan.browseAll')}
            onPress={() => {
                router.push('/plans');
            }}
        />
    );

    const macroScale =
        selected === undefined
            ? 1
            : Math.max(1, ...macroRanges(selected).map((entry) => entry.range?.max ?? 0));

    const durationTotal = (option: SubscriptionPlan['durations'][number]) =>
        formatMoney(
            formatter,
            // The server states one figure only when every configuration agrees; otherwise the
            // total is the selected variant's, derived from numbers the kitchen did quote.
            option.totalPrice ?? {
                amount: discountedTotalMinorUnits(
                    selected?.pricePerWeek.amount ?? 0,
                    weeksFor(option.duration),
                    option.discountPercent,
                ),
                currency: selected?.pricePerWeek.currency ?? 'USD',
            },
        );

    return (
        // Held to a reading width and centred, breadcrumbs included, so the page does not run the
        // full width of a desktop window: a plan is read top to bottom, and a 1,400px line is not.
        <View
            testID="plan-detail-screen"
            className="w-full flex-col gap-6 self-center"
            style={{ maxWidth: PAGE_MAX_WIDTH }}
        >
            <Breadcrumbs
                testID="plan-detail-breadcrumbs"
                items={[
                    {
                        key: 'home',
                        label: t('catalogue:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    {
                        key: 'plans',
                        label: t('catalogue:nav.plans'),
                        onPress: () => {
                            router.push('/plans');
                        },
                    },
                    { key: 'plan', label: item?.name ?? t('catalogue:plan.loading') },
                ]}
            />

            {/* A link carrying something that is not an identifier leaves the query disabled, and
                a disabled query never settles: the not-found answer is rendered directly rather
                than behind a skeleton that would spin for ever. */}
            {parsed === null ? (
                <EmptyState
                    testID="plan-detail-empty"
                    title={t('catalogue:plan.notFoundTitle')}
                    body={t('catalogue:plan.notFoundBody')}
                    actions={browseAction}
                />
            ) : (
                <QueryStates
                    query={plan}
                    isEmpty={item === undefined}
                    emptyTitle={t('catalogue:plan.notFoundTitle')}
                    emptyBody={t('catalogue:plan.notFoundBody')}
                    emptyActions={browseAction}
                    skeletonCount={2}
                    testID="plan-detail"
                >
                    {item === undefined || selected === undefined ? null : (
                        /*
                         * The plan in cards on the left, the price and the one way forward in a
                         * card beside them that stays in view while the reader scrolls. Below `lg`
                         * the price card follows the content, where the scroll ends.
                         */
                        <View className="flex-col gap-6 lg:flex-row lg:items-start">
                            <View className="min-w-0 flex-1 flex-col gap-4">
                                <Card testID="plan-detail-overview" tone="raised" padding="md">
                                    <View className="flex-col gap-4 sm:flex-row">
                                        <View
                                            className="overflow-hidden rounded-lg"
                                            style={wide ? { width: IMAGE_WIDTH } : undefined}
                                        >
                                            <EntityImage
                                                testID="plan-detail-image"
                                                assetId={item.imagePlaceholderId}
                                                variant="card"
                                                seed={item.slug}
                                                label={t('catalogue:plan.imageLabel', {
                                                    plan: item.name,
                                                })}
                                                aspect="card"
                                            />
                                        </View>

                                        <Stack space="sm" className="min-w-0 flex-1">
                                            <Heading level={1} testID="plan-detail-name">
                                                {item.name}
                                            </Heading>
                                            {item.summary === '' ? null : (
                                                <Text tone="secondary">{item.summary}</Text>
                                            )}
                                            {item.description === '' ? null : (
                                                <Text>{item.description}</Text>
                                            )}
                                            <Inline space="sm" align="center" wrap>
                                                {kitchen.data === undefined ? null : (
                                                    <Button
                                                        testID="plan-detail-kitchen"
                                                        size="sm"
                                                        variant="secondary"
                                                        label={t('catalogue:plan.byKitchen', {
                                                            kitchen: kitchen.data.name,
                                                        })}
                                                        onPress={() => {
                                                            router.push(
                                                                `/kitchens/${String(item.kitchenId)}` as never,
                                                            );
                                                        }}
                                                    />
                                                )}
                                                {item.rating === null ? null : (
                                                    <Rating
                                                        testID="plan-detail-rating"
                                                        label={t('catalogue:plans.ratingLabel', {
                                                            plan: item.name,
                                                        })}
                                                        value={item.rating}
                                                        count={item.ratingCount}
                                                        size="sm"
                                                    />
                                                )}
                                            </Inline>
                                            {/* Labels, not links — `/diets/{diet}` has no backend yet. */}
                                            {item.dietClassifications.length === 0 ? null : (
                                                <TagRow
                                                    testID="plan-detail-diets"
                                                    items={item.dietClassifications.map((diet) => ({
                                                        key: diet,
                                                        label: t(`marketplace:diets.${diet}`),
                                                        tone: 'brand' as const,
                                                    }))}
                                                />
                                            )}
                                        </Stack>
                                    </View>
                                </Card>

                                <Card
                                    testID="plan-detail-variants"
                                    tone="raised"
                                    padding="md"
                                    title={t('catalogue:plan.variantsTitle')}
                                    subtitle={t('catalogue:plan.variantsBody')}
                                >
                                    <Stack space="sm">
                                        <SegmentedControl
                                            testID="plan-detail-variant-picker"
                                            label={t('catalogue:plan.variantsTitle')}
                                            block
                                            value={String(selected.id)}
                                            onChange={setVariantId}
                                            items={item.variants.map((variant) => ({
                                                value: String(variant.id),
                                                label: variant.name,
                                                testID: `plan-detail-variant-${String(variant.id)}`,
                                            }))}
                                        />
                                        <Text testID="plan-detail-variant-band">
                                            {t('catalogue:plan.variantLabel', {
                                                name: selected.name,
                                                min: formatter.formatNumber(
                                                    selected.energyRange.min,
                                                ),
                                                max: formatter.formatNumber(
                                                    selected.energyRange.max,
                                                ),
                                            })}
                                        </Text>
                                    </Stack>
                                </Card>

                                <Card
                                    testID="plan-detail-combination"
                                    tone="raised"
                                    padding="md"
                                    title={t('catalogue:plan.combinationTitle')}
                                >
                                    <Inline space="xs" wrap>
                                        <Badge
                                            tone="neutral"
                                            label={t('catalogue:plan.combinationMeals', {
                                                count: selected.mealsPerDay,
                                            })}
                                        />
                                        <Badge
                                            testID="plan-detail-snacks"
                                            tone="neutral"
                                            label={
                                                selected.snacksPerDay === 0
                                                    ? t('catalogue:plan.combinationNoSnacks')
                                                    : t('catalogue:plan.combinationSnacks', {
                                                          count: selected.snacksPerDay,
                                                      })
                                            }
                                        />
                                    </Inline>
                                </Card>

                                {/* Only when the band publishes a figure: a card of nothing but its
                                    own caveat says less than leaving it out. */}
                                {macroRanges(selected).every(
                                    (entry) => entry.range === null,
                                ) ? null : (
                                    <Card
                                        testID="plan-detail-macros"
                                        tone="raised"
                                        padding="md"
                                        title={t('catalogue:plan.macrosTitle')}
                                        subtitle={t('catalogue:plan.macrosBody')}
                                    >
                                        <Stack space="sm">
                                            {macroRanges(selected).map((entry) =>
                                                entry.range === null ? null : (
                                                    <MeterBar
                                                        key={entry.nutrientId}
                                                        testID={`plan-detail-macro-${entry.nutrientId}`}
                                                        label={t('catalogue:plan.macroBandLabel', {
                                                            nutrient: t(
                                                                `marketplace:nutrients.${entry.nutrientId}`,
                                                            ),
                                                            variant: selected.name,
                                                        })}
                                                        value={
                                                            (entry.range.min + entry.range.max) / 2
                                                        }
                                                        target={macroScale}
                                                        valueText={t('catalogue:plan.macroRange', {
                                                            min: formatter.formatNumber(
                                                                entry.range.min,
                                                            ),
                                                            max: formatter.formatNumber(
                                                                entry.range.max,
                                                            ),
                                                        })}
                                                    />
                                                ),
                                            )}
                                            <Text tone="secondary" variant="caption">
                                                {t('catalogue:compare.macroCaveat')}
                                            </Text>
                                        </Stack>
                                    </Card>
                                )}

                                <Card
                                    testID="plan-detail-durations"
                                    tone="raised"
                                    padding="md"
                                    title={t('catalogue:plan.durationsTitle')}
                                    subtitle={t('catalogue:plan.durationsBody')}
                                >
                                    {/* One hairline row per length: the length, its total, and
                                        what the commitment earns, read across like a price list. */}
                                    <View className="flex-col">
                                        {item.durations.map((option, index) => (
                                            <View
                                                key={option.duration}
                                                testID={`plan-detail-duration-${option.duration}`}
                                                className={
                                                    index === 0
                                                        ? 'min-h-touch flex-row flex-wrap items-center gap-3 py-2'
                                                        : 'min-h-touch flex-row flex-wrap items-center gap-3 border-t border-stroke-subtle py-2'
                                                }
                                            >
                                                <Text
                                                    variant="bodyStrong"
                                                    className="min-w-0 flex-1"
                                                >
                                                    {t(
                                                        `catalogue:compare.duration.${option.duration}`,
                                                    )}
                                                </Text>
                                                <Text className="tabular-nums">
                                                    {t('catalogue:plan.durationTotal', {
                                                        total: durationTotal(option),
                                                    })}
                                                </Text>
                                                <Badge
                                                    tone={
                                                        option.discountPercent > 0
                                                            ? 'success'
                                                            : 'neutral'
                                                    }
                                                    label={
                                                        option.discountPercent > 0
                                                            ? t('catalogue:plan.durationDiscount', {
                                                                  discount: formatter.formatNumber(
                                                                      option.discountPercent,
                                                                  ),
                                                              })
                                                            : t('catalogue:plan.durationNoDiscount')
                                                    }
                                                />
                                            </View>
                                        ))}
                                    </View>
                                </Card>

                                <Card
                                    testID="plan-detail-sample-menu"
                                    tone="raised"
                                    padding="md"
                                    title={t('catalogue:plan.sampleMenuTitle')}
                                    subtitle={t('catalogue:plan.sampleMenuBody')}
                                >
                                    {/* A settled read with nothing to show is one quiet line in
                                        the card, not a full empty state inside it. */}
                                    {kitchenMeals.isSuccess && sampleMeals.length === 0 ? (
                                        <Text
                                            testID="plan-detail-sample-none"
                                            tone="secondary"
                                            variant="caption"
                                        >
                                            {t('catalogue:plan.sampleMenuEmpty')}
                                        </Text>
                                    ) : (
                                        <QueryStates
                                            query={kitchenMeals}
                                            isEmpty={sampleMeals.length === 0}
                                            emptyTitle={t('catalogue:plan.sampleMenuEmpty')}
                                            skeletonCount={2}
                                            testID="plan-detail-sample"
                                        >
                                            <CardGrid testID="plan-detail-sample-grid">
                                                {sampleMeals.map((meal) => (
                                                    <CardGridItem key={meal.id}>
                                                        <MealCard
                                                            meal={meal}
                                                            onPress={() => {
                                                                router.push(
                                                                    `/meals/${String(meal.id)}` as never,
                                                                );
                                                            }}
                                                            onAdd={() => {
                                                                basket.add(meal);
                                                            }}
                                                        />
                                                    </CardGridItem>
                                                ))}
                                            </CardGrid>
                                        </QueryStates>
                                    )}
                                </Card>

                                <Card
                                    testID="plan-detail-delivery"
                                    tone="raised"
                                    padding="md"
                                    title={t('catalogue:plan.deliveryTitle')}
                                >
                                    <Stack space="xs">
                                        <Text>{t('catalogue:plan.deliveryBody')}</Text>
                                        <Text tone="secondary" variant="caption">
                                            {t('catalogue:plan.deliveryUnpublished')}
                                        </Text>
                                    </Stack>
                                </Card>

                                <MedicalDisclaimer />
                            </View>

                            <View
                                className="flex-col gap-4 web:sticky web:top-0"
                                style={wide ? { width: ASIDE_WIDTH } : undefined}
                            >
                                <Card
                                    testID="plan-detail-commerce"
                                    padding="md"
                                    tone="raised"
                                    title={t('catalogue:plan.priceTitle')}
                                >
                                    <Stack space="md">
                                        <Stack space="xs">
                                            <Text
                                                testID="plan-detail-price"
                                                variant="display"
                                                className="tabular-nums"
                                            >
                                                {t('catalogue:plan.pricePerWeek', {
                                                    price: formatMoney(
                                                        formatter,
                                                        selected.pricePerWeek,
                                                    ),
                                                })}
                                            </Text>
                                            <Text tone="secondary">
                                                {t('catalogue:plan.pricePerDay', {
                                                    price: formatMoney(formatter, {
                                                        amount: Math.round(
                                                            selected.pricePerWeek.amount /
                                                                DAYS_PER_WEEK,
                                                        ),
                                                        currency: selected.pricePerWeek.currency,
                                                    }),
                                                })}
                                            </Text>
                                            <Text tone="secondary" variant="caption">
                                                {t('catalogue:plan.variantLabel', {
                                                    name: selected.name,
                                                    min: formatter.formatNumber(
                                                        selected.energyRange.min,
                                                    ),
                                                    max: formatter.formatNumber(
                                                        selected.energyRange.max,
                                                    ),
                                                })}
                                            </Text>
                                        </Stack>

                                        <Button
                                            testID="plan-detail-configure"
                                            block
                                            label={
                                                signedIn
                                                    ? t('catalogue:plan.configure')
                                                    : t('catalogue:plan.configureSignIn')
                                            }
                                            onPress={() => {
                                                if (signedIn) {
                                                    router.push(
                                                        `/customer/subscriptions/new?plan=${String(item.id)}&variant=${String(selected.id)}` as never,
                                                    );
                                                    return;
                                                }
                                                recordResumeIntent({
                                                    href: `/plans/${String(item.id)}`,
                                                    labelKey: 'catalogue:nav.plans',
                                                    name: item.name,
                                                });
                                                router.push('/sign-in');
                                            }}
                                        />

                                        <Text tone="secondary" variant="caption">
                                            {t('catalogue:plan.priceBothUnits')}
                                        </Text>
                                    </Stack>
                                </Card>
                            </View>
                        </View>
                    )}
                </QueryStates>
            )}

            {basket.dialog}
        </View>
    );
}
