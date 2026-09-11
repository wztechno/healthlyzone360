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
 * have been. `SaucesScreen` and `DressingsScreen` wrap `ProductsScreen` for exactly this reason.
 *
 * ## What a reader sees
 *
 * The Catalogue's editor chrome, unchanged from New ingredient and New recipe: the page header with
 * Cancel and Save, the meta line, then Identity — **Id first, then Item**, then Category and
 * Sub-category — and Measurement & cost under it, where the pack unit, the items per pack and the
 * price live. The Id is filled in before the record exists: it is the handle the save is about to
 * take, read from the same scan the create performs.
 */
export function PackagingEditScreen({ item }: { readonly item: string | undefined }) {
    return <IngredientEditScreen ingredient={item} family={PACKAGING_FAMILY} />;
}
