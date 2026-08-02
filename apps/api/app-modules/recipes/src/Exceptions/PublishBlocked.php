<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The readiness evaluator refused a publication.
 *
 * `details.reasons` carries **every** blocker, not the first one found. A
 * gate that reveals one problem per attempt turns a five-minute fix into five
 * round trips, and the version being published is the one thing in this
 * domain a kitchen is most impatient about.
 *
 * Each reason is `{reason, …context}` — a stable machine key plus whatever
 * identifies the offending rows, so a client can highlight the exact lines
 * rather than printing a sentence.
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
            'This recipe version is not ready to be published.',
            ['reasons' => $reasons],
        );
    }
}
