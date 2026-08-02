<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Enums;

/**
 * The regulatory market a mapping applies in. EU-14 and US Big-9 are
 * different lists: coconut is a tree nut under US law and not an EU allergen,
 * so it is carried as a `us_only` mapping rather than as a note nobody reads.
 */
enum AllergenMarketScope: string
{
    case All = 'all';
    case UsOnly = 'us_only';
    case EuOnly = 'eu_only';
}
