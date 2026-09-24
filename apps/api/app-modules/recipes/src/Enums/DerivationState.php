<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Enums;

/**
 * Whether the frozen allergen label of a version still matches the ingredient
 * mappings it was computed from.
 *
 * The empty version 1 that `RecipeService::create()` writes with a new recipe
 * starts `Current`: it has no lines, so there is nothing to derive and the
 * empty label it carries is the true one. The first content write marks it
 * `Stale` in the same transaction, and a version with no lines cannot be
 * published (`no_lines`), so an underived label never reaches a customer.
 *
 * Every other new version starts `Stale` — a later draft, blank or copied, and
 * a version an importer writes with its lines already in it. Nothing has been
 * derived for what those hold, and claiming `Current` for a label nobody
 * computed would be the most dangerous default available. Publication computes
 * the label and sets `Current`; a later change to any mapping an ingredient of
 * a published version carries sets `Stale` again. `Failed` records that a
 * recompute was attempted and could not complete, which must never be
 * indistinguishable from "not tried yet".
 */
enum DerivationState: string
{
    case Current = 'current';
    case Stale = 'stale';
    case Failed = 'failed';
}
