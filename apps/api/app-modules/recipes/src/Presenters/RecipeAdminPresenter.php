<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Presenters;

use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Services\RecipeSummaries;

/**
 * The administrative wire shape of a recipe identity.
 *
 * Both names are always carried and `Accept-Language` is ignored for them: a
 * bilingual editor has to see what it is editing (master plan v2 §4.18).
 *
 * There is **no public recipe projection** in K1.2 and nothing here reaches an
 * anonymous caller. When one arrives (M1), it will be a separate presenter
 * with its own denylist sweep, never this one with fields removed — a public
 * shape derived by subtraction is one refactor away from leaking.
 *
 * Every figure this class prints is handed to it: {@see RecipeSummaries} reads
 * them for a whole page at once and is the only caller, so the list and the
 * single-record reads serve one shape. This class never asks who is calling,
 * either — whether the sellers are shown is decided there and arrives as a
 * null, for the reason `OrderDeskPresenter` gives about its `customer` key.
 *
 * @phpstan-type RecipeSeller array{
 *     id: string,
 *     item_type: string,
 *     status: string,
 *     lock_version: int,
 *     reference: string|null,
 *     slug: string,
 *     name_en: string,
 *     name_ar: string|null,
 *     image_placeholder_id: string,
 *     kitchen_category: string|null,
 *     kitchen_subcategory: string|null,
 *     is_market_priced: bool,
 *     is_assorted: bool,
 *     data_quality_flags: list<string>,
 *     portion_factor: string,
 *     composition: string|null,
 *     channel_codes: list<string>,
 *     pack_count: int,
 *     default_pack: array{label_en: string, label_ar: string|null, net_quantity: string, net_unit_code: string|null}|null,
 * }
 * @phpstan-type AdminRecipeRow array{
 *     id: string,
 *     organisation_id: string,
 *     branch_id: string|null,
 *     slug: string,
 *     name_en: string,
 *     name_ar: string,
 *     recipe_category: string|null,
 *     source_kind: string|null,
 *     confidentiality: string,
 *     status: string,
 *     notes: string|null,
 *     shelf_life_days: int|null,
 *     published_version_number: int|null,
 *     current_version_status: string|null,
 *     current_version_allergen_codes: list<string>,
 *     current_version_line_count: int,
 *     source_system: string|null,
 *     source_ref: string|null,
 *     lock_version: int,
 *     created_at: string|null,
 *     updated_at: string|null,
 *     kinds?: list<string>,
 *     sold_as?: list<RecipeSeller>,
 * }
 */
final class RecipeAdminPresenter
{
    /**
     * @param  int|null  $publishedVersionNumber  the live version, or null when nothing is published
     * @param  string|null  $currentVersionStatus  the *current* version's publishable state — the only field that can say `review_required`
     * @param  list<string>  $currentVersionAllergenCodes  what that version declares, so the list column needs no read of its own
     * @param  int  $currentVersionLineCount  how many ingredient lines that version holds
     * @param  list<RecipeSeller>|null  $sellers  what sells the recipe, or null when the reader may not see the catalogue
     * @return AdminRecipeRow
     */
    public function recipe(
        Recipe $recipe,
        ?int $publishedVersionNumber,
        ?string $currentVersionStatus,
        array $currentVersionAllergenCodes,
        int $currentVersionLineCount,
        ?array $sellers,
    ): array {
        $row = [
            'id' => (string) $recipe->getKey(),
            'organisation_id' => $recipe->organisation_id,
            'branch_id' => $recipe->branch_id,
            'slug' => $recipe->slug,
            'name_en' => $recipe->name_en,
            'name_ar' => $recipe->name_ar,
            'recipe_category' => $recipe->recipe_category,
            'source_kind' => $recipe->source_kind,
            'confidentiality' => $recipe->confidentiality->value,
            'status' => $recipe->status->value,
            'notes' => $recipe->notes,
            'shelf_life_days' => $recipe->shelf_life_days,

            // The answer to "what is live" without a second request, and
            // computed rather than stored: there is no `current_version_id`
            // column to fall out of step with the versions themselves.
            'published_version_number' => $publishedVersionNumber,

            /*
             * The *current* version's state, which is a different question from the one above and
             * the only one that can say `review_required`.
             *
             * A recipe row carries `active | archived`; a version carries the publishable family.
             * A client with only the two fields above could therefore never render a quarantine —
             * a recipe whose live version is under review reported `published`, the review queue
             * never listed one, and the list's own Review card was permanently zero.
             *
             * "Current" is the same precedence the allergen filter selects on and the same one the
             * client applies when it opens a record: an editable version first (draft or
             * review_required), then the published one, then the highest numbered. Null only on a
             * recipe with no versions at all, which the create path makes unreachable.
             */
            'current_version_status' => $currentVersionStatus,

            /*
             * The allergen classes that version declares, so the list's Allergens column can be
             * read off the page it was fetched with.
             *
             * This column used to cost one `getRecipe` per visible row — twenty-five extra requests
             * a page to fill two cells. The set is small, it is already indexed by version, and the
             * page needs exactly one query for all of it.
             */
            'current_version_allergen_codes' => $currentVersionAllergenCodes,

            /*
             * How many lines that same version holds. Zero is a recipe nobody has formulated — a
             * name, or a placeholder the catalogue backfill wrote for an item that had no recipe —
             * and the book marks it "Not formulated" rather than printing an empty allergen cell
             * that reads as "contains nothing".
             */
            'current_version_line_count' => $currentVersionLineCount,
            'source_system' => $recipe->source_system,
            'source_ref' => $recipe->source_ref,
            'lock_version' => $recipe->lock_version,
            'created_at' => $recipe->created_at?->toIso8601String(),
            'updated_at' => $recipe->updated_at?->toIso8601String(),
        ];

        if ($sellers !== null) {
            /*
             * What the recipe is sold as, and the items doing the selling — **absent**, not empty,
             * for a reader who may not see the catalogue. An empty `sold_as` is a fact about the
             * recipe ("nothing sells it"); a missing one is a fact about the reader, and a screen
             * can only tell the two apart if the shapes differ.
             *
             * `kinds` is every seller's type once, in the sellers' own slug order, so a recipe sold
             * as a meal and as a sauce reads both — the same set the `kind` filter matches on.
             */
            $kinds = array_values(array_unique(array_column($sellers, 'item_type')));

            $row['kinds'] = $kinds === [] ? [RecipeUsageRegistry::PREPARATION] : $kinds;
            $row['sold_as'] = $sellers;
        }

        return $row;
    }
}
