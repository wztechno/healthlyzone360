<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A subscription could not be started, with **every** reason at once.
 *
 * The shape `PlacementRefused` established, for the same argument: buying a
 * twenty-day plan is a longer, more considered purchase than a single order,
 * and telling somebody one problem per attempt — the plan is not published, now
 * the duration is not offered, now nobody delivers to your address — is three
 * round trips through a form they have already filled in.
 *
 * Each reason is `{reason, …context}`. The vocabulary, in the order the service
 * checks it:
 *
 *  * the whole `CheckoutEligibility` vocabulary — `account_not_ready`,
 *    `account_not_active`, `guest_not_verified` — reused rather than restated,
 *    because "may this party buy food from us" has one answer and C1 already
 *    owns it. A guest reaching this is refused for a second reason as well:
 *    a subscription is a standing arrangement and a guest account expires.
 *  * `plan_unknown`, `plan_not_published`, `plan_not_subscription` — the article
 *    is not a plan a customer may subscribe to.
 *  * `configuration_unknown`, `configuration_not_active` — the matrix cell.
 *  * `duration_unknown`, `duration_not_offered`, `duration_not_fixed` — a
 *    one-off duration has no balance of days to sell.
 *  * `unpriced`, `currency_mismatch` — there is no confirmed price for the
 *    configuration, or it is quoted in another currency. A subscription with no
 *    captured price would have nothing to grandfather.
 *  * `channel_unavailable`, `channel_not_trading` — the plan is not offered
 *    through the channel being bought on.
 *  * `address_not_owned`, `address_not_deliverable`, `area_not_served`,
 *    `zone_suspended` — where the food would go.
 *  * `weekdays_empty`, `weekdays_invalid` — the delivery weekday set.
 *  * `guest_may_not_subscribe` — see above.
 *
 * Carried under `ErrorCode::OrderPlacementRefused` (409) deliberately rather
 * than under a new code: adding to the `ErrorCode` enum is integrator-2's, and
 * a placeholder code invented here would have to be renamed in a published
 * contract. The status and the shape are already right — the request is
 * well-formed and meant, and the world it describes refuses it.
 */
final class SubscriptionRefused extends ApiException
{
    /**
     * @param  list<array<string, mixed>>  $reasons
     */
    public function __construct(array $reasons)
    {
        parent::__construct(
            ErrorCode::OrderPlacementRefused,
            'This subscription cannot be started as it stands.',
            ['reasons' => $reasons],
        );
    }
}
