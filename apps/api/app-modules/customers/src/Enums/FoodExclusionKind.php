<?php

declare(strict_types=1);

namespace Healthy360\Customers\Enums;

/**
 * Whether an exclusion may ever be overridden.
 *
 * A substitution engine (S1) may swap a disliked ingredient for something the
 * customer will accept; it may never swap around a `forbidden` one, because a
 * prohibition is usually religious or ethical and "we substituted it for you"
 * is not a resolution. Allergies are not in this vocabulary at all — they have
 * their own table and their own severity — so a query that forgot the
 * discriminator cannot silently treat an allergy as a preference.
 */
enum FoodExclusionKind: string
{
    case Dislike = 'dislike';

    case Forbidden = 'forbidden';

    public function isOverridable(): bool
    {
        return $this === self::Dislike;
    }
}
