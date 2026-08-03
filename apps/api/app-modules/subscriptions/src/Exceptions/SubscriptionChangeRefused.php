<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A change to a live subscription was refused.
 *
 * **Mostly this is the 24-hour rule** (approved semantics §2): skip, pause,
 * resume, address and window changes take effect only for deliveries more than
 * `change_cutoff_hours` away, and inside that window the next delivery proceeds
 * as scheduled. The refusal carries `cut_off_at` and `effective_from` so a
 * client can say "changes to Tuesday closed at 18:00 on Monday; the earliest
 * day you can change is Wednesday" rather than "no".
 *
 * The vocabulary:
 *
 *  * `inside_cut_off` — the delivery is nearer than the plan's window allows.
 *  * `not_permitted` — the plan itself forbids it (`skip_allowed`,
 *    `pause_allowed` on `subscription_plan_profiles`); the kitchen's stored
 *    right, not an assumption.
 *  * `invalid_transition` — `paused → paused`, anything out of a terminal
 *    state, and the rest of the state machine's refusals.
 *  * `already_settled` — the day has already been generated, skipped or
 *    delivered, so there is nothing left to change about it.
 *  * `not_a_delivery_day` — the date is not one of the subscription's weekdays.
 *  * `exhausted` — the balance is spent; the answer is a renewal, not a change.
 *  * `address_not_owned`, `address_not_deliverable`, `area_not_served` — the
 *    new address, checked exactly as the original one was.
 *  * `stale_version` — the caller's `lock_version` is not the current one.
 *
 * `resource.conflict` rather than a validation failure: the request is
 * well-formed and the customer meant it. What has happened is that time passed.
 */
final class SubscriptionChangeRefused extends ApiException
{
    /**
     * @param  list<array<string, mixed>>  $reasons
     */
    public function __construct(array $reasons)
    {
        parent::__construct(
            ErrorCode::ResourceConflict,
            'This change cannot be made to the subscription as it stands.',
            ['reasons' => $reasons],
        );
    }
}
