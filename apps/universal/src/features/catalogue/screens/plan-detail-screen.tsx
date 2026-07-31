import {
    Badge,
    Breadcrumbs,
    Button,
    Callout,
    Card,
    Chip,
    EmptyState,
    Heading,
    Inline,
    MeterBar,
    Rating,
    SegmentedControl,
    Stack,
    Text,
} from '@healthy360/design-system';

import { EntityImage } from '../../../media/entity-image.tsx';
import type { PlanVariant, SubscriptionPlan } from '@healthy360/api-client/contracts';
import { SubscriptionPlanId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mealsFromPages, useMealsQuery, usePlanQuery } from '../../../data/catalogue-hooks.ts';
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
    const router = useRouter();
    const formatter = useFormatter();
    const { me } = useSession();
    const signedIn = me !== null;

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

    return (
        <Stack space="lg" testID="plan-detail-screen">
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
                        <Stack space="lg">
                            <EntityImage
                                testID="plan-detail-image"
                                assetId={item.imagePlaceholderId}
                                variant="detail"
                                seed={item.slug}
                                label={t('catalogue:plan.imageLabel', { plan: item.name })}
                                aspect="wide"
                            />

                            <Stack space="xs">
                                <Heading level={1} testID="plan-detail-name">
                                    {item.name}
                                </Heading>
                                <Text tone="secondary">{item.summary}</Text>
                                <Text>{item.description}</Text>
                            </Stack>

                            <Inline space="sm" align="center" wrap>
                                {kitchen.data === undefined ? null : (
                                    <Button
                                        testID="plan-detail-kitchen"
                                        size="sm"
                                        variant="ghost"
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
                                <Inline space="xs" wrap>
                                    {item.dietClassifications.map((diet) => (
                                        <Chip
                                            key={diet}
                                            tone="brand"
                                            label={t(`marketplace:diets.${diet}`)}
                                            onPress={() => {
                                                router.push(`/diets/${diet}` as never);
                                            }}
                                        />
                                    ))}
                                </Inline>
                            </Inline>

                            <Stack space="sm" testID="plan-detail-variants">
                                <Text variant="label">{t('catalogue:plan.variantsTitle')}</Text>
                                <Text tone="secondary" variant="caption">
                                    {t('catalogue:plan.variantsBody')}
                                </Text>
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
                                        min: formatter.formatNumber(selected.energyRange.min),
                                        max: formatter.formatNumber(selected.energyRange.max),
                                    })}
                                </Text>
                            </Stack>

                            <Stack space="sm" testID="plan-detail-macros">
                                <Text variant="label">{t('catalogue:plan.macrosTitle')}</Text>
                                <Text tone="secondary" variant="caption">
                                    {t('catalogue:plan.macrosBody')}
                                </Text>
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
                                            value={(entry.range.min + entry.range.max) / 2}
                                            target={macroScale}
                                            valueText={t('catalogue:plan.macroRange', {
                                                min: formatter.formatNumber(entry.range.min),
                                                max: formatter.formatNumber(entry.range.max),
                                            })}
                                        />
                                    ),
                                )}
                                <Text tone="secondary" variant="caption">
                                    {t('catalogue:compare.macroCaveat')}
                                </Text>
                            </Stack>

                            <Stack space="xs" testID="plan-detail-combination">
                                <Text variant="label">{t('catalogue:plan.combinationTitle')}</Text>
                                <Inline space="xs" wrap>
                                    <Badge
                                        tone="neutral"
                                        label={t('catalogue:plan.combinationMeals', {
                                            meals: formatter.formatNumber(selected.mealsPerDay),
                                        })}
                                    />
                                    <Badge
                                        testID="plan-detail-snacks"
                                        tone="neutral"
                                        label={
                                            selected.snacksPerDay === 0
                                                ? t('catalogue:plan.combinationNoSnacks')
                                                : t('catalogue:plan.combinationSnacks', {
                                                      snacks: formatter.formatNumber(
                                                          selected.snacksPerDay,
                                                      ),
                                                  })
                                        }
                                    />
                                </Inline>
                            </Stack>

                            <Stack space="sm" testID="plan-detail-durations">
                                <Text variant="label">{t('catalogue:plan.durationsTitle')}</Text>
                                <Text tone="secondary" variant="caption">
                                    {t('catalogue:plan.durationsBody')}
                                </Text>
                                {item.durations.map((option) => (
                                    <Inline
                                        key={option.duration}
                                        testID={`plan-detail-duration-${option.duration}`}
                                        space="sm"
                                        align="center"
                                        wrap
                                    >
                                        <Text variant="bodyStrong">
                                            {t(`catalogue:compare.duration.${option.duration}`)}
                                        </Text>
                                        <Text>
                                            {t('catalogue:plan.durationTotal', {
                                                total: formatMoney(formatter, option.totalPrice),
                                            })}
                                        </Text>
                                        <Badge
                                            tone={
                                                option.discountPercent > 0 ? 'success' : 'neutral'
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
                                    </Inline>
                                ))}
                            </Stack>

                            <Stack space="sm" testID="plan-detail-sample-menu">
                                <Text variant="label">{t('catalogue:plan.sampleMenuTitle')}</Text>
                                <Text tone="secondary" variant="caption">
                                    {t('catalogue:plan.sampleMenuBody')}
                                </Text>
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
                                                />
                                            </CardGridItem>
                                        ))}
                                    </CardGrid>
                                </QueryStates>
                            </Stack>

                            <Stack space="xs" testID="plan-detail-delivery">
                                <Text variant="label">{t('catalogue:plan.deliveryTitle')}</Text>
                                <Text>{t('catalogue:plan.deliveryBody')}</Text>
                                <Text tone="secondary" variant="caption">
                                    {t('catalogue:plan.deliveryUnpublished')}
                                </Text>
                            </Stack>

                            <Callout
                                testID="plan-detail-dietitian"
                                role="note"
                                tone="info"
                                icon="user"
                                title={t('catalogue:plan.dietitianTitle')}
                                body={t('catalogue:plan.dietitianBody')}
                                actions={
                                    <Button
                                        testID="plan-detail-find-dietitian"
                                        size="sm"
                                        variant="secondary"
                                        label={t('catalogue:plan.dietitianFind')}
                                        onPress={() => {
                                            router.push('/dietitians');
                                        }}
                                    />
                                }
                            />

                            <Card testID="plan-detail-commerce" padding="md" tone="sunken">
                                <Stack space="md">
                                    <Stack space="xs">
                                        <Text variant="label">
                                            {t('catalogue:plan.priceTitle')}
                                        </Text>
                                        <Text testID="plan-detail-price" variant="bodyStrong">
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
                                            {t('catalogue:plan.priceBothUnits')}
                                        </Text>
                                    </Stack>

                                    <Button
                                        testID="plan-detail-configure"
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
                                </Stack>
                            </Card>

                            <MedicalDisclaimer />
                        </Stack>
                    )}
                </QueryStates>
            )}
        </Stack>
    );
}
