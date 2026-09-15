import { DRESSINGS_FAMILY, ProductsScreen, SAUCES_FAMILY } from './products-screen.tsx';
import { CookedItemEditScreen } from './sauce-edit-screen.tsx';

/**
 * `/kitchen/sauces` and `/kitchen/dressings` — the two v6 cooked kinds beside
 * products. These wrappers exist so the route files can stay thin lazy imports
 * without pulling the family constants into the entry bundle.
 *
 * **The lists are the product list; the editors are not.** All three kinds
 * share the same columns, packs, channels and lifecycle, so one
 * {@link ProductsScreen} lists them. Editing them does not: a product is
 * bought in and reads as one scrolling form, while a sauce and a dressing are
 * cooked and read as a recipe — designation, formulation, cost, technical
 * sheet. So these two editors are {@link CookedItemEditScreen}, which resolves
 * the item to its own recipe and hands it to the recipe editor with the
 * Packaging tab dropped.
 */
export function SaucesScreen() {
    return <ProductsScreen family={SAUCES_FAMILY} />;
}

export function DressingsScreen() {
    return <ProductsScreen family={DRESSINGS_FAMILY} />;
}

export function SauceEditScreen({ product }: { readonly product: string | undefined }) {
    return <CookedItemEditScreen product={product} itemType="sauce" routeBase="/kitchen/sauces" />;
}

export function DressingEditScreen({ product }: { readonly product: string | undefined }) {
    return (
        <CookedItemEditScreen
            product={product}
            itemType="dressing"
            routeBase="/kitchen/dressings"
        />
    );
}
