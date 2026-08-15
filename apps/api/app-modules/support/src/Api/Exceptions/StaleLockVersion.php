<?php

declare(strict_types=1);

namespace Healthy360\Support\Api\Exceptions;

use Healthy360\Support\Api\ErrorCode;

/**
 * The `If-Match` validator did not match the row's current `lock_version`
 * (master plan v2 §4.13).
 *
 * Promoted here in K1.4, on the terms the K1.2 copy wrote down for itself:
 * "a module may not reach into another module's exception namespace for a
 * concept neither owns … when a third consumer appears, the class earns a
 * home in `Support`; two is not yet a pattern." The catalogues module is the
 * third, so the two near-identical copies in `Ingredients` and `Recipes` are
 * replaced by this one rather than joined by a third.
 *
 * Optimistic concurrency is a `Support` concern in every other respect
 * already — `ErrorCode::ResourceConflict`, `RequirePrecondition` and the
 * `ETag` convention all live there — so this is the exception rejoining the
 * mechanism it belongs to, not a shared bag of exceptions being invented.
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
