<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Concerns;

use Healthy360\Support\Http\Middleware\RequirePrecondition;
use Illuminate\Http\Request;

/**
 * `If-Match` as an offer rather than as a demand.
 *
 * **None of the subscription writes carries the `precondition` middleware, and
 * that is the C1 basket decision applied to the same shape of resource.** The
 * header prevents a *lost update*, and a lost update needs two authors. A
 * subscription has one: the customer. Everything else that touches the row —
 * generation moving `balance_days_consumed`, the renewal sweep — is the
 * platform acting on the customer's own standing instruction, and none of it
 * competes with a person editing their weekdays. The race would have to be run
 * by somebody against themselves in two tabs.
 *
 * So the validator is *served* — `SubscriptionPresenter` carries `lock_version`
 * — and it is *honoured* when sent, because a careful client with two tabs open
 * should be able to protect itself. What it is not is mandatory: a 428 on every
 * pause would break every caller that has ever worked, to protect them from a
 * race they are not in. That is the same trade `/carts` states and the opposite
 * of the one the kitchen's order actions state, where two staff confirming the
 * same order at once is an ordinary Tuesday.
 *
 * A malformed validator returns null and is therefore *ignored* rather than
 * refused with a 400, which is the one place this differs from
 * `ReadsPrecondition`. There the header was mandatory, so an unparseable value
 * was a client that meant to participate and got it wrong. Here it is optional,
 * and refusing a header nobody had to send would punish the more careful
 * client.
 */
trait ReadsOptionalPrecondition
{
    /**
     * The `lock_version` the caller wrote against, when they said.
     */
    protected function optionalLockVersion(Request $request): ?int
    {
        return RequirePrecondition::lockVersion($request);
    }
}
