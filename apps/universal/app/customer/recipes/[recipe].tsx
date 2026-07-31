import { useLocalSearchParams } from 'expo-router';

import { RecipeDetailScreen } from '../../../src/features/planner/screens/recipe-detail-screen.tsx';

/**
 * `/customer/recipes/{recipe}` — a home-prepared recipe.
 *
 * Distinct from `/meals/{meal}`, which is a marketplace meal: a sellable product with a price and a
 * kitchen behind it. A recipe is a composition of ingredients with a version and method steps, and
 * the specification requires the two to stay separate concepts.
 */
export default function RecipeDetailRoute() {
    const { recipe } = useLocalSearchParams<{ recipe?: string }>();
    return <RecipeDetailScreen recipeId={recipe} />;
}
