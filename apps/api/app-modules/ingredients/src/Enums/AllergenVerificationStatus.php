<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Enums;

/**
 * How confident the mapping is.
 *
 * `RequiresSupplierConfirmation` is the state the seeded sulphite mappings
 * arrive in: the source workbook marks vinegars, dried fruit, pickles and
 * molasses "possible — verify per supplier", and a possibility recorded as a
 * certainty would be as wrong as one dropped.
 */
enum AllergenVerificationStatus: string
{
    case Verified = 'verified';
    case Unverified = 'unverified';
    case RequiresReview = 'requires_review';
    case RequiresSupplierConfirmation = 'requires_supplier_confirmation';
}
