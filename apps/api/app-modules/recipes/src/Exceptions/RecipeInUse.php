<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A recipe cannot be archived while it still has a published version, or while
 * a published catalogue item sells it.
 *
 * Archiving is not a way to withdraw something from sale: retiring the
 * published version is, and so is retiring the listing, and each has its own
 * action, its own permission and its own audit event. Allowing archive to do
 * either implicitly would let a manager pull a live recipe with a route that
 * never mentions publication.
 *
 * **Both holds, both keys, always.** `details.published_version_ids` names the
 * versions to retire and `details.catalogue_item_ids` the listings to withdraw.
 * Each is present — empty when that side holds nothing — so a client reads one
 * shape whichever side refused; a shape that changed with the answer would be
 * a client bug waiting to happen, the rule the ingredient archive's refusal
 * already follows.
 */
final class RecipeInUse extends ApiException
{
    /**
     * @param  list<string>  $publishedVersionIds
     * @param  list<string>  $catalogueItemIds
     */
    public function __construct(array $publishedVersionIds, array $catalogueItemIds)
    {
        parent::__construct(
            ErrorCode::CatalogueInUse,
            'This recipe still has a published version or a published catalogue item selling it. Retire those before archiving the recipe.',
            [
                'published_version_ids' => $publishedVersionIds,
                'catalogue_item_ids' => $catalogueItemIds,
            ],
        );
    }
}
