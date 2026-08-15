<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Tenancy\TenantContext;
use Throwable;

/**
 * Run a piece of work in the seller's tenant context, and give the caller's
 * back afterwards.
 *
 * **Why checkout needs this at all.** A customer is a member of no
 * organisation. Everything a placement has to read about the kitchen —
 * whether it delivers to an area and for how much, what a published recipe's
 * allergen label says — lives in organisation-scoped tables whose global scope
 * *fails closed*: with no organisation resolved they throw rather than return
 * everything, which is the right default and exactly wrong for this one
 * caller. The alternatives were to re-derive each of those rules here with
 * `withoutTenancy()`, which would mean a second delivery-zone precedence and a
 * second allergen derivation, or to state once that a checkout is transacted
 * in the seller's context. This is that statement.
 *
 * It is the application-layer twin of `DatabaseTenantContext::during()`, and
 * it is deliberately shaped the same way: explicit, scoped to a callback,
 * restoring the previous snapshot in a `finally` so a thrown refusal cannot
 * leave a customer's request running as a kitchen. Every call site is a
 * decision, and there is exactly one.
 *
 * **What it does not do is grant anything.** The user identity is carried
 * through unchanged, so the PostgreSQL policies still see the same person; the
 * organisation setting makes the *seller's own published data* readable, which
 * is data the seller publishes to customers anyway. It is the same posture the
 * marketplace already takes for anonymous reads — `PriceResolver`'s note that
 * "an anonymous read still runs with `app.organisation_id` set to the kitchen
 * being browsed" describes this exact arrangement, arrived at independently
 * for reads.
 */
final readonly class SellerContext
{
    public function __construct(private TenantContext $context) {}

    /**
     * @template TReturn
     *
     * @param  callable(): TReturn  $callback
     * @return TReturn
     *
     * @throws Throwable
     */
    public function during(string $organisationId, ?string $branchId, callable $callback): mixed
    {
        $previous = $this->context->toArray();

        $this->context->restore([
            'user_id' => $previous['user_id'],
            'organisation_id' => $organisationId,
            'branch_id' => $branchId,
        ]);

        try {
            return $callback();
        } finally {
            $this->context->restore($previous);
        }
    }
}
