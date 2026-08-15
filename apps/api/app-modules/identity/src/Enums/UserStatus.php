<?php

declare(strict_types=1);

namespace Healthy360\Identity\Enums;

/**
 * Whether an identity may be used.
 *
 * `closed` is terminal and is the state J2's closure flow leaves behind. The
 * row survives — orders and audit events point at it — but the guard refuses
 * to retrieve it, so no credential of any kind resolves to a user again.
 * `suspended` is an operator's temporary refusal and is reversible.
 */
enum UserStatus: string
{
    case Active = 'active';

    case Suspended = 'suspended';

    case Closed = 'closed';

    /**
     * Whether an identity in this state may authenticate.
     *
     * The single predicate `ActiveUserProvider` consults, so "who can sign in"
     * has one answer rather than one per entry point.
     */
    public function canAuthenticate(): bool
    {
        return $this === self::Active;
    }
}
