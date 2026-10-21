import type { ApiFailure, IngredientBarcodeScan } from '@healthy360/api-client/contracts';
import type { IngredientId } from '@healthy360/domain-types';
import type { TFunction } from 'i18next';

/**
 * What every scanning surface shares (ingredient barcodes, plan §8): which shelf a scan lands on,
 * and what to tell a person when it lands nowhere.
 */

const REFUSAL_REASONS = [
    'unreadable',
    'check_digit',
    'variable_measure',
    'reserved',
    'not_a_product_code',
] as const;

/**
 * The shelf a scan's ingredient is counted on: the stock item backed by that ingredient, its own
 * shelf before a resold product's. More than one shelf can name an ingredient, so the rule is
 * stated once, here, for the stock screen and both receive screens.
 */
export function shelfForIngredient<
    Item extends {
        readonly ingredientId: IngredientId | null;
        readonly catalogueItemId: string | null;
    },
>(items: readonly Item[], ingredientId: IngredientId): Item | undefined {
    const backed = items.filter(
        (item) => item.ingredientId !== null && String(item.ingredientId) === String(ingredientId),
    );
    return backed.find((item) => item.catalogueItemId === null) ?? backed[0];
}

/** A readable code nobody has linked: a retired kitchen label says so, a producer's code asks to be linked. */
export function unlinkedScanMessage(t: TFunction, scan: IngredientBarcodeScan): string {
    return t(
        scan.originHint === 'system' ? 'kitchen:barcodes.retired' : 'kitchen:barcodes.unknown',
    );
}

/** A barcode write or scan that was refused, worded by its reason; any other failure by its message. */
export function barcodeFailureText(
    t: TFunction,
    failure: ApiFailure | null,
    locale: string,
): string | null {
    if (failure === null) return null;

    if (failure.code === 'barcode.invalid') {
        const reason = REFUSAL_REASONS.find((known) => known === failure.reason) ?? 'unreadable';
        return t(`kitchen:barcodes.refused.${reason}`);
    }

    if (failure.code === 'barcode.taken') {
        const name = (locale === 'ar' ? failure.nameAr : failure.nameEn) ?? failure.nameEn ?? '';
        return t('kitchen:barcodes.taken', { name });
    }

    return failure.message;
}
