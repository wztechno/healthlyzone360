<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Enums;

/**
 * The publication lifecycle of a recipe version (master plan v2 §4.7).
 *
 * `ReviewRequired` is a **stored** state, not a flag beside one: a critical
 * allergen contradiction has to block publication structurally, and a boolean
 * next to a status is something a publish path can forget to read. It is
 * still editable — the point of quarantine is that somebody fixes it — but it
 * is as unpublishable as a draft.
 *
 * "Publishable" is never stored. It is the readiness evaluator's verdict,
 * computed at the moment of publication from the lines, the ingredients and
 * their allergen determinations.
 */
enum RecipeVersionStatus: string
{
    case Draft = 'draft';
    case ReviewRequired = 'review_required';
    case Published = 'published';
    case Retired = 'retired';

    /**
     * Whether the version's content may still be changed. Published and
     * retired versions are frozen: a label a customer has already been shown
     * must stay reconstructable, so a change is a new draft version rather
     * than an edit in place.
     */
    public function isEditable(): bool
    {
        return $this === self::Draft || $this === self::ReviewRequired;
    }
}
