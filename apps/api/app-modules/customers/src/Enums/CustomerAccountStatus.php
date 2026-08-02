<?php

declare(strict_types=1);

namespace Healthy360\Customers\Enums;

/**
 * A customer account's lifecycle.
 *
 * `provisional` is where self-service accounts start and is a real state, not
 * a nicer word for incomplete: an account in it exists, holds addresses and
 * declarations, and cannot order. That is what lets onboarding be interrupted
 * and resumed rather than being a form that must be finished in one sitting.
 *
 * `active` is the activation evaluator's verdict made durable. Nothing else
 * writes it — a client cannot PATCH its way to active, which is the
 * "server-authority" rule the J1 tests exist to prove.
 *
 * The transitions permitted are declared here rather than in the service that
 * performs them, so "can a closed account be reactivated" has one answer that
 * a reader can find.
 */
enum CustomerAccountStatus: string
{
    case Provisional = 'provisional';

    case Active = 'active';

    case Suspended = 'suspended';

    case Closed = 'closed';

    /**
     * Whether this account may place an order.
     *
     * The single predicate C1 will consult. `provisional` cannot — an account
     * that has not proven a contact or an address is an account nobody can
     * deliver to.
     */
    public function canTransact(): bool
    {
        return $this === self::Active;
    }

    /**
     * Whether `$next` is a legal move from here.
     *
     * **Closure is terminal.** Reopening a closed account is not a state
     * transition — the identity has been anonymised or is on its way to being
     * — so the answer is a new account, and this method refuses rather than
     * leaving the decision to whichever caller asks first.
     */
    public function canTransitionTo(self $next): bool
    {
        if ($this === $next) {
            return false;
        }

        return match ($this) {
            self::Provisional => in_array($next, [self::Active, self::Closed], true),
            self::Active => in_array($next, [self::Suspended, self::Closed], true),
            self::Suspended => in_array($next, [self::Active, self::Closed], true),
            self::Closed => false,
        };
    }
}
