<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * The publication lifecycle of a sellable catalogue item (master plan v2
 * §4.7) — the **same** four-state family `recipe_versions` carries, and
 * deliberately not the `active | archived` pair the operational tables in
 * this module use.
 *
 * A catalogue item is something a customer can be shown, so it publishes, it
 * quarantines and it retires. `ReviewRequired` is a stored quarantine rather
 * than a flag beside a status: a critical allergen contradiction must make
 * publication structurally impossible, not decorate the row with a boolean a
 * publish path can forget to read.
 *
 * **Retire, never archive.** Withdrawing a sellable item is a decision about
 * what the kitchen sells, with its own action, its own permission and its own
 * audit event. `archived` exists on catalogues, variants and channels — the
 * folders and the plumbing — and is not available here, so nobody can pull a
 * live item through a route that never mentions publication.
 */
enum CatalogueItemStatus: string
{
    case Draft = 'draft';
    case ReviewRequired = 'review_required';
    case Published = 'published';
    case Retired = 'retired';

    /**
     * Whether the item's content may still be changed.
     *
     * Unlike a recipe version, a **published** item stays editable. The two
     * are different objects: a version is a frozen formulation whose label a
     * customer has already been shown, so a change is a new version; an item
     * is a listing, and fixing a typo in a live product description must not
     * require withdrawing it from sale. Retirement is what freezes an item,
     * and it is terminal.
     */
    public function isEditable(): bool
    {
        return $this !== self::Retired;
    }

    /** Whether a consumer surface may read this item at all (plan §4.8). */
    public function isConsumerVisible(): bool
    {
        return $this === self::Published;
    }
}
