import type { IngredientAdmin } from '@healthy360/api-client/contracts';

/**
 * The stock picture an ingredient shows when the kitchen has not uploaded its own, as the id
 * `EntityImage` resolves — or `undefined` when the kitchen took the picture off.
 *
 * The picture is found by slug, and a slug is fixed when the row is made: a new "Peach" takes
 * `peach`, and so does a copy of the platform's Peach, which keeps it however it is renamed later.
 * So a row can arrive with a picture nobody chose. Every place that draws it — the list, the View
 * page and the editor's photo slot — reads it here, so the slot shows what the list shows and its
 * clear control takes it off everywhere.
 */
export function ingredientStockPhotoId(
    ingredient: Pick<IngredientAdmin, 'slug' | 'stockPhotoHidden'>,
): string | undefined {
    return ingredient.stockPhotoHidden === true ? undefined : `ingredient-${ingredient.slug}`;
}
