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
 *  * `customer_required` — a delivery or a pickup with nobody named. Somebody
 *    has to be rung when the food is late, and a collection nobody can be
 *    called about is a bag on a shelf. A **counter** sale is exempt: a stranger
 *    buying lunch is not worth inventing a customer record for.
 *  * `address_required` — a delivery with no destination.
 *  * `address_not_applicable` — a pickup or a counter sale that carries one.
 *    Refused rather than silently dropped, and this is the one of the three
 *    that would otherwise go unsaid: an address supplied and ignored means the
 *    caller believed something about this order that is not true of it, and the
 *    honest answer is to say so before the food is cooked. It is also the
 *    refusal a desk meets most often — an agent starts a delivery for a known
 *    customer, the customer decides to wait for it, and the address is still on
 *    the placement.
 *
 * The three above are `ComposedPlacement`'s shape rules, asked by
 * `OrderPlacementService::shapeReasons()`. They restate in PHP what
 * `orders_fulfilment_shape_check` states in SQL, and they are here rather than
 * left to the database so that a desk agent who picked the wrong fulfilment
 * type reads a sentence instead of SQLSTATE 23514 from three layers down. Each
 * carries the offending `fulfilment_type`. `POST /catalogue/order-desk/quote`
 * serves the identical vocabulary as **data** rather than as a refusal, because
 * a quote's job is to explain rather than to stop.
 *
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
 * Carried under `ErrorCode::OrderPlacementRefused`
 * (`order.placement_refused`, 409) since C1's HTTP layer. It was the generic
 * `resource.conflict` while the vocabulary was still the integration wave's to
 * extend, and the promotion cost exactly this line, because every caller throws
 * this class rather than choosing a code. Still a **409**, and for the original
 * reason: the request is well-formed and the customer meant it, but the world it
 * describes has moved. What the dedicated code buys is that a checkout screen
 * can branch on it — a lost `If-Match` race and a withdrawn article are both
 * `resource.conflict` and want completely different screens.
 */
final class PlacementRefused extends ApiException
{
    /**
     * @param  list<array<string, mixed>>  $reasons
     */
    public function __construct(array $reasons)
    {
        parent::__construct(
            ErrorCode::OrderPlacementRefused,
            'This order cannot be placed as it stands.',
            ['reasons' => $reasons],
        );
    }
}
