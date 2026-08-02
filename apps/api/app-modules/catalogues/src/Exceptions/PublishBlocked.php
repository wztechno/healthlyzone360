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
 * `no_allergen_basis`, `linked_recipe_quarantined`. The full readiness
 * evaluator — confirmed prices, delivery availability, complete allergen
 * determination — is K1.8, and it will add reasons to this list rather than
 * replace the mechanism.
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
