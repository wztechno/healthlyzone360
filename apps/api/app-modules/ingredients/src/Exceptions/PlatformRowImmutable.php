<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Exceptions;

use Healthy360\AccessControl\Enums\AccessDenialReason;
use Healthy360\AccessControl\Exceptions\PermissionDenied;

/**
 * A tenant tried to write a platform-library row.
 *
 * Not a 404: hiding the row would be dishonest — the caller can read it, it
 * is in their list, and pretending it vanished when they try to edit it is
 * the kind of behaviour that produces bug reports about "disappearing
 * ingredients". It is a policy denial, and it says so.
 *
 * Forking a platform row into a tenant row is the supported way forward. The
 * fork endpoint arrives in a later K1 slice; until then the reason code is
 * the whole answer.
 */
final class PlatformRowImmutable extends PermissionDenied
{
    public function __construct(string $permission = 'catalogue.manage_organisation')
    {
        parent::__construct(AccessDenialReason::PolicyDenied, $permission);
    }
}
