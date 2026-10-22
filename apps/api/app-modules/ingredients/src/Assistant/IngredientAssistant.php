<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Assistant;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Attributes\MaxSteps;
use Laravel\Ai\Attributes\Provider;
use Laravel\Ai\Attributes\Timeout;
use Laravel\Ai\Contracts\Agent;
use Laravel\Ai\Contracts\HasStructuredOutput;
use Laravel\Ai\Enums\Lab;
use Laravel\Ai\Promptable;

/**
 * The new-ingredient assistant: one structured call, no tools.
 *
 * Everything it may choose from is numbered in its instructions — the kitchen's ingredients, the
 * category codes and this request's USDA candidates — and it answers with those numbers and codes.
 * {@see IngredientAssistService} maps them back and drops anything that is not on the lists, so a
 * hallucinated id, a foreign kitchen's row or a USDA record nobody searched for never reaches the
 * form. With no tool loop the time budget is this one call.
 */
#[Provider(Lab::OpenAI)]
#[MaxSteps(1)]
#[Timeout(20)]
final class IngredientAssistant implements Agent, HasStructuredOutput
{
    use Promptable;

    /**
     * @param  list<string>  $categories  one line per selectable category
     * @param  list<string>  $ingredients  one line per visible ingredient, numbered
     * @param  list<string>  $candidates  one line per USDA candidate, numbered
     */
    public function __construct(
        private readonly array $categories,
        private readonly array $ingredients,
        private readonly array $candidates,
    ) {}

    /** `OPENAI_MODEL`, read through config so a cached config still answers. */
    public function model(): string
    {
        return config()->string('services.openai.model');
    }

    public function instructions(): string
    {
        return implode("\n", [
            'You help a Lebanese commercial kitchen add a raw ingredient to its catalogue. The user message is the English name they typed.',
            '',
            'name_ar: the Arabic name a Lebanese kitchen would use for this ingredient, in Arabic script. Null if you are unsure.',
            'category_code / subcategory_code: choose only from CATEGORIES. The subcategory must be a child of the category. Pick the most specific subcategory that fits; null when nothing fits.',
            'possible_duplicates: numbers from INGREDIENTS that are the same ingredient under another name or spelling (cilantro/coriander, garbanzo/chickpea). Never list one that is merely related (chicken breast is not chicken thigh). Give a short reason for each.',
            'nutrition_pick: the number of the USDA candidate that best represents the ingredient as purchased, choosing only a candidate marked suitable. Prefer Foundation, then SR Legacy, then Branded. Null when none fits.',
            'Never guess the preparation state. When the name does not say raw, dried, cooked or canned and the candidates differ on it, pick the most generic suitable one and say so in nutrition_reason.',
            'nutrition_relation: "same" when the candidate is the same food in other words; "more_specific" when it adds detail the name does not state (a preparation, a cut, a variety); "different" when it is another food or contradicts the name. Null when nutrition_pick is null.',
            'nutrition_reason: one short sentence the cook will read.',
            '',
            'CATEGORIES (code — name — parent):',
            ...$this->categories,
            '',
            'INGREDIENTS (number — English — Arabic):',
            ...($this->ingredients === [] ? ['(none)'] : $this->ingredients),
            '',
            'USDA CANDIDATES (number — description — data type — suitability):',
            ...($this->candidates === [] ? ['(none)'] : $this->candidates),
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'name_ar' => $schema->string()->nullable()->required(),
            'category_code' => $schema->string()->nullable()->required(),
            'subcategory_code' => $schema->string()->nullable()->required(),
            'possible_duplicates' => $schema->array()->items($schema->object(fn (JsonSchema $item): array => [
                'number' => $item->integer()->required(),
                'reason' => $item->string()->required(),
            ]))->required(),
            'nutrition_pick' => $schema->integer()->nullable()->required(),
            'nutrition_relation' => $schema->string()->enum(['same', 'more_specific', 'different', null])->nullable()->required(),
            'nutrition_reason' => $schema->string()->nullable()->required(),
        ];
    }
}
