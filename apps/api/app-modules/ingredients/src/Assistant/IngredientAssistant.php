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
 * category codes, the allergen classes and this request's USDA and Open Food Facts candidates — and
 * it answers with those numbers and codes. The unit and the mass of one litre or piece are its own
 * estimate, bounded and marked as AI on the form.
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
     * @param  list<string>  $allergenClasses  one line per active allergen class
     * @param  list<string>  $allergenCandidates  one line per Open Food Facts product, numbered
     */
    public function __construct(
        private readonly array $categories,
        private readonly array $ingredients,
        private readonly array $candidates,
        private readonly array $allergenClasses = [],
        private readonly array $allergenCandidates = [],
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
            'unit: how the kitchen buys and stocks it — "kg" for anything weighed, "l" for liquids measured by volume (oils, milk, vinegar, syrups), "piece" for things counted (eggs, rolls, tortillas).',
            'grams_per_unit: for "l", the mass of one litre in grams (olive oil about 915, milk about 1030); for "piece", the typical mass of one piece in grams (an egg about 50). Null for "kg" or when unsure.',
            'allergen_pick: the number of the OPEN FOOD FACTS product that is plainly this ingredient as a kitchen buys it — not a branded mix or another food — choosing only one marked importable. Null when none fits.',
            'allergens: the codes from ALLERGEN CLASSES this ingredient itself carries as typically purchased (sesame in tahini, milk in butter, gluten in bulgur), each "contains"; use "may_contain" only for well-known cross-contact. An empty list when it carries none.',
            'allergens_reason: one short sentence the cook will read.',
            '',
            'CATEGORIES (code — name — parent):',
            ...$this->categories,
            '',
            'INGREDIENTS (number — English — Arabic):',
            ...($this->ingredients === [] ? ['(none)'] : $this->ingredients),
            '',
            'USDA CANDIDATES (number — description — data type — suitability):',
            ...($this->candidates === [] ? ['(none)'] : $this->candidates),
            '',
            'ALLERGEN CLASSES (code — name):',
            ...$this->allergenClasses,
            '',
            'OPEN FOOD FACTS PRODUCTS (number — product — brand — declared allergens — importability):',
            ...($this->allergenCandidates === [] ? ['(none)'] : $this->allergenCandidates),
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
            'unit' => $schema->string()->enum(['kg', 'l', 'piece', null])->nullable()->required(),
            'grams_per_unit' => $schema->number()->nullable()->required(),
            'allergen_pick' => $schema->integer()->nullable()->required(),
            'allergens' => $schema->array()->items($schema->object(fn (JsonSchema $item): array => [
                'code' => $item->string()->required(),
                'containment' => $item->string()->enum(['contains', 'may_contain'])->required(),
            ]))->required(),
            'allergens_reason' => $schema->string()->nullable()->required(),
        ];
    }
}
