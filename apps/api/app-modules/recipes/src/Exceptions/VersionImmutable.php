<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Exceptions;

use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A write reached a published or retired version (master plan v2 §4.7).
 *
 * Not `resource.conflict`: the caller has not lost a race and reloading will
 * not help, because the resource is never going to be writable again. The
 * answer is a new draft version, and the code says so rather than making a
 * client infer it from a message.
 */
final class VersionImmutable extends ApiException
{
    public function __construct(RecipeVersionStatus $status)
    {
        parent::__construct(
            ErrorCode::CatalogueVersionImmutable,
            'A '.$status->value.' recipe version cannot be changed. Create a new draft version instead.',
            ['status' => $status->value],
        );
    }
}
