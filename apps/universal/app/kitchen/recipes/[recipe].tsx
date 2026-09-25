import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/recipes/{recipe}` — the recipe book's editor, for every kind the book holds: a meal, a
 * sauce, a dressing, a frozen meal or a preparation, with whatever sells it on a Selling tab.
 *
 * `new` is a value of the same parameter rather than a sibling route file, exactly as the ingredient
 * editor does it: creating and editing share the form, the validation and the unsaved guard, and two
 * route files would be two places to keep that in step. The identifier is validated in the screen,
 * so a hand-typed link produces the designed not-found state rather than a repository failure.
 *
 * `?kind=` is what `new` creates — the book's New menu and its kind tabs send it — and it is read
 * here and handed down as a prop, like every other query parameter in this workspace. A saved recipe
 * answers the question itself, so the screen ignores it there.
 */
const RecipeBookEditScreen = lazyScreen(
    'kitchen-recipe-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).RecipeBookEditScreen,
);

export default function KitchenRecipeEditor() {
    const { recipe, kind } = useLocalSearchParams<{ recipe?: string; kind?: string }>();
    return <RecipeBookEditScreen recipe={recipe} kind={kind} />;
}
