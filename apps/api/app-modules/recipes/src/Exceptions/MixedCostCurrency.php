<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The costed lines of one version are denominated in more than one currency.
 *
 * There is no exchange rate anywhere in this system and there will not be one
 * here: master plan v2 §4.4 forbids cross-currency arithmetic outright, and a
 * total that quietly added dollars to pounds would be a number nobody could
 * ever reconcile. The refusal names every currency it found and every line
 * that carries a cost, so the fix is a two-minute edit rather than a hunt.
 *
 * The state is reachable only through the K1.8 importer, which stores what a
 * source sheet said rather than what this system would have accepted — the
 * lines endpoint rejects a second currency at write time. It is guarded here
 * anyway, because "unreachable" is a property of today's write paths and this
 * is a property of the arithmetic.
 */
final class MixedCostCurrency extends ApiException
{
    /**
     * @param  list<string>  $currencies
     * @param  list<int>  $lineNumbers
     */
    public function __construct(array $currencies, array $lineNumbers)
    {
        parent::__construct(
            ErrorCode::ValidationFailed,
            'The costed lines of this version are not all in one currency, and this system never converts between them.',
            ['currencies' => $currencies, 'line_numbers' => $lineNumbers],
        );
    }
}
