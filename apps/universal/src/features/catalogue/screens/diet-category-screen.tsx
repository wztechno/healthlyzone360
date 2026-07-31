import {
    Breadcrumbs,
    Button,
    Callout,
    EmptyState,
    Heading,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
    mealsFromPages,
    useDietCategoryQuery,
    useMealsQuery,
    usePlansQuery,
} from '../../../data/catalogue-hooks.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { useFormatter } from '@healthy360/i18n';
import { MealCard } from '../../marketplace/meal-card.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { CardGrid, CardGridItem, SectionHeader } from '../../marketplace/section-header.tsx';
import { PlanCard } from '../plan-card.tsx';

/**
 * `/diets/{diet}` — one way of eating, with the meals and plans that match it.
 *
 * Eat This Much treats diet classification as a top-level discovery axis with its own route family
 * (doc 02, ETP-18; doc 17, IA-04 agrees with our doing the same), so the *shape* of this screen has
 * precedent. What has none is the suitability note.
 *
 * ## The suitability note is a safety control, not copy
 *
 * A diet category is a **preference filter**. It is not a medical restriction, it is not screened
 * against a condition, and — the part people get wrong — selecting "dairy free" is not the same as
 * excluding milk as an allergen. The domain vocabulary keeps all seven restriction kinds apart for
 * exactly this reason (`RESTRICTION_KINDS`, and doc 17, ONB-08 calls the distinction our clearest
 * lead over both references), and a category page that let the two blur would undo it. So the note
 * is always present, above the results, and the medical disclaimer sits with it.
 *
 * ## Two of the thirteen categories have no diet classification at all
 *
 * "Family", "office" and "weight management" are commercial groupings of *plans*, not ways of
 * eating, so they carry `classification: null` and have no meals. The screen shows the plans and
 * says the category has no dish-level classification, rather than rendering an empty grid that
 * looks like a failure.
 */
export interface DietCategoryScreenProps {
    readonly slug: string | undefined;
}

export function DietCategoryScreen({ slug }: DietCategoryScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const resolved = slug === undefined || slug === '' ? null : slug;
    const category = useDietCategoryQuery(resolved);
    const item = category.data ?? null;

    // Three of the thirteen categories are commercial groupings of plans with no dish-level
    // classification at all. Asking for their meals would be a request whose answer is discarded,
    // so the query is disabled rather than filtered afterwards.
    const classification = item?.classification ?? null;
    const meals = useMealsQuery(
        classification === null ? undefined : { dietClassifications: [classification], limit: 12 },
        classification !== null,
    );
    const mealItems = classification === null ? [] : mealsFromPages(meals.data?.pages);

    const plans = usePlansQuery(resolved === null ? undefined : { categorySlug: resolved });
    const planItems = plans.data?.items ?? [];

    return (
        <Stack space="lg" testID="diet-category-screen">
            <Breadcrumbs
                testID="diet-category-breadcrumbs"
                items={[
                    {
                        key: 'home',
                        label: t('catalogue:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    {
                        key: 'meals',
                        label: t('catalogue:nav.meals'),
                        onPress: () => {
                            router.push('/meals');
                        },
                    },
                    { key: 'diet', label: item?.name ?? t('catalogue:diet.loading') },
                ]}
            />

            <QueryStates
                query={category}
                isEmpty={item === null}
                emptyTitle={t('catalogue:diet.notFoundTitle')}
                emptyBody={t('catalogue:diet.notFoundBody')}
                emptyActions={
                    <Button
                        testID="diet-category-browse"
                        variant="secondary"
                        label={t('catalogue:diet.browseAll')}
                        onPress={() => {
                            router.push('/discover');
                        }}
                    />
                }
                skeletonCount={2}
                testID="diet-category"
            >
                {item === null ? null : (
                    <Stack space="lg">
                        <Stack space="xs">
                            <EntityImage
                                assetId={item.imagePlaceholderId}
                                variant="detail"
                                decorative
                                seed={`diet-${item.slug}`}
                                label={item.name}
                                aspect="wide"
                                className="max-h-[240px]"
                            />
                            <Heading level={1} testID="diet-category-name">
                                {item.name}
                            </Heading>
                            <Text tone="secondary">{item.description}</Text>
                            <Text testID="diet-category-counts" tone="secondary" variant="caption">
                                {t('catalogue:diet.countsLabel', {
                                    meals: formatter.formatNumber(item.mealCount),
                                    plans: formatter.formatNumber(item.planCount),
                                })}
                            </Text>
                        </Stack>

                        <Callout
                            testID="diet-category-suitability"
                            role="note"
                            tone="warning"
                            title={t('catalogue:diet.suitabilityTitle')}
                            body={t('catalogue:diet.suitabilityBody')}
                        />

                        <MedicalDisclaimer />

                        <Stack space="sm" testID="diet-category-meals">
                            <SectionHeader
                                title={t('catalogue:diet.mealsTitle')}
                                description={t('catalogue:diet.mealsBody')}
                                action={{
                                    label: t('catalogue:diet.mealsSeeAll'),
                                    onPress: () => {
                                        router.push(
                                            (item.classification === null
                                                ? '/meals'
                                                : `/meals?diet=${item.classification}`) as never,
                                        );
                                    },
                                }}
                                testID="diet-category-meals-header"
                            />
                            {classification === null ? (
                                <EmptyState
                                    testID="diet-category-meals-list-empty"
                                    title={t('catalogue:diet.mealsEmptyTitle')}
                                    body={t('catalogue:diet.mealsEmptyBody')}
                                />
                            ) : (
                                <QueryStates
                                    query={meals}
                                    isEmpty={mealItems.length === 0}
                                    emptyTitle={t('catalogue:diet.mealsEmptyTitle')}
                                    emptyBody={t('catalogue:diet.mealsEmptyBody')}
                                    testID="diet-category-meals-list"
                                >
                                    <CardGrid testID="diet-category-meals-grid">
                                        {mealItems.map((meal) => (
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
                            )}
                        </Stack>

                        <Stack space="sm" testID="diet-category-plans">
                            <SectionHeader
                                title={t('catalogue:diet.plansTitle')}
                                description={t('catalogue:diet.plansBody')}
                                action={{
                                    label: t('catalogue:diet.plansSeeAll'),
                                    onPress: () => {
                                        router.push('/plans');
                                    },
                                }}
                                testID="diet-category-plans-header"
                            />
                            <QueryStates
                                query={plans}
                                isEmpty={planItems.length === 0}
                                emptyTitle={t('catalogue:diet.plansEmptyTitle')}
                                emptyBody={t('catalogue:diet.plansEmptyBody')}
                                testID="diet-category-plans-list"
                            >
                                <CardGrid testID="diet-category-plans-grid">
                                    {planItems.map((plan) => (
                                        <CardGridItem key={plan.id}>
                                            <PlanCard
                                                plan={plan}
                                                onOpen={() => {
                                                    router.push(
                                                        `/plans/${String(plan.id)}` as never,
                                                    );
                                                }}
                                            />
                                        </CardGridItem>
                                    ))}
                                </CardGrid>
                            </QueryStates>
                        </Stack>
                    </Stack>
                )}
            </QueryStates>
        </Stack>
    );
}
