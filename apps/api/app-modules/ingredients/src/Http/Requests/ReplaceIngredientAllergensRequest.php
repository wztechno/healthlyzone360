<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Requests;

use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\AllergenMappingSource;
use Healthy360\Ingredients\Enums\AllergenMarketScope;
use Healthy360\Ingredients\Enums\AllergenVerificationStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for a full replacement of one layer's allergen mappings.
 *
 * `mappings` is `present` rather than `required`: an empty array is a
 * meaningful, legitimate statement ("this ingredient carries no allergens"),
 * and `required` would reject it as if the field were missing. The two must
 * stay distinguishable — silently treating "none" as "you forgot" is how a
 * mapping set never gets cleared.
 *
 * The layer being written is never a field: the server derives it from the
 * caller's organisation.
 */
class ReplaceIngredientAllergensRequest extends FormRequest
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
            'market_scope' => ['sometimes', new Enum(AllergenMarketScope::class)],
            'mappings' => ['present', 'array', 'max:50'],
            'mappings.*.allergen_code' => ['required', 'string', 'max:20', Rule::exists('allergens', 'code')],
            'mappings.*.containment' => ['required', new Enum(AllergenContainment::class)],
            'mappings.*.source' => ['nullable', new Enum(AllergenMappingSource::class)],
            'mappings.*.verification_status' => ['nullable', new Enum(AllergenVerificationStatus::class)],
            'mappings.*.evidence' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function marketScope(): AllergenMarketScope
    {
        $scope = $this->validated('market_scope');

        return is_string($scope) ? AllergenMarketScope::from($scope) : AllergenMarketScope::All;
    }

    /**
     * @return list<array{allergen_code: string, containment: string, source?: string|null, verification_status?: string|null, evidence?: string|null}>
     */
    public function mappings(): array
    {
        /** @var list<array{allergen_code: string, containment: string, source?: string|null, verification_status?: string|null, evidence?: string|null}> $mappings */
        $mappings = $this->validated('mappings') ?? [];

        return $mappings;
    }
}
