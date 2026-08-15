<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The gate refused to activate a price list.
 *
 * `details.reasons` carries **every** blocker, not the first one found — the
 * rule K1.2 set for recipe versions and K1.4 repeated for catalogue items, and
 * for the same reason: a gate that reveals one problem per attempt turns a
 * five-minute fix into five round trips.
 *
 * Each reason is `{reason, …context}` — a stable machine key plus whatever
 * identifies the offending rows.
 *
 * The K1.5 vocabulary: `price_list_not_a_draft`, `no_open_rows`,
 * `amount_status_mismatch`. The last of those is structurally unreachable —
 * the `price_list_items` CHECK refuses the combination at the database — and
 * it is stated anyway, because the gate is the contract a client reads and
 * "the database would have stopped it" is not something a client can see.
 *
 * A pricing-local class rather than a reuse of the catalogues one, for the
 * reason `ReadsPrecondition` gives: the shared thing is the *error code*,
 * which lives in Support and both modules quote; a message and a reason
 * vocabulary are not shared, and importing forty lines across a module
 * boundary to avoid writing twelve buys a coupling rather than removes a
 * duplication.
 */
final class PublishBlocked extends ApiException
{
    /**
     * @param  list<array<string, mixed>>  $reasons
     */
    public function __construct(array $reasons)
    {
        parent::__construct(
            ErrorCode::CataloguePublishBlocked,
            'This price list is not ready to be activated.',
            ['reasons' => $reasons],
        );
    }
}
