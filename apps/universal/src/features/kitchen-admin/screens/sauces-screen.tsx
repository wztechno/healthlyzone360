import { DRESSINGS_FAMILY, ProductsScreen, SAUCES_FAMILY } from './products-screen.tsx';
import { ProductEditScreen } from './product-edit-screen.tsx';

/**
 * `/kitchen/sauces` and `/kitchen/dressings` — the two v6 packaged kinds
 * beside products. One screen serves all three (same packs, same channels,
 * same lifecycle — see {@link ProductsScreen}); these wrappers exist so the
 * route files can stay thin lazy imports without pulling the family
 * constants into the entry bundle.
 */
export function SaucesScreen() {
    return <ProductsScreen family={SAUCES_FAMILY} />;
}

export function DressingsScreen() {
    return <ProductsScreen family={DRESSINGS_FAMILY} />;
}

export function SauceEditScreen({ product }: { readonly product: string | undefined }) {
    return <ProductEditScreen product={product} itemType="sauce" routeBase="/kitchen/sauces" />;
}

export function DressingEditScreen({ product }: { readonly product: string | undefined }) {
    return (
        <ProductEditScreen product={product} itemType="dressing" routeBase="/kitchen/dressings" />
    );
}
