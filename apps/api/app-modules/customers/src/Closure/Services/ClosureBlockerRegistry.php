<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Services;

use App\Models\User;
use Healthy360\Customers\Closure\Contracts\ClosureBlocker;
use Healthy360\Customers\Closure\Results\BlockerVerdict;
use Healthy360\Customers\Models\CustomerAccount;

/**
 * Every reason a closure might not proceed, asked in one place and answered in
 * full.
 *
 * **It runs all of them, always.** Short-circuiting on the first blocking
 * verdict would be faster and would produce the worst possible screen: a
 * customer clears their open orders, tries again, and discovers a subscription;
 * clears that, tries again, and discovers a membership. Three round trips
 * through an unpleasant journey to learn something the platform knew at the
 * start. The cost of asking six questions instead of one is six cheap counts.
 *
 * **The order is the reading order.** Blockers are registered explicitly rather
 * than discovered, because the sequence a customer sees them in is a product
 * decision — the things they can act on first, then the things somebody else
 * must act on, then the honest not-applicables — and directory order is not a
 * product decision.
 *
 * **Nothing here decides what a `not_applicable` means.** The registry reports
 * what it was told; `BlockerStatus::stopsClosure()` is the single place the
 * consequence is decided, so a future policy change ("refuse until payments
 * exist") is one method rather than six.
 */
final class ClosureBlockerRegistry
{
    /**
     * @param  list<ClosureBlocker>  $blockers
     */
    public function __construct(private readonly array $blockers) {}

    /**
     * Ask every blocker about this identity.
     *
     * @return list<BlockerVerdict>
     */
    public function evaluate(User $user, ?CustomerAccount $account): array
    {
        return array_map(
            static fn (ClosureBlocker $blocker): BlockerVerdict => $blocker->evaluate($user, $account),
            $this->blockers,
        );
    }

    /**
     * Whether anything the registry found stops a closure.
     *
     * @param  list<BlockerVerdict>  $verdicts
     */
    public function isBlocked(array $verdicts): bool
    {
        foreach ($verdicts as $verdict) {
            if ($verdict->stopsClosure()) {
                return true;
            }
        }

        return false;
    }

    /**
     * The verdicts in the shape the request row and the audit trail store.
     *
     * @param  list<BlockerVerdict>  $verdicts
     * @return list<array{code: string, status: string, count: int, reason: string|null}>
     */
    public function toArray(array $verdicts): array
    {
        return array_map(static fn (BlockerVerdict $verdict): array => $verdict->toArray(), $verdicts);
    }

    /**
     * The codes registered, for the tripwire test and for a client that wants
     * to render a placeholder per blocker before the verdicts arrive.
     *
     * @return list<string>
     */
    public function codes(): array
    {
        return array_map(static fn (ClosureBlocker $blocker): string => $blocker->code(), $this->blockers);
    }

    /**
     * @return list<ClosureBlocker>
     */
    public function all(): array
    {
        return $this->blockers;
    }
}
