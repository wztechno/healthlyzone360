<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Enums;

/**
 * How much a guest token is allowed to do.
 *
 * The whole authorisation model for the guest journey, in two values. There is
 * no permission registry entry behind a guest token and there deliberately is
 * not one: permissions are held by a user through a role, and a guest has no
 * user. What a guest holds instead is a *graded capability* — the token itself
 * says what it may do, and the grade is raised only by an act the server
 * witnessed.
 *
 * `CheckoutDraft` is what an anonymous browser is handed on its first request:
 * enough to build a basket, price it and choose a delivery slot, none of which
 * creates an obligation to anybody. `PlaceOrder` is what that becomes once a
 * passcode has proven a contact point, because an order is a promise that
 * somebody will be told when it is late, and a destination nobody proved is a
 * promise made to a typo.
 *
 * The ordering is total and is expressed by `permits()` rather than by an `int`
 * backing, because these are capabilities and not a score: adding a third grade
 * later should force every call site to say where it sits, which a numeric
 * comparison would quietly absorb.
 */
enum GuestSessionGrade: string
{
    /** Build and price a basket. Creates no obligation to anybody. */
    case CheckoutDraft = 'checkout_draft';

    /** Place a real order. Requires a proven contact point. */
    case PlaceOrder = 'place_order';

    /**
     * Whether a token at this grade satisfies a requirement for `$required`.
     */
    public function permits(self $required): bool
    {
        return $this->rank() >= $required->rank();
    }

    /**
     * Whether reaching this grade requires a verified contact point.
     *
     * Mirrors `guest_sessions_grade_proof_check`. The database is the authority;
     * this is here so a caller can refuse before the insert rather than catch a
     * constraint violation.
     */
    public function requiresVerifiedContact(): bool
    {
        return $this === self::PlaceOrder;
    }

    private function rank(): int
    {
        return match ($this) {
            self::CheckoutDraft => 1,
            self::PlaceOrder => 2,
        };
    }
}
