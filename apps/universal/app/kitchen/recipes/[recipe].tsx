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
 *
 * `?returnTo=`, `?fix=` and `?ingredient=` are what Stock gaps sends when a gap is fixed in the
 * recipe: the exact view to come back to, the gap's reason and the line it is about. Handed down
 * as they are read; the screen validates each.
 *
 * `?tab=` opens a tab other than the first — what a detour to an ingredient's form comes back
 * with, so the reader lands on the table they left. `?swapFrom=&swapTo=` come back with it when that
 * form made a kitchen copy of a library ingredient: the recipe's lines move to the copy.
 */
const RecipeBookEditScreen = lazyScreen(
    'kitchen-recipe-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).RecipeBookEditScreen,
);

export default function KitchenRecipeEditor() {
    const { recipe, kind, returnTo, fix, ingredient, tab, swapFrom, swapTo } =
        useLocalSearchParams<{
            recipe?: string;
            kind?: string;
            returnTo?: string;
            fix?: string;
            ingredient?: string;
            tab?: string;
            swapFrom?: string;
            swapTo?: string;
        }>();
    return (
        <RecipeBookEditScreen
            recipe={recipe}
            kind={kind}
            returnTo={returnTo}
            fix={fix}
            ingredient={ingredient}
            tab={tab}
            swapFrom={swapFrom}
            swapTo={swapTo}
        />
    );
}
