<?php

declare(strict_types=1);

namespace Healthy360\Customers\Enums;

/**
 * Which party a customer account represents.
 *
 * The discriminator behind the three CHECK constraints on the table: `b2c`
 * must have a user, `guest` must not, `b2b` must have an organisation. Every
 * shape rule in this module reduces to one of those three facts, so the enum
 * carries them rather than leaving each service to remember.
 */
enum CustomerAccountType: string
{
    /** A person's own account. Holds a user. */
    case B2c = 'b2c';

    /** A company's account. Holds an organisation; the buyers are its members. */
    case B2b = 'b2b';

    /** Somebody ordering without an account. Holds neither; contacts hang off it. */
    case Guest = 'guest';

    public function requiresUser(): bool
    {
        return $this === self::B2c;
    }

    public function requiresOrganisation(): bool
    {
        return $this === self::B2b;
    }

    /**
     * Whether this shape goes through the D2C activation evaluator.
     *
     * Guests never activate — the whole point is that they order without an
     * account lifecycle — and B2B accounts are activated by B1's provisioning
     * transaction, which has its own gates (KYC, agreement, credit).
     */
    public function usesSelfServiceActivation(): bool
    {
        return $this === self::B2c;
    }
}
