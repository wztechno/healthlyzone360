<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Services;

use Healthy360\ReferenceData\Exceptions\UnitConversionUnsupported;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use RuntimeException;

/**
 * Convert a quantity from one measurement unit to another, within a dimension.
 *
 * Three rules, the same three the recipe costing layer runs on.
 *
 * 1. **bcmath, never floats.** A quantity that changes when it is divided and
 *    multiplied back is not a quantity. Every figure is a decimal string;
 *    intermediate arithmetic runs at twelve places and is rounded half away
 *    from zero to six exactly once, at the end. Binary floating point cannot
 *    represent `0.1`, and a stock deduction that lost a millionth per hop would
 *    drift a real balance over a real month.
 * 2. **Within a dimension only.** Conversion is `quantity × from.base_ratio ÷
 *    to.base_ratio`, where `base_ratio` is the factor to the dimension's
 *    canonical base (mass = gram, volume = millilitre). Two units of different
 *    dimensions have no ratio between them and the service refuses — there is
 *    no density here to turn a litre into a kilogram, exactly as there is no
 *    exchange rate to turn a dollar into a pound.
 * 3. **Only the dimensions with validated factors convert.** `count`,
 *    `serving`, `package`, `energy` and `length` all carry `base_ratio` 1, and
 *    the service refuses to convert *between different units* inside them: a
 *    bunch is not a can, and kcal↔kJ is a real conversion this slice has not
 *    validated. Converting a unit to *itself* always succeeds, whatever its
 *    dimension — it is the identity, and it needs no factor.
 */
final class UnitConversionService
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    /**
     * The dimensions whose `base_ratio` values are real conversion factors.
     * Everything else carries an identity 1 that must never be divided across
     * two different units (INV1.0).
     *
     * @var list<string>
     */
    private const array CONVERTIBLE_DIMENSIONS = ['mass', 'volume'];

    /**
     * @param  numeric-string  $quantity
     * @return numeric-string
     *
     * @throws UnitConversionUnsupported when the two units cannot be converted between
     */
    public function convert(string $quantity, MeasurementUnit $from, MeasurementUnit $to): string
    {
        $qty = $this->numeric($quantity);

        // The identity is always legal, in any dimension: converting kilograms
        // to kilograms, or pieces to pieces, needs no factor and refuses
        // nobody.
        if ($from->getKey() === $to->getKey()) {
            return $this->round($qty);
        }

        if ($from->dimension !== $to->dimension) {
            throw UnitConversionUnsupported::crossDimension($from, $to);
        }

        if (! in_array($from->dimension, self::CONVERTIBLE_DIMENSIONS, true)) {
            throw UnitConversionUnsupported::withinNonConvertibleDimension($from, $to);
        }

        $inBase = bcmul($qty, $this->numeric((string) $from->base_ratio), self::WORKING_SCALE);
        $converted = bcdiv($inBase, $this->numeric((string) $to->base_ratio), self::WORKING_SCALE);

        return $this->round($converted);
    }

    /**
     * Whether two units can be converted between at all — the identity, or a
     * pair sharing a convertible dimension. Lets a caller branch before
     * committing to a movement rather than catching the refusal.
     */
    public function canConvert(MeasurementUnit $from, MeasurementUnit $to): bool
    {
        if ($from->getKey() === $to->getKey()) {
            return true;
        }

        return $from->dimension === $to->dimension
            && in_array($from->dimension, self::CONVERTIBLE_DIMENSIONS, true);
    }

    /**
     * Round half away from zero to the six places the stock and cost columns
     * store. Copied deliberately from `RecipeCostingService`: bcmath truncates,
     * which would bias every conversion downwards, and one rounding rule across
     * the money-and-stock arithmetic is one fewer place for two answers to
     * disagree.
     *
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function round(string $value): string
    {
        $half = '0.'.str_repeat('0', self::SCALE).'5';
        $negative = str_starts_with($value, '-');

        return bcadd($value, $negative ? '-'.$half : $half, self::SCALE);
    }

    /**
     * bcmath handed a non-numeric string returns zero rather than erroring, so
     * a malformed factor would silently make a conversion free. This is the
     * guard that turns that into a loud failure instead.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Unit conversion received a non-numeric value [{$value}].");
        }

        return $value;
    }
}
