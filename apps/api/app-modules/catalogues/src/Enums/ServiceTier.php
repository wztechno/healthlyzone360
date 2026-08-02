<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * The service level of one plan configuration.
 *
 * Two values, because two is what the source data has and inventing a third
 * would be inventing a product. It is one of the four coordinates of a matrix
 * cell, so widening it later widens the uniqueness key rather than adding a
 * column — a deliberate, migration-shaped decision.
 */
enum ServiceTier: string
{
    case Standard = 'standard';
    case Premium = 'premium';
}
