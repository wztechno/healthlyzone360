<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The readiness gate refused to publish a catalogue item.
 *
 * `details.reasons` carries **every** blocker, not the first one found — the
 * rule K1.2 set for recipe versions, and for the same reason: a gate that
 * reveals one problem per attempt turns a five-minute fix into five round
 * trips.
 *
 * Each reason is `{reason, …context}` — a stable machine key plus whatever
 * identifies the offending rows, so a client can highlight the exact field or
 * the exact recipe rather than printing a sentence.
 *
 * The K1.4 vocabulary is deliberately small: `item_quarantined`,
 * `item_not_a_draft`, `translation_incomplete`, `no_active_variant`,
 * `no_allergen_basis`, `linked_recipe_quarantined`. K1.6 adds four that apply
 * to subscription plans only — `plan_profile_missing`,
 * `no_active_plan_configuration`, `no_duration_assigned` and
 * `plan_prices_incomplete` — which is the mechanism working as designed: a
 * slice adds reasons rather than replacing the apparatus. The rest of the full
 * readiness evaluator (delivery availability, complete allergen determination
 * across every listed ingredient, translation coverage on every field) is K1.8.
 *
 * `plan_prices_incomplete` is the one that carries a list. It names every
 * active configuration nobody has confirmed a price for, by identifier *and* by
 * code, because the person reading the refusal is looking at a matrix labelled
 * by code and a list of UUIDs would send them back to the API to find out which
 * cells to price.
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
            'This catalogue item is not ready to be published.',
            ['reasons' => $reasons],
        );
    }
}
