<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Healthy360\B2b\Models\OrganisationInvitation;

/**
 * An invitation and its token, together, exactly once.
 *
 * The pair exists as a distinct type rather than as a two-element array so
 * that "this value contains a live credential" is visible in a signature. Only
 * the mail that carries the invitation should ever read `$token`; nothing
 * should log it, persist it or return it in a response body.
 */
final readonly class IssuedInvitation
{
    public function __construct(
        public OrganisationInvitation $invitation,
        public string $token,
    ) {}
}
