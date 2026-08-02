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
     *     source_system: string|null,
     *     source_ref: string|null,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function recipe(Recipe $recipe, ?int $publishedVersionNumber = null): array
    {
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
            'source_system' => $recipe->source_system,
            'source_ref' => $recipe->source_ref,
            'lock_version' => $recipe->lock_version,
            'created_at' => $recipe->created_at?->toIso8601String(),
            'updated_at' => $recipe->updated_at?->toIso8601String(),
        ];
    }
}
