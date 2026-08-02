<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Enums;

/**
 * The operational lifecycle of a tariff — deliberately **not** the sellable
 * family (`draft | review_required | published | retired`).
 *
 * A price list is not published content; it is the instrument that prices
 * content. Nothing a customer sees is a price list, so it has no review state
 * and no retirement: what a customer sees is a *price*, and whether one
 * reaches them is decided by the channel assignment and the public projection.
 */
enum PriceListStatus: string
{
    case Draft = 'draft';

    case Active = 'active';

    case Archived = 'archived';

    /**
     * Whether a list in this state may still be edited.
     *
     * An active list is editable — that is the point of effective-dating. A
     * kitchen changes a live price by superseding the standing row, not by
     * withdrawing its tariff from sale first.
     */
    public function isEditable(): bool
    {
        return $this !== self::Archived;
    }
}
