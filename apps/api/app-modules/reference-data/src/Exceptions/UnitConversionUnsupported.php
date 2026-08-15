<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Exceptions;

use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * Two units cannot be converted between, and the refusal is loud on purpose.
 *
 * This mirrors the "no conversion" refusals already in the costing layer
 * (`MixedCostCurrency`): there is no exchange rate between a mass and a volume
 * any more than between two currencies, and a system that silently returned a
 * number for `convert(1 kg → 1 l)` would be inventing a density nobody stated.
 *
 * Raised in two shapes, both carrying the two units and a stable `reason` so a
 * caller can tell them apart:
 *
 *  * `cross_dimension` — the units measure different things (a mass and a
 *    volume, a count and a length). This can never be made to work with data.
 *  * `dimension_not_convertible` — the units share a dimension the system has
 *    deliberately not given conversion factors (`count`, `serving`, `package`,
 *    `energy`, `length`). A bunch is not a can; kcal↔kJ is a real conversion
 *    this slice has not validated. The honest answer is a refusal, not a
 *    fabricated ratio.
 */
final class UnitConversionUnsupported extends ApiException
{
    public static function crossDimension(MeasurementUnit $from, MeasurementUnit $to): self
    {
        return new self(
            sprintf(
                'Cannot convert %s (%s) to %s (%s): this system converts only within a dimension.',
                $from->code,
                $from->dimension,
                $to->code,
                $to->dimension,
            ),
            [
                'reason' => 'cross_dimension',
                'from_code' => $from->code,
                'from_dimension' => $from->dimension,
                'to_code' => $to->code,
                'to_dimension' => $to->dimension,
            ],
        );
    }

    public static function withinNonConvertibleDimension(MeasurementUnit $from, MeasurementUnit $to): self
    {
        return new self(
            sprintf(
                'The %s dimension has no validated conversion factors, so %s does not convert to %s.',
                $from->dimension,
                $from->code,
                $to->code,
            ),
            [
                'reason' => 'dimension_not_convertible',
                'dimension' => $from->dimension,
                'from_code' => $from->code,
                'to_code' => $to->code,
            ],
        );
    }

    /**
     * @param  array<string, mixed>  $details
     */
    private function __construct(string $message, array $details)
    {
        parent::__construct(ErrorCode::UnitConversionUnsupported, $message, $details);
    }
}
