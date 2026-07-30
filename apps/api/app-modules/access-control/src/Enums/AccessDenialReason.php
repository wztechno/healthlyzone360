<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Enums;

/**
 * Distinct denial reason per step of the six-step RBAC decision (plan §10).
 * Separated concerns (entitlement, consent, step-up, relationships) carry
 * their own reasons in their own services — never folded in here.
 */
enum AccessDenialReason: string
{
    case Unauthenticated = 'unauthenticated';
    case MembershipInactive = 'membership_inactive';
    case BranchOutOfScope = 'branch_out_of_scope';
    case PermissionNotGranted = 'permission_not_granted';
    case ResourceOutsideOrganisation = 'resource_outside_organisation';
    case PolicyDenied = 'policy_denied';
}
