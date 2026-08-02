<?php

declare(strict_types=1);

namespace Healthy360\Orders\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * Checkout was refused, with **every** reason it was refused for.
 *
 * The rule K1.2 set for publication gates, applied at the moment it matters
 * most. A checkout that reveals one problem per attempt — verify your email,
 * now add an address, now that article is withdrawn, now the cut-off has
 * passed — is four round trips and a lost customer. One refusal carrying four
 * reasons is a screen somebody can act on.
 *
 * Each reason is `{reason, …context}`: a stable machine key plus whatever
 * identifies the offending thing. The vocabulary:
 *
 *  * `account_not_ready` — the activation evaluator is still outstanding;
 *    `outstanding` carries its own reason codes, so the checkout can show the
 *    account checklist rather than a sentence about it.
 *  * `account_not_active` — the checklist is clean but the account has not
 *    been activated, suspended or closed.
 *  * `guest_not_verified` — a guest whose session has not reached
 *    `place_order`, which is the grade a proven contact point buys. Distinct
 *    from the two above because a guest never activates and never will.
 *  * `cart_empty`, `cart_not_open` — nothing to place, or already placed.
 *  * `address_not_owned` — the address belongs to another account.
 *  * `area_not_served`, `zone_suspended` — nobody delivers there, or this
 *    kitchen has paused going there. Kept apart because one is permanent and
 *    the other is this week.
 *  * `currency_mismatch` — the delivery fee or a line prices in a currency
 *    the order is not denominated in. Never converted.
 *  * `mixed_delivery_dates` — the basket asks for more than one day, which
 *    this phase's single-date order cannot express.
 *  * `cut_off_passed`, `branch_closed`, `date_in_the_past` — the branch will
 *    not take an order for that day; `cut_off_at` says by when it would have.
 *  * the whole line vocabulary from `LineRefused` — `item_not_published`,
 *    `unpriced`, `channel_unavailable` and the rest — folded in per line with
 *    the offending `catalogue_item_id` attached, because at checkout they are
 *    reasons the *order* was refused.
 *
 * Carried under `ErrorCode::ResourceConflict` (409): the request is
 * well-formed and the customer meant it, but the world it describes has moved
 * — which is a conflict rather than a validation failure. The error vocabulary
 * belongs to the integration wave, so a dedicated `order.placement_refused`
 * may be introduced there without any call site changing, since every caller
 * throws this class rather than choosing a code.
 */
final class PlacementRefused extends ApiException
{
    /**
     * @param  list<array<string, mixed>>  $reasons
     */
    public function __construct(array $reasons)
    {
        parent::__construct(
            ErrorCode::ResourceConflict,
            'This order cannot be placed as it stands.',
            ['reasons' => $reasons],
        );
    }
}
