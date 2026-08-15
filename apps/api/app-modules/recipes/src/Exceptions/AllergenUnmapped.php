<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * Publication was refused because at least one line ingredient carries no
 * allergen determination at all.
 *
 * Its own code rather than a `publish_blocked` reason because the fix is in a
 * different place — the ingredient's mapping editor, not the recipe — and
 * because silence must never be mistaken for a clean result. An ingredient
 * nobody has assessed is not an ingredient assessed and found clear, and only
 * the second may reach a plate.
 *
 * The rule the evaluator applies: an ingredient passes when it has at least
 * one mapping row in any layer, **or** its `verification_status` is
 * `verified`, which is how "checked, and it carries nothing" is recorded.
 */
final class AllergenUnmapped extends ApiException
{
    /**
     * @param  list<string>  $ingredientIds
     */
    public function __construct(array $ingredientIds)
    {
        parent::__construct(
            ErrorCode::CatalogueAllergenUnmapped,
            'Every ingredient in a published recipe must carry an allergen determination.',
            ['ingredient_ids' => $ingredientIds],
        );
    }
}
