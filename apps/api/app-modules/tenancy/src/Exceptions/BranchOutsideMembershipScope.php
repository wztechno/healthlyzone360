<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The declared branch context is not an active branch of the selected
 * organisation, or falls outside the authenticated user's membership scope.
 */
class BranchOutsideMembershipScope extends ApiException
{
    public function __construct()
    {
        parent::__construct(ErrorCode::ContextBranchOutOfScope);
    }
}
