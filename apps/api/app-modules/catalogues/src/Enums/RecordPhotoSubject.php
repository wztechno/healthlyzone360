<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * The records a kitchen can photograph (BUG-14). Products and meals are both catalogue items.
 */
enum RecordPhotoSubject: string
{
    case Ingredient = 'ingredient';

    case Recipe = 'recipe';

    case CatalogueItem = 'catalogue_item';
}
