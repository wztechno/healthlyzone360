<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Requests;

use Healthy360\Recipes\Enums\RecipeConfidentiality;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for creating a recipe.
 *
 * Derived values are never client-supplied: `status`, `lock_version`,
 * `organisation_id`, the source-provenance fields and the version this call
 * also creates are all server-authored and absent from these rules.
 *
 * `recipe_category` is a free string with a length bound and no enumeration —
 * matching the column, and for the reason the migration states: the source
 * vocabulary describes how one kitchen files its sheets, not a regulated
 * identity, and an enum would turn "we started making dips" into a migration.
 */
class StoreRecipeRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware; a form request
     * that also guessed would give two answers to one question.
     */
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
            'name_en' => ['required', 'string', 'max:255'],
            'name_ar' => ['nullable', 'string', 'max:255'],
            'slug' => ['nullable', 'string', 'max:110', 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/'],
            'branch_id' => ['nullable', 'uuid', Rule::exists('organisation_branches', 'id')],
            'recipe_category' => ['nullable', 'string', 'max:40'],
            'source_kind' => ['nullable', 'string', 'max:40'],
            'confidentiality' => ['nullable', new Enum(RecipeConfidentiality::class)],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
