<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The `If-Match` validator did not match the row's current `lock_version`
 * (master plan v2 §4.13).
 *
 * A near-twin of the ingredients module's exception of the same name, and
 * deliberately not shared: a module may not reach into another module's
 * exception namespace for a concept neither owns. When a third consumer
 * appears, the class earns a home in `Support`; two is not yet a pattern.
 */
final class StaleLockVersion extends ApiException
{
    public function __construct(int $currentLockVersion)
    {
        parent::__construct(
            ErrorCode::ResourceConflict,
            'This resource changed since you last read it. Reload it and reapply your change.',
            ['current_lock_version' => $currentLockVersion],
        );
    }
}
