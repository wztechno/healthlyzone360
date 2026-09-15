<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Presenters;

use Healthy360\Recipes\Models\Recipe;

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
 */
final class RecipeAdminPresenter
{
    /**
     * @param  int|null  $publishedVersionNumber  the live version, or null when nothing is published
     * @param  string|null  $currentVersionStatus  the *current* version's publishable state — the only field that can say `review_required`
     * @param  list<string>  $currentVersionAllergenCodes  what that version declares, so the list column needs no read of its own
     * @return array{
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
     *     published_version_number: int|null,
     *     current_version_status: string|null,
     *     current_version_allergen_codes: list<string>,
     *     source_system: string|null,
     *     source_ref: string|null,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function recipe(
        Recipe $recipe,
        ?int $publishedVersionNumber = null,
        ?string $currentVersionStatus = null,
        array $currentVersionAllergenCodes = [],
    ): array {
        return [
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
            'source_system' => $recipe->source_system,
            'source_ref' => $recipe->source_ref,
            'lock_version' => $recipe->lock_version,
            'created_at' => $recipe->created_at?->toIso8601String(),
            'updated_at' => $recipe->updated_at?->toIso8601String(),
        ];
    }
}
