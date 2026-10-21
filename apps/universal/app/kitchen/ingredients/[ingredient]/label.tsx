import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/** `/kitchen/ingredients/{ingredient}/label` — the ingredient's kitchen-code label, printed from the web. */
const IngredientBarcodeLabelScreen = lazyScreen(
    'kitchen-ingredient-label-loading',
    async () =>
        (await import('../../../../src/features/kitchen-admin/screens/index.ts'))
            .IngredientBarcodeLabelScreen,
);

export default function KitchenIngredientBarcodeLabel() {
    const { ingredient } = useLocalSearchParams<{ ingredient?: string }>();
    return <IngredientBarcodeLabelScreen ingredient={ingredient} />;
}
