<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The `If-Match` validator did not match the row's current `lock_version`:
 * somebody else wrote to it between the caller's read and their write
 * (master plan v2 §4.13).
 *
 * `details.current_lock_version` is the value the caller needs to reload
 * against, so a client can offer "reload" or "keep mine" without a second
 * round trip just to discover what it lost to.
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
