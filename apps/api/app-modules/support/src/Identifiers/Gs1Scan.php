<?php

declare(strict_types=1);

namespace Healthy360\Support\Identifiers;

use Carbon\CarbonImmutable;

/**
 * What one scan said, once {@see Gs1::parse()} has read it.
 *
 * `boundaryVerified` is false when a variable-length field was read to the end
 * of a raw scan that carried no separator: GS1's literal reading, which a lost
 * separator would also produce. A screen asks a person to check the lot before
 * it trusts one.
 */
final readonly class Gs1Scan
{
    /**
     * @param  ?string  $gtin  fourteen digits, left-zero-padded, or null when the scan carries none
     * @param  array<int|string, string>  $elements  AI => value, as read (PHP keeps `10` as an int key, `01` as a string)
     */
    public function __construct(
        public ?string $gtin,
        public array $elements,
        public bool $boundaryVerified,
    ) {}

    /** AI (10). */
    public function lot(): ?string
    {
        return $this->elements['10'] ?? null;
    }

    /** AI (17). */
    public function expiresOn(): ?CarbonImmutable
    {
        return isset($this->elements['17']) ? Gs1::date($this->elements['17']) : null;
    }

    /** AI (15). */
    public function bestBeforeOn(): ?CarbonImmutable
    {
        return isset($this->elements['15']) ? Gs1::date($this->elements['15']) : null;
    }
}
