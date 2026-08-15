<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Enums;

/**
 * The operational lifecycle of an ingredient row. Deliberately the
 * `active | inactive | archived` family rather than the publication family
 * (`draft | review_required | published | retired`): an ingredient is never
 * sold, so it has no publication state of its own (master plan v2 §4.7).
 */
enum IngredientStatus: string
{
    case Active = 'active';
    case Inactive = 'inactive';
    case Archived = 'archived';
}
