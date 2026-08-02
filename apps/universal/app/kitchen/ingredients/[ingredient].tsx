import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/ingredients/{ingredient}` — the record editor.
 *
 * `new` is a value of the same parameter rather than a sibling route file: creating and editing are
 * the same form with the same validation and the same unsaved guard, and two route files would be
 * two places to keep that in step. The identifier is validated in the screen, so a hand-typed link
 * produces the designed not-found state rather than a repository failure.
 */
const IngredientEditScreen = lazyScreen(
    'kitchen-ingredient-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).IngredientEditScreen,
);

export default function KitchenIngredientEditor() {
    const { ingredient } = useLocalSearchParams<{ ingredient?: string }>();
    return <IngredientEditScreen ingredient={ingredient} />;
}
