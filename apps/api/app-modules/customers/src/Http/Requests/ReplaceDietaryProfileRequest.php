<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Requests;

use Healthy360\Customers\Enums\AllergenSeverity;
use Healthy360\Customers\Enums\FoodExclusionKind;
use Healthy360\ReferenceData\Models\DietClassification;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;
use Illuminate\Validation\Validator;

/**
 * Validation for a complete dietary declaration.
 *
 * **`allergens` is `present`, not `sometimes`.** A `PUT` that omitted the key
 * and a `PUT` that sent an empty array would otherwise mean the same thing on
 * the wire and different things to the person — "I did not touch this" against
 * "I have no allergies" — and only the second may activate an account that is
 * about to be sent food. Requiring the key means the empty array is an answer
 * somebody typed rather than a field somebody forgot.
 *
 * **The one-subject rule is checked here rather than left to the service.** An
 * exclusion names exactly one of an ingredient, a diet classification or free
 * text; the database CHECK enforces it and the service throws
 * `InvalidArgumentException` before the constraint can, but that exception is
 * not part of the API vocabulary and would surface as a 500. Checking it in the
 * validator turns a server error into `validation.failed` on the offending
 * index, which is the difference between "something went wrong" and "row 2 of
 * your exclusions names two things".
 *
 * No `exists` rules on `ingredient_id` or `diet_classification_id`: those are
 * foreign keys the database already refuses, and a rule here would be a second
 * answer to a question one table already owns.
 *
 * **The diet is named by its code.** `diet_classification_code` is the
 * vocabulary member a client actually holds — `vegetarian`, `halal_friendly` —
 * because the public diet list (`GET /reference/diet-classifications`) publishes
 * codes and never identifiers, so a client had no way to send the UUID
 * `diet_classification_id` asks for. The code is checked against the *active*
 * classifications (an unknown or retired code is a validation error on that
 * field, not a 500 from the foreign key) and resolved to the identifier the
 * profile stores. `diet_classification_id` is still accepted for callers that
 * already hold one; sending both is refused, since two names for one choice can
 * disagree.
 */
class ReplaceDietaryProfileRequest extends FormRequest
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
            'allergens' => ['present', 'array', 'max:60'],
            'allergens.*.allergen_code' => ['required', 'string', 'max:60'],
            'allergens.*.severity' => ['nullable', new Enum(AllergenSeverity::class)],
            'allergens.*.notes' => ['nullable', 'string', 'max:500'],

            'exclusions' => ['sometimes', 'array', 'max:100'],
            'exclusions.*.kind' => ['nullable', new Enum(FoodExclusionKind::class)],
            'exclusions.*.ingredient_id' => ['nullable', 'uuid'],
            'exclusions.*.diet_classification_id' => ['nullable', 'uuid'],
            'exclusions.*.free_text' => ['nullable', 'string', 'max:200'],

            'diet_classification_id' => ['nullable', 'uuid'],
            'diet_classification_code' => [
                'nullable',
                'string',
                'max:60',
                'prohibits:diet_classification_id',
                Rule::exists(DietClassification::class, 'code')->where('is_active', true),
            ],
            'religious_requirement' => ['nullable', 'string', 'max:120'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $exclusions = $this->input('exclusions');

                if (! is_array($exclusions)) {
                    return;
                }

                foreach ($exclusions as $index => $exclusion) {
                    if (! is_array($exclusion) || $this->subjectCount($exclusion) === 1) {
                        continue;
                    }

                    $validator->errors()->add(
                        'exclusions.'.((string) $index),
                        'A food exclusion must name exactly one of an ingredient, a diet classification or free text.',
                    );
                }
            },
        ];
    }

    /**
     * @return array{
     *     allergens: list<array{allergen_code: string, severity?: string, notes?: string|null}>,
     *     exclusions?: list<array{kind?: string, ingredient_id?: string|null, diet_classification_id?: string|null, free_text?: string|null}>,
     *     diet_classification_id?: string|null,
     *     religious_requirement?: string|null,
     *     notes?: string|null
     * }
     */
    public function payload(): array
    {
        /**
         * @var array{
         *     allergens: list<array{allergen_code: string, severity?: string, notes?: string|null}>,
         *     exclusions?: list<array{kind?: string, ingredient_id?: string|null, diet_classification_id?: string|null, free_text?: string|null}>,
         *     diet_classification_id?: string|null,
         *     religious_requirement?: string|null,
         *     notes?: string|null
         * } $validated
         */
        $validated = $this->validated();

        // The code, when sent, is the diet: resolved here to the identifier the
        // profile stores, so the service keeps one input. A `null` code clears
        // the diet exactly as a `null` identifier does.
        if (array_key_exists('diet_classification_code', $validated)) {
            $code = $validated['diet_classification_code'];
            unset($validated['diet_classification_code']);
            $validated['diet_classification_id'] = $code === null
                ? null
                : (string) DietClassification::query()->where('code', $code)->value('id');
        }

        return $validated;
    }

    /**
     * @param  array<array-key, mixed>  $exclusion
     */
    private function subjectCount(array $exclusion): int
    {
        return count(array_filter(
            [
                $exclusion['ingredient_id'] ?? null,
                $exclusion['diet_classification_id'] ?? null,
                $exclusion['free_text'] ?? null,
            ],
            static fn (mixed $value): bool => $value !== null && $value !== '',
        ));
    }
}
