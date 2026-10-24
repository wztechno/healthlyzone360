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
import { ROUTE_PATHS } from '@healthy360/permissions';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { mealsFromPages, useMealsQuery, usePlanQuery } from '../../../data/catalogue-hooks.ts';
import { estimatedTotal } from '../../commerce/configurator.ts';
import { configuratorHref } from '../../commerce/configurator-draft.ts';
import { variantName } from '../../commerce/configurator-steps.tsx';
import { PlanAllergyNotice } from '../../commerce/my-allergens.tsx';
import { useKitchenQuery, useSubscriptionsQuery } from '../../../data/marketplace-hooks.ts';
import { withQuery } from '../../../navigation/return-to.ts';
import { useCurrentHref, useGoToAuth, useNavigateUp } from '../../../navigation/use-return-to.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { recordResumeIntent } from '../../marketplace/resume-intent.ts';
import { useShopViewOnly } from '../../marketplace/shop-view-only.tsx';
import { CardGrid, CardGridItem } from '../../marketplace/section-header.tsx';
import { MealCard } from '../../marketplace/meal-card.tsx';
import { listDayPrice } from '../plan-balance.ts';
import { durationWithBalance } from '../plan-duration-label.ts';
import { isLiveSubscription } from '../plan-subscriber-panel.tsx';

/**
 * `/plans/{plan}` — one subscription plan.
 *
 * ## Cards at a reading width, the price beside them
 *
 * The page is held to {@link PAGE_MAX_WIDTH} and centred, and each part of the plan is its own card:
 * the overview (a small picture beside the name rather than a full-width banner), the band with
 * what arrives each day, the macros when the band publishes any, the durations, and the sample week
 * when the plan publishes one. Each card is its title and its data — no sentence explaining it. From
 * `lg` the price and the call to action sit in a card beside them that stays in view; below it,
 * that card follows the content.
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
 * rather than resetting to the advertised one. An anonymous visitor goes to sign-in with that same
 * configurator URL as `?returnTo=`, so signing in lands on the set-up for this plan and band rather
 * than on `/discover` (browse-08). While the session is still being restored the button waits — it
 * used to read a not-yet-loaded session as "signed out" and send a signed-in person to sign in
 * (AUTH-09).
 *
 * Somebody who already holds a live subscription to this plan is offered "Manage plan" first — the
 * same action the plan's card on `/plans` offers — and setting up a second one only after it
 * (plans-12).
 *
 * ## The price is a day, and a run
 *
 * The headline is the per-day price, because a plan is a balance of delivery days and that is the
 * figure captured at purchase. Under it, the shortest run at its total. It used to headline "a
 * week" — seven times the daily price — on plans that sold five-day runs (plans-20).
 *
 * ## Allergies, before anybody subscribes
 *
 * A signed-in reader sees their allergy list against the plan's sample week: which dishes cross
 * it, and the way to change the list. The kitchen reads that list at generation, so this is the
 * question "can I eat this plan?" answered where it is asked.
 *
 * ## The band is in the URL
 *
 * `?variant=`, written with `setParams`, so the band survives the kitchen link and Back, a refresh,
 * and the sign-in round trip. The page follows the URL when it changes underneath it.
 *
 * Until the commerce wave landed, this control opened a prototype dialog naming the endpoint it was
 * waiting on. Replacing it was the whole handoff: one branch, and the notice is gone.
 */
