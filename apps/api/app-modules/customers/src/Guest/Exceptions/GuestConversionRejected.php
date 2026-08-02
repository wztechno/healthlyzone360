<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Exceptions;

use RuntimeException;

/**
 * A guest account could not become a registered one.
 *
 * The interesting refusal is `userAlreadyHasAccount`. One person holds at most
 * one `b2c` account — a partial unique index says so — and somebody who ordered
 * as a guest and *then* registered with an address they already had an account
 * under is asking for two. Merging the two is a real product decision (whose
 * addresses win, whose dietary profile, what happens to orders on both sides)
 * and this phase does not invent an answer to it. Refusing loudly leaves the
 * registration itself intact and hands the integrator a named case, which is a
 * better outcome than a unique-violation surfacing as a 500 during sign-up.
 */
final class GuestConversionRejected extends RuntimeException
{
    public const string REASON_NOT_GUEST = 'account_not_guest';

    public const string REASON_ACCOUNT_CLOSED = 'account_closed';

    public const string REASON_USER_HAS_ACCOUNT = 'user_already_has_consumer_account';

    private function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }

    public static function notGuest(): self
    {
        return new self(self::REASON_NOT_GUEST, 'Only a guest account can be converted.');
    }

    public static function accountClosed(): self
    {
        return new self(self::REASON_ACCOUNT_CLOSED, 'A closed guest account cannot be converted.');
    }

    public static function userAlreadyHasAccount(): self
    {
        return new self(self::REASON_USER_HAS_ACCOUNT, 'This person already holds a consumer account.');
    }
}
