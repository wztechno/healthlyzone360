<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Enums;

/**
 * How much the platform trusts what it holds about an ingredient.
 *
 * `RequiresReview` is not decoration: the seeded burghul and pita rows carry
 * it because the source workbook tags them "None" while its own allergen key
 * lists burghul and bread under Cereals/Gluten. A contradiction is recorded
 * as a contradiction, never silently resolved.
 */
enum IngredientVerificationStatus: string
{
    case Verified = 'verified';
    case Unverified = 'unverified';
    case RequiresReview = 'requires_review';
}
