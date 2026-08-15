<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A recipe cannot be archived while it still has a published version.
 *
 * Archiving is not a way to withdraw something from sale: retiring the
 * published version is, and it has its own action, its own permission and its
 * own audit event. Allowing archive to do it implicitly would let a manager
 * pull a live recipe with a route that never mentions publication.
 */
final class RecipeInUse extends ApiException
{
    /**
     * @param  list<string>  $publishedVersionIds
     */
    public function __construct(array $publishedVersionIds)
    {
        parent::__construct(
            ErrorCode::CatalogueInUse,
            'This recipe still has a published version. Retire it before archiving the recipe.',
            ['published_version_ids' => $publishedVersionIds],
        );
    }
}
