import {
    Badge,
    Button,
    Callout,
    Card,
    Chip,
    EmptyState,
    Heading,
    Inline,
    NumberStepper,
    Select,
    Stack,
    Table,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';

import { EntityImage } from '../../../media/entity-image.tsx';
import { RecipeId } from '@healthy360/domain-types';
import type { MealType } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { amountValue } from '@healthy360/nutrition';
import type { IngredientQuantity } from '@healthy360/nutrition';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    useAddEntryMutation,
    useCurrentPlanQuery,
    useRecipeQuery,
} from '../../../data/planner-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { useSession } from '../../../session/session-provider.tsx';
import { AllergenList } from '../../catalogue/allergen-list.tsx';
import { NutritionFactsPanel } from '../../catalogue/nutrition-facts-panel.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { PLANNER_MEAL_TYPES, dateInstant } from '../format.ts';

/**
 * `/customer/recipes/{recipe}` — the **home-prepared** recipe record.
 *
 * The specification insists five things stay separate concepts — ingredient, recipe, kitchen recipe
 * version, marketplace meal, meal-plan entry — and this screen is the one that would collapse two of
 * them if it were careless. `/meals/{meal}` already exists and shows a *marketplace meal*: a
 * sellable product with a price, availability windows and a sales channel. This shows a *recipe*: a
 * composition of ingredients with quantities, method steps, a version identifier and figures derived
 * from that composition. They share a nutrition panel and nothing else, which is why the panel is
 * imported from the catalogue feature rather than reimplemented.
 *
 * ## Provenance is contractual here, not decorative
 *
 * `Recipe.version` is bumped on every edit and `RecipeNutrition` records which version its figures
 * were computed from. Those two can disagree — that is the entire reason both fields exist — and the
 * screen says so when they do rather than showing figures that quietly belong to an older recipe.
 * Doc 17, NUT-04 and RISK-07: neither reference product publishes any provenance at all.
 *
 * ## What the portion control does, and what it deliberately does not
 *
 * Changing the number of servings rescales the **ingredient quantities** and restates the total
 * energy — that is what "I am cooking for four" means. It does not touch the facts panel, because a
 * serving contains what a serving contains however many of them you make. Conflating the two is
 * exactly the confusion doc 10, REQ-08 records in the reference product, where a pre-generation size
 * setting and a portion adjustment are the same control.
 */
export interface RecipeDetailScreenProps {
    readonly recipeId: string | undefined;
}

interface IngredientRow {
    readonly key: string;
    readonly name: string;
    readonly quantity: string;
    readonly optional: boolean;
}

