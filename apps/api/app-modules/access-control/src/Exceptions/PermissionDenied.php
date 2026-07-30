<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Exceptions;

use Healthy360\AccessControl\Enums\AccessDenialReason;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A six-step RBAC denial surfaced over HTTP. The step that denied the request
 * is reported in `details.reason` so clients and tests can distinguish the
 * concerns the plan (§10) insists stay separate, while the wire code stays
 * the single stable `authz.permission_denied`.
 */
class PermissionDenied extends ApiException
{
    public function __construct(public readonly AccessDenialReason $reason, string $permission)
    {
        parent::__construct(
            ErrorCode::AuthzPermissionDenied,
            details: ['reason' => $reason->value, 'permission' => $permission],
        );
    }
}
