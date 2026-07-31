import {
    Button,
    Callout,
    Card,
    Drawer,
    Inline,
    NumberStepper,
    Select,
    Stack,
    Tabs,
    Text,
    TextInputField,
    useBreakpoint,
} from '@healthy360/design-system';
import type { AddEntryRequest, PlanEntryKind } from '@healthy360/api-client/contracts';
import type { MealPlanId, MealType } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mealsFromPages, useMealsQuery } from '../../data/catalogue-hooks.ts';
import {
    useAddEntryMutation,
    useFoodSearchQuery,
    useRecipesQuery,
} from '../../data/planner-hooks.ts';
import { formatMoney, nutrientValue } from '../marketplace/format.ts';
import { QueryStates } from '../marketplace/query-states.tsx';
import { PLANNER_MEAL_TYPES, dateInstant } from './format.ts';

/**
 * Adding an entry to a day, in the four kinds the contract models.
 *
 * `PLAN_ENTRY_KINDS` is `food | recipe | kitchen_meal | restaurant` and the four are genuinely
 * different questions, not one question with a dropdown: a food is a searched ingredient and a
 * quantity in grams, a recipe is something to cook, a kitchen meal is something to order, and a
 * planned restaurant meal has no record behind it at all — only a venue name and an estimate the
 * store is explicit about having invented (`fixtures/planner.ts`, `RESTAURANT_ESTIMATE`).
 *
 * Each tab is therefore its own small form rather than a shared one with fields hidden by kind,
 * which is how a form ends up submitting a `foodId` for a restaurant meal.
 *
 * All four are **real** `addEntry` mutations. Nothing here is a prototype notice.
 *
 * ## Keyboard first
 *
 * Search is a text field, results are buttons, the meal type is a `Select` (a button opening a modal
 * radio group, not a combobox), and the grams control is a `NumberStepper` with a typed input. There
 * is no pointer-only path into any of it, which is what the specification's keyboard-operability
 * requirement means for a planner mutation.
 */
export interface AddEntryDrawerProps {
    readonly planId: MealPlanId;
    readonly date: string;
    readonly open: boolean;
    readonly onClose: () => void;
    readonly onAnnounce: (message: string) => void;
    /** Pre-selects the slot the person pressed "add" in. */
    readonly initialMealType?: MealType | undefined;
    readonly testID?: string | undefined;
}

