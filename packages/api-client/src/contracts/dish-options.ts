import type { CurrencyCode } from '@healthy360/domain-types';

/**
 * What a customer can change about a dish.
 *
 * An option is free: something left out, or a sauce or side picked from a group. The only priced
 * choice is the portion, which is a pack, so its price is the pack's price-list row. Removing an
 * ingredient never changes a line's allergens: the kitchen may still cross-contact.
 */
export interface DishOption {
    readonly id: string;
    readonly kind: 'remove' | 'choice';
    readonly groupEn: string | null;
    readonly groupAr: string | null;
    readonly nameEn: string;
    readonly nameAr: string;
}

export interface DishPortion {
    readonly catalogueItemVariantId: string;
    readonly nameEn: string;
    readonly nameAr: string;
    readonly unitPriceMinor: number;
    readonly currencyCode: CurrencyCode;
}

export interface DishChoices {
    readonly options: readonly DishOption[];
    readonly portions: readonly DishPortion[];
}

/**
 * A dish option as the kitchen edits it. A choice links the sauce or side recipe it is and takes its
 * allergens from that recipe's published version; `allergenCodes` is null when there is no link or
 * the recipe has no published version. A choice with no recipe is not offered to anybody.
 */
export interface KitchenDishOption extends DishOption {
    readonly recipeId: string | null;
    readonly allergenCodes: readonly string[] | null;
}

/** A row of the kitchen's editor: no `id` yet on a row just added. */
export type DishOptionDraft = Omit<KitchenDishOption, 'id'> & { readonly id: string | null };

/** What an add to the basket chose. */
export interface DishLineChoices {
    readonly catalogueItemVariantId?: string | null | undefined;
    readonly optionIds?: readonly string[] | undefined;
    readonly note?: string | undefined;
}
