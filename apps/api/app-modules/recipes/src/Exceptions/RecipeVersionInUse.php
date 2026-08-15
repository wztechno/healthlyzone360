<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A published recipe version cannot be retired while a published catalogue
 * item sells the recipe it belongs to (K1.4).
 *
 * The label a diner reads on that dish is derived from this version. Retiring
 * it would leave the listing describing a formulation the system no longer
 * holds — the food-safety twin of archiving an ingredient a live recipe names.
 * `details.catalogue_item_ids` names what to withdraw first, so the answer is
 * "retire those" rather than "reload and try again".
 *
 * Separate from `RecipeInUse`, which guards recipe *archival* against the
 * versions themselves: the two refusals name different things and send the
 * caller to different screens, and collapsing them would produce an error that
 * says "something, somewhere".
 */
final class RecipeVersionInUse extends ApiException
{
    /**
     * @param  list<string>  $catalogueItemIds
     */
    public function __construct(array $catalogueItemIds)
    {
        parent::__construct(
            ErrorCode::CatalogueInUse,
            'A published catalogue item still sells this recipe. Retire it before retiring the version.',
            ['catalogue_item_ids' => $catalogueItemIds],
        );
    }
}
