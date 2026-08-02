<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Enums;

/**
 * Whether an allergen is an ingredient of the ingredient, or a cross-contact
 * risk. The two are legally different statements and are never merged.
 */
enum AllergenContainment: string
{
    case Contains = 'contains';
    case MayContain = 'may_contain';

    /**
     * How strong a claim this containment makes. Used by the upgrade-only
     * rule: a tenant overlay may raise the strength of a platform baseline
     * row, never lower it.
     */
    public function strength(): int
    {
        return match ($this) {
            self::MayContain => 1,
            self::Contains => 2,
        };
    }
}
