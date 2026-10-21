<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for `GET /me/allergen-conflicts`.
 *
 * `meal_ids` is one comma-separated query value, the shape
 * `GET /marketplace/meals?ids=` already takes, capped at fifty — a week of
 * picks is seven, a full configurator menu is fifty.
 */
class AllergenConflictIndexRequest extends FormRequest
{
    public const MAX_MEALS = 50;

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
            'meal_ids' => ['required', 'string', 'max:'.(self::MAX_MEALS * 37)],
            'meal_ids_list' => ['array', 'max:'.self::MAX_MEALS],
            'meal_ids_list.*' => ['uuid'],
        ];
    }

    /**
     * @return list<string>
     */
    public function mealIds(): array
    {
        /** @var list<string> $ids */
        $ids = $this->validated('meal_ids_list') ?? [];

        return $ids;
    }

    protected function prepareForValidation(): void
    {
        $raw = $this->query('meal_ids');

        $this->merge([
            'meal_ids_list' => is_string($raw)
                ? array_values(array_filter(array_map(trim(...), explode(',', $raw)), static fn (string $id): bool => $id !== ''))
                : [],
        ]);
    }
}
