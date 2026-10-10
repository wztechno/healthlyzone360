import { IngredientEditScreen, PACKAGING_FAMILY } from './ingredient-edit-screen.tsx';

/**
 * `/kitchen/packaging/{item}` — the packaging record editor.
 *
 * ## Why this is nine lines and not a form
 *
 * A packaging record *is* an ingredient. Same table, same contract, same `IngredientAdmin`, same
 * lifecycle, same lock version, same archive. What the packaging list draws — the pack it is bought
 * in, how many items that pack holds, what the pack costs, what one item holds, how much is thrown
 * away — are fields on that record, and the ingredient editor already writes every one of them.
 *
 * Three things genuinely differ, and all three are the `PACKAGING_FAMILY` this hands over: the
 * series the server numbers the record in (`PKG-` rather than `ING-`), the list Back and a
 * successful save return to, and the category a new record opens already filed under. The last is
 * the one that would bite: the packaging list asks the server for one branch by name, so a record
 * saved with an empty category is written successfully and then absent from the page that created
 * it — which a reader can only read as a save that failed.
 *
 * The alternative was a second 1,100-line form. It would have been identical on the day it was
 * written and wrong within a month, because every fix to validation, to the unsaved guard, to the
 * concurrency capture, to the reference preview, would have had to be made twice and would not
 * have been. Every kind in the recipe book renders the one `RecipeEditScreen` for exactly this
 * reason.
 *
 * ## What a reader sees
 *
 * `Catalogue Forms.dc.html`'s `isPackaging`: the page header with Cancel and Save, then three
 * sections on one page. Description — **Reference first, then Item**, then Category (fixed to the
 * packaging branch) and Sub-category. Pack — the purchase unit, the issue unit, the items per pack
 * and what one item holds. Cost — the pack price, the waste rate (flagged above 10%) and the cost of
 * one item worked out from the two. No photo, no Sale, no Nutrition, no Allergens: none of them is
 * a packaging question.
 *
 * Pack price, waste and holds open on the record's stored figures and are **not saved** — the
 * write contract carries none of the three yet. `UnstoredDraft` on the ingredient editor says why
 * they are drawn anyway, and why they cannot block a save.
 */
export function PackagingEditScreen({ item }: { readonly item: string | undefined }) {
    return <IngredientEditScreen ingredient={item} family={PACKAGING_FAMILY} />;
}
