import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/recipes/{recipe}` — the recipe and version editor.
 *
 * `new` is a value of the same parameter rather than a sibling route file, exactly as the ingredient
 * editor does it: creating and editing share the form, the validation and the unsaved guard, and two
 * route files would be two places to keep that in step. The identifier is validated in the screen,
 * so a hand-typed link produces the designed not-found state rather than a repository failure.
 */
const RecipeEditScreen = lazyScreen(
    'kitchen-recipe-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).RecipeEditScreen,
);

export default function KitchenRecipeEditor() {
    const { recipe } = useLocalSearchParams<{ recipe?: string }>();
    return <RecipeEditScreen recipe={recipe} />;
}
