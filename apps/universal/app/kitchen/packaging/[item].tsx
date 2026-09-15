import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/packaging/{item}` — the packaging record editor.
 *
 * `new` is a value of the same parameter rather than a sibling route file, the call
 * `/kitchen/ingredients/{ingredient}` already makes: creating and editing are one form with one set
 * of validation and one unsaved guard, and two route files would be two places to keep that in
 * step. The identifier is validated in the screen, so a hand-typed link produces the designed
 * not-found state rather than a repository failure.
 */
const PackagingEditScreen = lazyScreen(
    'kitchen-ingredient-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).PackagingEditScreen,
);

export default function KitchenPackagingEditor() {
    const { item } = useLocalSearchParams<{ item?: string }>();
    return <PackagingEditScreen item={item} />;
}
