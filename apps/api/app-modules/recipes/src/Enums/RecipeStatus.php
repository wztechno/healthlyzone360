<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Enums;

/**
 * The operational lifecycle of a recipe — the identity, not the version.
 *
 * Deliberately not the publication family: a recipe is never published, its
 * versions are (master plan v2 §4.7). There is no `inactive` here either,
 * because "temporarily not in use" is expressed by having no published
 * version, which is a fact the versions already carry.
 */
enum RecipeStatus: string
{
    case Active = 'active';
    case Archived = 'archived';
}