export interface PlanDetailScreenProps {
    readonly planId: string | undefined;
}

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
    const navigateUp = useNavigateUp();
    const goToAuth = useGoToAuth();
    const here = useCurrentHref();
    const formatter = useFormatter();
    // Read from the session's phase, not from `me`: `me` is also null while a stored session is
    // still being restored, and that is not the same as being signed out.
    const { phase } = useSession();
    const restoring = phase === 'restoring';
    const signedIn = phase !== 'restoring' && phase !== 'anonymous';
    // Staff view the plan and set nothing up (`shop-view-only.tsx`).
    const viewOnly = useShopViewOnly();
    const verified = phase === 'contextPending' || phase === 'ready';
    const wide = useBreakpoint().atLeast('lg');

    const parsed = planId === undefined ? null : SubscriptionPlanId.safeParse(planId);
    const plan = usePlanQuery(parsed);
    const item: SubscriptionPlan | undefined = plan.data;

    const kitchen = useKitchenQuery(item?.kitchenId ?? null);

    // The same list `/plans` reads, so it is usually cached: a person's own, asked for only once the
    // session is a verified one (anyone else is answered 401 or 403).
    const subscriptions = useSubscriptionsQuery(verified);
    const held =
        item === undefined
            ? undefined
            : (subscriptions.data?.items ?? []).find(
                  (subscription) =>
                      isLiveSubscription(subscription) &&
                      String(subscription.configuration.planId) === String(item.id),
              );

    // The band follows `?variant=` — the kitchen-profile `?tab` pattern: chosen with `setParams`, and
    // followed during render when the URL changes underneath the page.
    const params = useLocalSearchParams<{ variant?: string | string[] }>();
    const requestedVariant =
        (Array.isArray(params.variant) ? params.variant[0] : params.variant) ?? null;
    const [variantId, setVariantId] = useState<string | null>(requestedVariant);
    const [followedVariant, setFollowedVariant] = useState<string | null>(requestedVariant);
    if (followedVariant !== requestedVariant) {
        setFollowedVariant(requestedVariant);
        setVariantId(requestedVariant);
    }
    const chooseVariant = (next: string) => {
        setVariantId(next);
        router.setParams({ variant: next } as never);
    };

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

    // The server states one figure only when every configuration agrees; otherwise the total is
    // the selected variant's, derived from numbers the kitchen did quote.
    const durationTotal = (option: SubscriptionPlan['durations'][number]) => {
        const total = estimatedTotal(selected ?? null, option);
        return total === null ? null : formatMoney(formatter, total);
    };
    const shortestRun = item?.durations[0];

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
                        testID: 'plan-detail-crumb-home',
                        // The marketplace home itself, not `/` — the launch resolver, which sends an
                        // unverified account to verify its email (browse-10). `navigate`, so it adds
                        // no entry when that page is already the one underneath.
                        onPress: () => {
                            router.navigate(ROUTE_PATHS.customerHome as never);
                        },
                    },
                    {
                        key: 'plans',
                        label: t('catalogue:nav.plans'),
                        testID: 'plan-detail-crumb-plans',
                        // Back to the listing as it was left — its kitchen chip and compare tray.
                        onPress: () => {
                            navigateUp('/plans');
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
                                >
                                    <Stack space="sm">
                                        {/* One band is an answer, not a choice: a lone segment
                                            asks a question nobody can answer differently. */}
                                        {item.variants.length > 1 ? (
                                            <SegmentedControl
                                                testID="plan-detail-variant-picker"
                                                label={t('catalogue:plan.variantsTitle')}
                                                block
                                                value={String(selected.id)}
                                                onChange={chooseVariant}
                                                items={item.variants.map((variant) => ({
                                                    value: String(variant.id),
                                                    label: variantName(
                                                        variant,
                                                        formatter.formatNumber,
                                                        t,
                                                    ),
                                                    testID: `plan-detail-variant-${String(variant.id)}`,
                                                }))}
                                            />
                                        ) : null}
                                        <Text testID="plan-detail-variant-band">
                                            {t('catalogue:plan.variantLabel', {
                                                name: variantName(
                                                    selected,
                                                    formatter.formatNumber,
                                                    t,
                                                ),
                                                min: formatter.formatNumber(
                                                    selected.energyRange.min,
                                                ),
                                                max: formatter.formatNumber(
                                                    selected.energyRange.max,
                                                ),
                                            })}
                                        </Text>
                                        <Inline space="xs" wrap testID="plan-detail-combination">
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
                                    </Stack>
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
                                                            variant: variantName(
                                                                selected,
                                                                formatter.formatNumber,
                                                                t,
                                                            ),
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
                                        </Stack>
                                    </Card>
                                )}

                                <Card
                                    testID="plan-detail-durations"
                                    tone="raised"
                                    padding="md"
                                    title={t('catalogue:plan.durationsTitle')}
                                >
                                    {/* One hairline row per length: the length, its total, and
                                        what the commitment earns, read across like a price list.
                                        A plan with no length on sale says so instead. */}
                                    {item.durations.length === 0 ? (
                                        <Text testID="plan-detail-durations-none" tone="secondary">
                                            {t('catalogue:plan.noDurations')}
                                        </Text>
                                    ) : null}
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
                                                    {durationWithBalance(
                                                        option.days,
                                                        t,
                                                        formatter.formatNumber,
                                                    )}
                                                </Text>
                                                <Text className="tabular-nums">
                                                    {t('catalogue:plan.durationTotal', {
                                                        total: durationTotal(option) ?? '—',
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

                                {/* A signed-in reader's allergy list against the plan's dishes. */}
                                {signedIn ? (
                                    <Card
                                        testID="plan-detail-allergies"
                                        tone="raised"
                                        padding="md"
                                        title={t('commerce:configurator.delivery.allergensTitle')}
                                    >
                                        <PlanAllergyNotice
                                            testID="plan-detail-allergy-notice"
                                            meals={sampleMeals}
                                            checked={kitchenMeals.isFetched}
                                            returnTo={here}
                                        />
                                    </Card>
                                ) : null}

                                {/* Only once the plan's dishes have loaded: a card that says a sample is
                                    not published tells the reader nothing they can act on. */}
                                {sampleMeals.length === 0 ? null : (
                                    <Card
                                        testID="plan-detail-sample-menu"
                                        tone="raised"
                                        padding="md"
                                        title={t('catalogue:plan.sampleMenuTitle')}
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
                                    </Card>
                                )}
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
                                                {t('catalogue:plan.pricePerDay', {
                                                    price: formatMoney(
                                                        formatter,
                                                        listDayPrice(selected),
                                                    ),
                                                })}
                                            </Text>
                                            <Text testID="plan-detail-price-run" tone="secondary">
                                                {shortestRun === undefined
                                                    ? t('catalogue:plan.noDurations')
                                                    : t('catalogue:plan.priceForRun', {
                                                          run: durationWithBalance(
                                                              shortestRun.days,
                                                              t,
                                                              formatter.formatNumber,
                                                          ),
                                                          price: durationTotal(shortestRun) ?? '—',
                                                      })}
                                            </Text>
                                            <Text tone="secondary" variant="caption">
                                                {t('catalogue:plan.variantLabel', {
                                                    name: variantName(
                                                        selected,
                                                        formatter.formatNumber,
                                                        t,
                                                    ),
                                                    min: formatter.formatNumber(
                                                        selected.energyRange.min,
                                                    ),
                                                    max: formatter.formatNumber(
                                                        selected.energyRange.max,
                                                    ),
                                                })}
                                            </Text>
                                        </Stack>

                                        {held === undefined ? null : (
                                            <Button
                                                testID="plan-detail-manage"
                                                block
                                                label={t('catalogue:plans.managePlan')}
                                                accessibilityLabel={t(
                                                    'catalogue:plans.managePlanNamed',
                                                    { plan: item.name },
                                                )}
                                                onPress={() => {
                                                    router.push(
                                                        `/customer/subscriptions/${String(held.id)}` as never,
                                                    );
                                                }}
                                            />
                                        )}
                                        {viewOnly ? null : (
                                            <Button
                                                testID="plan-detail-configure"
                                                block
                                                variant={
                                                    held === undefined ? 'primary' : 'secondary'
                                                }
                                                label={
                                                    signedIn || restoring
                                                        ? t('catalogue:plan.configure')
                                                        : t('catalogue:plan.configureSignIn')
                                                }
                                                loading={restoring}
                                                disabled={restoring}
                                                onPress={() => {
                                                    const setUp = configuratorHref({
                                                        plan: String(item.id),
                                                        variant: String(selected.id),
                                                    });
                                                    if (signedIn) {
                                                        router.push(setUp as never);
                                                        return;
                                                    }
                                                    // The fallback for a sign-in that ends somewhere
                                                    // else in the tab; `returnTo` is the way back.
                                                    recordResumeIntent({
                                                        href: withQuery(
                                                            `/plans/${String(item.id)}`,
                                                            {
                                                                variant: String(selected.id),
                                                            },
                                                        ),
                                                        labelKey: 'catalogue:nav.plans',
                                                        name: item.name,
                                                    });
                                                    goToAuth('/sign-in', setUp);
                                                }}
                                            />
                                        )}
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
