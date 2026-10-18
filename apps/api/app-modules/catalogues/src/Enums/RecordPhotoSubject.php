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

    /**
     * Whether removing this record's photo also takes its stock picture off.
     *
     * Only an ingredient, the one record whose editor shows the stock picture in its photo slot and
     * reads `stock_photo_hidden` back. A recipe or a product still falls back to its stock picture,
     * as it always has.
     */
    public function removalHidesStockPicture(): bool
    {
        return $this === self::Ingredient;
    }
}
