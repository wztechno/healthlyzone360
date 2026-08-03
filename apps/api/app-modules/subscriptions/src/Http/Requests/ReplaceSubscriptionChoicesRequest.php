<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for choosing ahead on a Free Selection day (§7).
 *
 * **`meals` is `present` rather than `required`**, and that is the whole shape
 * of the endpoint. `{"date": "…", "meals": []}` is a customer saying "I have
 * not chosen; send me the kitchen's default", which is a real and expected
 * state — `required` would reject the one payload that expresses it, and a
 * client would have to fake it by choosing something.
 *
 * `slot` is a free string with a length limit rather than an enumerated
 * vocabulary. The column is `string(20)` with the comment
 * `breakfast | lunch | dinner | snack` and no CHECK behind it, and pinning the
 * list here would be this endpoint inventing a constraint the schema declined
 * to make — a kitchen that sells "pre-workout" would be refused by an API layer
 * rather than by a rule anybody agreed.
 *
 * `sequence` is optional and defaults to the position in the array.
 * `subscription_meal_choices` carries it for the kitchen that sells "lunch,
 * twice", which a slot alone would collapse; a client that does not care about
 * ordering should not have to count.
 *
 * Whether a named dish is one this kitchen sells is `MealChoiceService`'s
 * question — it has to be asked against the *subscription's seller*, which a
 * validation rule cannot see, and answering it as `meal_unknown` rather than as
 * a field error keeps a stranger's identifier from being confirmed as real.
 */
class ReplaceSubscriptionChoicesRequest extends FormRequest
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
            'date' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],

            'meals' => ['present', 'array', 'max:12'],
            'meals.*.slot' => ['required', 'string', 'max:20'],
            'meals.*.sequence' => ['nullable', 'integer', 'min:1', 'max:20'],
            'meals.*.catalogue_item_id' => ['required', 'uuid'],
            'meals.*.catalogue_item_variant_id' => ['nullable', 'uuid'],
        ];
    }

    /**
     * @return list<array{slot: string, sequence?: int|null, catalogue_item_id: string, catalogue_item_variant_id?: string|null}>
     */
    public function meals(): array
    {
        /** @var list<array{slot: string, sequence?: int|null, catalogue_item_id: string, catalogue_item_variant_id?: string|null}> $meals */
        $meals = $this->validated('meals') ?? [];

        return $meals;
    }
}
