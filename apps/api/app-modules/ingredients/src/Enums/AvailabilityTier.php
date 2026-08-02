<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Enums;

/**
 * Local availability of an ingredient in the launch market, as recorded by
 * the source workbook: a Lebanese staple, a commonly stocked item, or
 * something that has to be imported.
 */
enum AvailabilityTier: string
{
    case Core = 'core';
    case Common = 'common';
    case SpecialtyImported = 'specialty_imported';
}
