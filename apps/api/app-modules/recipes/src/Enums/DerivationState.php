<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Enums;

/**
 * Whether the frozen allergen label of a version still matches the ingredient
 * mappings it was computed from.
 *
 * A new version starts `Stale` — nothing has been derived for it yet, and
 * claiming `Current` for an empty label would be the most dangerous default
 * available. Publication computes the label and sets `Current`; a later change
 * to any mapping an ingredient of a published version carries sets `Stale`
 * again. `Failed` records that a recompute was attempted and could not
 * complete, which must never be indistinguishable from "not tried yet".
 */
enum DerivationState: string
{
    case Current = 'current';
    case Stale = 'stale';
    case Failed = 'failed';
}
