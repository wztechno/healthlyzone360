<?php

declare(strict_types=1);

namespace Healthy360\Cart\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A basket line was refused, with **every** reason it was refused for.
 *
 * The rule K1.2 set for publication gates, applied to the other end of the
 * platform: a refusal that reveals one problem per attempt turns one fix into
 * several round trips. An article that is retired *and* unpriced *and* not
 * offered on this channel says all three at once.
 *
 * Each reason is `{reason, …context}` — a stable machine key plus whatever
 * identifies the offending row — so a client can name the article rather than
 * printing a sentence about it. The vocabulary is `item_unknown`,
 * `item_not_published`, `variant_unknown`, `variant_not_active`,
 * `channel_not_trading`, `channel_unavailable`, `unpriced` and
 * `currency_mismatch`.
 *
 * Carried under `ErrorCode::ValidationFailed` because that is the honest
 * existing code for "the server will not accept this as sent", and because the
 * error vocabulary is owned by the integration wave: a dedicated
 * `cart.line_refused` may be introduced there without any call site here
 * changing, since every caller throws this class rather than choosing a code.
 */
final class LineRefused extends ApiException
{
    /**
     * @param  list<array<string, mixed>>  $reasons
     */
    public function __construct(array $reasons)
    {
        parent::__construct(
            ErrorCode::ValidationFailed,
            'This item cannot be added to the basket as asked for.',
            ['reasons' => $reasons],
        );
    }
}
