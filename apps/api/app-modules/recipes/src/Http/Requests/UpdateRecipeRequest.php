<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Requests;

use Healthy360\Recipes\Enums\RecipeConfidentiality;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for editing a recipe identity.
 *
 * `slug` and `status` are absent: the slug is the handle an import converges
 * on, and status changes are lifecycle actions with their own routes, their
 * own permissions and their own audit events (master plan v2 §4.15).
 */
class UpdateRecipeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name_en' => ['sometimes', 'string', 'max:255'],
            'name_ar' => ['sometimes', 'string', 'max:255'],
            'branch_id' => ['sometimes', 'nullable', 'uuid', Rule::exists('organisation_branches', 'id')],
            'recipe_category' => ['sometimes', 'nullable', 'string', 'max:40'],
            'source_kind' => ['sometimes', 'nullable', 'string', 'max:40'],
            'confidentiality' => ['sometimes', new Enum(RecipeConfidentiality::class)],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }
}
