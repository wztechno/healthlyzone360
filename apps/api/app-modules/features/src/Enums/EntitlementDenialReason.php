<?php

declare(strict_types=1);

namespace Healthy360\Features\Enums;

/**
 * Denial reasons for the feature-entitlement check — deliberately distinct
 * from the RBAC AccessDenialReason set (plan §10: separated concerns).
 */
enum EntitlementDenialReason: string
{
    case EntitlementMissing = 'entitlement_missing';
}
