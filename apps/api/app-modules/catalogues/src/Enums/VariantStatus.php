<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * The operational lifecycle of a variant.
 *
 * Not the sellable family, and the asymmetry with the parent item is
 * deliberate: **a pack is not separately published**. Publishing the 500 g jar
 * while the 1 kg jar sits in draft is not a state a kitchen wants, it is a
 * state a kitchen ends up in. Publication is a decision about the article; a
 * variant is a way of buying it.
 */
enum VariantStatus: string
{
    case Draft = 'draft';
    case Active = 'active';
    case Archived = 'archived';
}