export function RecipeDetailScreen({ recipeId }: RecipeDetailScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const toast = useToast();
    const { me } = useSession();
    const signedIn = me !== null;

    const parsed = recipeId === undefined ? null : RecipeId.safeParse(recipeId);
    const recipe = useRecipeQuery(parsed);

    const currentPlan = useCurrentPlanQuery(signedIn);
    const addToPlan = useAddEntryMutation();

    const [servings, setServings] = useState<number | null>(null);
    const [mealType, setMealType] = useState<MealType>('dinner');

    const item = recipe.data;
    const baseServings = item?.servings ?? 1;
    const chosenServings = servings ?? baseServings;
    const factor = baseServings === 0 ? 1 : chosenServings / baseServings;

    const ingredientRows: readonly IngredientRow[] =
        item === undefined
            ? []
            : item.ingredients.map((line: IngredientQuantity) => ({
                  key: String(line.ingredientId),
                  name: line.name,
                  quantity: t('planner:recipe.ingredientQuantity', {
                      quantity: formatter.formatNumber(line.quantity * factor, {
                          maximumFractionDigits: 1,
                      }),
                      unit: line.unit,
                  }),
                  optional: line.optional,
              }));

    const columns: readonly TableColumn<IngredientRow>[] = [
        {
            key: 'ingredient',
            header: t('planner:recipe.ingredientColumn'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Stack space="none">
                    <Text variant="bodyStrong">{row.name}</Text>
                    {row.optional ? (
                        <Text variant="caption" tone="secondary">
                            {t('planner:recipe.optionalIngredient')}
                        </Text>
                    ) : null}
                </Stack>
            ),
        },
        {
            key: 'quantity',
            header: t('planner:recipe.quantityColumn'),
            numeric: true,
            render: (row) => (
                <Text testID={`recipe-ingredient-${row.key}-quantity`}>{row.quantity}</Text>
            ),
        },
    ];

    const staleNutrition = item !== undefined && item.nutrition.recipeVersion !== item.version;

    const browseAction = (
        <Button
            testID="recipe-detail-planner"
            variant="quiet"
            label={t('planner:recipe.backToPlanner')}
            onPress={() => {
                router.push('/customer/planner' as never);
            }}
        />
    );

    return (
        <Stack space="lg" testID="recipe-detail-screen">
            {parsed === null ? (
                <EmptyState
                    testID="recipe-detail-not-found"
                    title={t('planner:recipe.notFoundTitle')}
                    body={t('planner:recipe.notFoundBody')}
                    actions={browseAction}
                />
            ) : (
                <QueryStates
                    query={recipe}
                    isEmpty={item === undefined}
                    emptyTitle={t('planner:recipe.notFoundTitle')}
                    emptyBody={t('planner:recipe.notFoundBody')}
                    emptyActions={browseAction}
                    skeletonCount={2}
                    testID="recipe-detail"
                >
                    {item === undefined ? null : (
                        <Stack space="lg">
                            <EntityImage
                                testID="recipe-detail-image"
                                assetId={item.imagePlaceholderId}
                                variant="detail"
                                seed={item.slug}
                                label={t('planner:recipe.imageLabel', { recipe: item.name })}
                                aspect="wide"
                            />

                            <Stack space="xs">
                                <Heading level={1} testID="recipe-detail-name">
                                    {item.name}
                                </Heading>
                                <Text tone="secondary">{item.description}</Text>
                                <Badge
                                    testID="recipe-detail-home-prepared"
                                    tone="neutral"
                                    icon="branch"
                                    label={t('planner:badges.home_prepared')}
                                />
                            </Stack>

                            <Inline space="xs" wrap testID="recipe-detail-meta">
                                <Chip
                                    testID="recipe-detail-total-time"
                                    tone="neutral"
                                    label={t('planner:recipe.totalMinutes', {
                                        minutes: formatter.formatNumber(
                                            item.preparationMinutes + item.cookingMinutes,
                                        ),
                                    })}
                                />
                                <Chip
                                    testID="recipe-detail-complexity"
                                    tone="neutral"
                                    label={t('planner:recipe.complexity', {
                                        complexity: formatter.formatNumber(item.complexity),
                                    })}
                                />
                                {item.estimatedCost === null ? null : (
                                    <Chip
                                        testID="recipe-detail-cost"
                                        tone="neutral"
                                        label={t('planner:recipe.estimatedCost', {
                                            cost: formatMoney(formatter, item.estimatedCost),
                                        })}
                                    />
                                )}
                            </Inline>

                            <Card testID="recipe-detail-serving" padding="md" tone="sunken">
                                <Stack space="sm">
                                    <Text variant="label">{t('planner:recipe.servingTitle')}</Text>
                                    <Text testID="recipe-detail-serving-label">
                                        {t('planner:recipe.servingLabel', {
                                            serving: item.serving.label,
                                            servings: formatter.formatNumber(item.servings),
                                        })}
                                    </Text>
                                    {item.serving.grams === null ? null : (
                                        <Text variant="caption" tone="secondary">
                                            {t('planner:recipe.servingGrams', {
                                                grams: formatter.formatNumber(item.serving.grams),
                                            })}
                                        </Text>
                                    )}

                                    <NumberStepper
                                        testID="recipe-detail-portion"
                                        id="recipe-detail-portion"
                                        label={t('planner:recipe.portionLabel')}
                                        hint={t('planner:recipe.portionHint')}
                                        value={chosenServings}
                                        min={1}
                                        max={20}
                                        step={1}
                                        onChange={setServings}
                                    />
                                    <Text testID="recipe-detail-portion-energy" tone="secondary">
                                        {t('planner:recipe.portionEnergy', {
                                            energy: formatter.formatNumber(
                                                Math.round(
                                                    amountValue(
                                                        item.nutrition.perServing,
                                                        'energy',
                                                    ),
                                                ),
                                            ),
                                            total: formatter.formatNumber(
                                                Math.round(
                                                    amountValue(
                                                        item.nutrition.perServing,
                                                        'energy',
                                                    ) * chosenServings,
                                                ),
                                            ),
                                        })}
                                    </Text>
                                </Stack>
                            </Card>

                            {/* Per *serving*, always — the portion control above changes how many
                                servings you plan to make, not what one serving contains. */}
                            <NutritionFactsPanel
                                testID="recipe-detail-facts"
                                facts={item.nutrition.perServing}
                                title={t('planner:recipe.factsTitle')}
                            />

                            <Card testID="recipe-detail-provenance" padding="md" tone="sunken">
                                <Stack space="xs">
                                    <Text variant="label">
                                        {t('planner:recipe.provenanceTitle')}
                                    </Text>
                                    <Text
                                        testID="recipe-detail-version"
                                        variant="caption"
                                        tone="secondary"
                                    >
                                        {t('planner:recipe.recipeVersion', {
                                            version: item.version,
                                        })}
                                    </Text>
                                    <Text
                                        testID="recipe-detail-nutrition-version"
                                        variant="caption"
                                        tone="secondary"
                                    >
                                        {t('planner:recipe.nutritionVersion', {
                                            version: item.nutrition.recipeVersion,
                                        })}
                                    </Text>
                                    <Text
                                        testID="recipe-detail-calculated-at"
                                        variant="caption"
                                        tone="secondary"
                                    >
                                        {t('planner:recipe.calculatedAt', {
                                            timestamp: formatter.formatDate(
                                                item.nutrition.perServing.calculation.calculatedAt,
                                                { dateStyle: 'medium', timeStyle: 'short' },
                                            ),
                                        })}
                                    </Text>
                                    <Text
                                        testID="recipe-detail-attribution"
                                        variant="caption"
                                        tone="secondary"
                                    >
                                        {t('planner:recipe.attribution', {
                                            source: item.nutrition.perServing.source.label,
                                        })}
                                    </Text>
                                    {staleNutrition ? (
                                        <Callout
                                            testID="recipe-detail-stale-nutrition"
                                            role="status"
                                            tone="warning"
                                            icon="warning"
                                            title={t('planner:recipe.staleTitle')}
                                            body={t('planner:recipe.staleBody')}
                                        />
                                    ) : null}
                                </Stack>
                            </Card>

                            <Stack space="sm" testID="recipe-detail-ingredients">
                                <Text variant="label">{t('planner:recipe.ingredientsTitle')}</Text>
                                <Table
                                    testID="recipe-detail-ingredients-table"
                                    caption={t('planner:recipe.ingredientsCaption', {
                                        servings: formatter.formatNumber(chosenServings),
                                    })}
                                    columns={columns}
                                    rows={ingredientRows}
                                    rowKey={(row) => row.key}
                                />
                            </Stack>

                            <Stack space="sm" testID="recipe-detail-steps">
                                <Text variant="label">{t('planner:recipe.stepsTitle')}</Text>
                                {item.steps.map((step) => (
                                    <Stack
                                        key={step.index}
                                        space="none"
                                        testID={`recipe-detail-step-${String(step.index)}`}
                                    >
                                        <Text variant="bodyStrong">
                                            {t('planner:recipe.stepNumber', {
                                                index: formatter.formatNumber(step.index),
                                            })}
                                        </Text>
                                        <Text>{step.instruction}</Text>
                                        {step.minutes === null ? null : (
                                            <Text variant="caption" tone="secondary">
                                                {t('planner:recipe.stepMinutes', {
                                                    minutes: formatter.formatNumber(step.minutes),
                                                })}
                                            </Text>
                                        )}
                                    </Stack>
                                ))}
                            </Stack>

                            <Stack space="xs" testID="recipe-detail-allergens">
                                <Text variant="label">{t('planner:recipe.allergensTitle')}</Text>
                                <AllergenList
                                    testID="recipe-detail-allergen-list"
                                    allergens={item.allergens}
                                />
                            </Stack>

                            <Stack space="xs" testID="recipe-detail-diets">
                                <Text variant="label">{t('planner:recipe.dietTagsTitle')}</Text>
                                <Inline space="xs" wrap>
                                    {item.dietClassifications.map((diet) => (
                                        <Chip
                                            key={diet}
                                            testID={`recipe-detail-diet-${diet}`}
                                            tone="brand"
                                            label={t(`marketplace:diets.${diet}`)}
                                        />
                                    ))}
                                </Inline>
                            </Stack>

                            <Card testID="recipe-detail-add" padding="md" tone="sunken">
                                <Stack space="sm">
                                    <Text variant="label">{t('planner:recipe.addTitle')}</Text>

                                    {currentPlan.data == null ? (
                                        <Text testID="recipe-detail-no-plan" tone="secondary">
                                            {t('planner:recipe.noPlan')}
                                        </Text>
                                    ) : (
                                        <>
                                            <Select
                                                testID="recipe-detail-add-meal-type"
                                                id="recipe-detail-add-meal-type"
                                                label={t('planner:add.mealTypeLabel')}
                                                value={mealType}
                                                onChange={setMealType}
                                                options={PLANNER_MEAL_TYPES.map((value) => ({
                                                    value,
                                                    label: t(`marketplace:mealTypes.${value}`),
                                                }))}
                                            />
                                            <Text
                                                testID="recipe-detail-add-day"
                                                variant="caption"
                                                tone="secondary"
                                            >
                                                {t('planner:recipe.addDay', {
                                                    day: formatter.formatDate(
                                                        dateInstant(currentPlan.data.weekStart),
                                                        {
                                                            weekday: 'long',
                                                            day: 'numeric',
                                                            month: 'long',
                                                        },
                                                    ),
                                                })}
                                            </Text>
                                            <Button
                                                testID="recipe-detail-add-to-plan"
                                                label={
                                                    addToPlan.isPending
                                                        ? t('planner:recipe.adding')
                                                        : t('planner:recipe.addToPlan')
                                                }
                                                disabled={addToPlan.isPending}
                                                onPress={() => {
                                                    const plan = currentPlan.data;
                                                    if (plan == null) return;
                                                    addToPlan.mutate(
                                                        {
                                                            planId: plan.planId,
                                                            request: {
                                                                date: plan.weekStart,
                                                                mealType,
                                                                kind: 'recipe',
                                                                recipeId: item.id,
                                                            },
                                                        },
                                                        {
                                                            onSuccess: () => {
                                                                toast.show({
                                                                    testID: 'recipe-added-to-plan',
                                                                    tone: 'success',
                                                                    message: t(
                                                                        'planner:recipe.addedToPlan',
                                                                        { recipe: item.name },
                                                                    ),
                                                                });
                                                            },
                                                        },
                                                    );
                                                }}
                                            />
                                        </>
                                    )}

                                    {addToPlan.isError ? (
                                        <Callout
                                            testID="recipe-detail-add-error"
                                            role="alert"
                                            tone="danger"
                                            icon="error"
                                            title={t('planner:recipe.addErrorTitle')}
                                            body={t('planner:recipe.addErrorBody')}
                                        />
                                    ) : null}
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