export function AddEntryDrawer({
    planId,
    date,
    open,
    onClose,
    onAnnounce,
    initialMealType = 'breakfast',
    testID = 'planner-add',
}: AddEntryDrawerProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();

    const [kind, setKind] = useState<PlanEntryKind>('food');
    const [mealType, setMealType] = useState<MealType>(initialMealType);
    const [query, setQuery] = useState('');
    const [grams, setGrams] = useState<number | null>(100);
    const [venue, setVenue] = useState('');
    const [dish, setDish] = useState('');

    /**
     * Opening the drawer starts a new question.
     *
     * The drawer stays mounted while it is closed, so without this it re-opens on whatever was last
     * asked: the kitchen-meal tab from the previous entry, a stale search, and — worse than either
     * — the meal slot of the *last* add rather than the slot whose "add" button was just pressed,
     * silently filing lunch under breakfast. Adjusting state during render when the prop changes is
     * React's documented alternative to an effect that would render the wrong form first.
     */
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setKind('food');
            setMealType(initialMealType);
            setQuery('');
            setGrams(100);
            setVenue('');
            setDish('');
        }
    }

    const add = useAddEntryMutation();

    const foods = useFoodSearchQuery(
        open && kind === 'food' && query.trim() !== '' ? { query: query.trim(), limit: 8 } : null,
    );
    const recipes = useRecipesQuery(
        { limit: 8, ...(query.trim() === '' ? {} : { query: query.trim() }) },
        open && kind === 'recipe',
    );
    const meals = useMealsQuery(
        { limit: 8, ...(query.trim() === '' ? {} : { query: query.trim() }) },
        open && kind === 'kitchen_meal',
    );

    const dayLabel = formatter.formatDate(dateInstant(date), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    });

    const submit = (request: AddEntryRequest, label: string) => {
        add.mutate(
            { planId, request },
            {
                onSuccess: () => {
                    onAnnounce(
                        t('planner:announce.added', {
                            meal: label,
                            slot: t('planner:card.slot', {
                                mealType: t(`marketplace:mealTypes.${request.mealType}`),
                                day: formatter.formatDate(dateInstant(request.date), {
                                    weekday: 'long',
                                }),
                            }),
                        }),
                    );
                    setQuery('');
                    setVenue('');
                    setDish('');
                    onClose();
                },
            },
        );
    };

    return (
        <Drawer
            testID={testID}
            open={open}
            onClose={onClose}
            placement={atLeast('lg') ? 'end' : 'bottom'}
            title={t('planner:add.title', { day: dayLabel })}
            className={atLeast('lg') ? 'w-[480px] max-w-[95vw]' : undefined}
        >
            <Stack space="md" testID={`${testID}-body`}>
                <Select
                    testID={`${testID}-meal-type`}
                    id={`${testID}-meal-type`}
                    label={t('planner:add.mealTypeLabel')}
                    value={mealType}
                    onChange={setMealType}
                    options={PLANNER_MEAL_TYPES.map((value) => ({
                        value,
                        label: t(`marketplace:mealTypes.${value}`),
                    }))}
                />

                <Tabs
                    testID={`${testID}-kind`}
                    label={t('planner:add.kindLabel')}
                    variant="underline"
                    value={kind}
                    onChange={setKind}
                    items={[
                        {
                            value: 'food',
                            label: t('planner:add.kindFood'),
                            testID: `${testID}-kind-food`,
                        },
                        {
                            value: 'recipe',
                            label: t('planner:add.kindRecipe'),
                            testID: `${testID}-kind-recipe`,
                        },
                        {
                            value: 'kitchen_meal',
                            label: t('planner:add.kindKitchenMeal'),
                            testID: `${testID}-kind-kitchen-meal`,
                        },
                        {
                            value: 'restaurant',
                            label: t('planner:add.kindRestaurant'),
                            testID: `${testID}-kind-restaurant`,
                        },
                    ]}
                />

                {add.isError ? (
                    <Callout
                        testID={`${testID}-error`}
                        role="alert"
                        tone="danger"
                        icon="error"
                        title={t('planner:add.errorTitle')}
                        body={t('planner:add.errorBody')}
                    />
                ) : null}

                {kind === 'restaurant' ? (
                    <Stack space="sm" testID={`${testID}-restaurant-form`}>
                        <Text variant="caption" tone="secondary">
                            {t('planner:add.restaurantHint')}
                        </Text>
                        <TextInputField
                            testID={`${testID}-restaurant-venue`}
                            id={`${testID}-restaurant-venue`}
                            label={t('planner:add.restaurantVenueLabel')}
                            placeholder={t('planner:add.restaurantVenuePlaceholder')}
                            value={venue}
                            onChangeText={setVenue}
                        />
                        <TextInputField
                            testID={`${testID}-restaurant-dish`}
                            id={`${testID}-restaurant-dish`}
                            label={t('planner:add.restaurantDishLabel')}
                            hint={t('planner:add.restaurantDishHint')}
                            value={dish}
                            onChangeText={setDish}
                        />
                        <Button
                            testID={`${testID}-restaurant-submit`}
                            label={t('planner:add.restaurantSubmit')}
                            disabled={venue.trim() === '' || add.isPending}
                            onPress={() => {
                                const label = dish.trim() === '' ? venue.trim() : dish.trim();
                                submit(
                                    {
                                        date,
                                        mealType,
                                        kind: 'restaurant',
                                        restaurantName: venue.trim(),
                                        label,
                                    },
                                    label,
                                );
                            }}
                        />
                    </Stack>
                ) : (
                    <Stack space="sm">
                        <TextInputField
                            testID={`${testID}-search`}
                            id={`${testID}-search`}
                            label={t(`planner:add.search.${kind}`)}
                            placeholder={t('planner:add.searchPlaceholder')}
                            value={query}
                            onChangeText={setQuery}
                        />

                        {kind === 'food' ? (
                            <NumberStepper
                                testID={`${testID}-grams`}
                                id={`${testID}-grams`}
                                label={t('planner:add.gramsLabel')}
                                hint={t('planner:add.gramsHint')}
                                value={grams}
                                min={5}
                                max={2000}
                                step={5}
                                unit={t('planner:common.unitGrams')}
                                onChange={setGrams}
                            />
                        ) : null}

                        {kind === 'food' && query.trim() === '' ? (
                            <Text testID={`${testID}-food-prompt`} tone="secondary">
                                {t('planner:add.foodPrompt')}
                            </Text>
                        ) : null}

                        {kind === 'food' && query.trim() !== '' ? (
                            <QueryStates
                                query={foods}
                                isEmpty={(foods.data?.items.length ?? 0) === 0}
                                emptyTitle={t('planner:add.noFoodsTitle')}
                                emptyBody={t('planner:add.noFoodsBody')}
                                skeletonCount={2}
                                testID={`${testID}-foods`}
                            >
                                <Stack space="xs">
                                    {(foods.data?.items ?? []).map((food) => (
                                        <Card
                                            key={food.id}
                                            testID={`${testID}-food-${food.id}`}
                                            padding="sm"
                                            tone="raised"
                                        >
                                            <Stack space="xs">
                                                <Text variant="bodyStrong">{food.name}</Text>
                                                <Text variant="caption" tone="secondary">
                                                    {t('planner:add.per100g', {
                                                        energy: formatter.formatNumber(
                                                            nutrientValue(food.per100g, 'energy'),
                                                        ),
                                                        protein: formatter.formatNumber(
                                                            nutrientValue(food.per100g, 'protein'),
                                                        ),
                                                    })}
                                                </Text>
                                                <Button
                                                    testID={`${testID}-food-${food.id}-add`}
                                                    size="sm"
                                                    label={t('planner:add.addAction')}
                                                    disabled={add.isPending || grams === null}
                                                    onPress={() => {
                                                        submit(
                                                            {
                                                                date,
                                                                mealType,
                                                                kind: 'food',
                                                                foodId: food.id,
                                                                grams: grams ?? 100,
                                                            },
                                                            food.name,
                                                        );
                                                    }}
                                                />
                                            </Stack>
                                        </Card>
                                    ))}
                                </Stack>
                            </QueryStates>
                        ) : null}

                        {kind === 'recipe' ? (
                            <QueryStates
                                query={recipes}
                                isEmpty={(recipes.data?.items.length ?? 0) === 0}
                                emptyTitle={t('planner:add.noRecipesTitle')}
                                emptyBody={t('planner:add.noRecipesBody')}
                                skeletonCount={2}
                                testID={`${testID}-recipes`}
                            >
                                <Stack space="xs">
                                    {(recipes.data?.items ?? []).map((recipe) => (
                                        <Card
                                            key={String(recipe.id)}
                                            testID={`${testID}-recipe-${String(recipe.id)}`}
                                            padding="sm"
                                            tone="raised"
                                        >
                                            <Stack space="xs">
                                                <Text variant="bodyStrong">{recipe.name}</Text>
                                                <Text variant="caption" tone="secondary">
                                                    {t('planner:add.perServing', {
                                                        energy: formatter.formatNumber(
                                                            nutrientValue(
                                                                recipe.nutrition.perServing,
                                                                'energy',
                                                            ),
                                                        ),
                                                        minutes: formatter.formatNumber(
                                                            recipe.preparationMinutes +
                                                                recipe.cookingMinutes,
                                                        ),
                                                    })}
                                                </Text>
                                                <Button
                                                    testID={`${testID}-recipe-${String(recipe.id)}-add`}
                                                    size="sm"
                                                    label={t('planner:add.addAction')}
                                                    disabled={add.isPending}
                                                    onPress={() => {
                                                        submit(
                                                            {
                                                                date,
                                                                mealType,
                                                                kind: 'recipe',
                                                                recipeId: recipe.id,
                                                            },
                                                            recipe.name,
                                                        );
                                                    }}
                                                />
                                            </Stack>
                                        </Card>
                                    ))}
                                </Stack>
                            </QueryStates>
                        ) : null}

                        {kind === 'kitchen_meal' ? (
                            <QueryStates
                                query={meals}
                                isEmpty={mealsFromPages(meals.data?.pages).length === 0}
                                emptyTitle={t('planner:add.noMealsTitle')}
                                emptyBody={t('planner:add.noMealsBody')}
                                skeletonCount={2}
                                testID={`${testID}-meals`}
                            >
                                <Stack space="xs">
                                    {mealsFromPages(meals.data?.pages).map((meal) => (
                                        <Card
                                            key={String(meal.id)}
                                            testID={`${testID}-meal-${String(meal.id)}`}
                                            padding="sm"
                                            tone="raised"
                                        >
                                            <Stack space="xs">
                                                <Text variant="bodyStrong">{meal.name}</Text>
                                                <Inline space="xs" wrap>
                                                    <Text variant="caption" tone="secondary">
                                                        {meal.kitchenName}
                                                    </Text>
                                                    <Text variant="caption" tone="secondary">
                                                        {formatMoney(formatter, meal.price)}
                                                    </Text>
                                                </Inline>
                                                <Button
                                                    testID={`${testID}-meal-${String(meal.id)}-add`}
                                                    size="sm"
                                                    label={t('planner:add.addAction')}
                                                    disabled={add.isPending}
                                                    onPress={() => {
                                                        submit(
                                                            {
                                                                date,
                                                                mealType,
                                                                kind: 'kitchen_meal',
                                                                mealId: meal.id,
                                                            },
                                                            meal.name,
                                                        );
                                                    }}
                                                />
                                            </Stack>
                                        </Card>
                                    ))}
                                </Stack>
                            </QueryStates>
                        ) : null}
                    </Stack>
                )}
            </Stack>
        </Drawer>
    );
}
