<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Enums;

/**
 * Where a row of a frozen allergen label came from.
 *
 * `Derived` was computed from the effective ingredient mappings, and carries
 * the ingredient that caused it so "why does this say sesame" is answerable.
 * `Declared` is a human statement — a chef who knows the fryer is shared —
 * that no mapping implies.
 *
 * The distinction decides precedence: a derivation never overwrites a
 * declaration with a weaker containment, because the computation only knows
 * what it was told and the chef is standing in the kitchen.
 */
enum AllergenDerivation: string
{
    case Declared = 'declared';
    case Derived = 'derived';
}
