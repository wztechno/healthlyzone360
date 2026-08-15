<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Enums;

/**
 * How guarded a formulation is. `Confidential` is the default because a
 * recipe is a kitchen's commercial secret until somebody decides otherwise,
 * and a default that leaks is a default that is wrong exactly once.
 *
 * Neither value makes a formulation public. `Internal` means "shareable
 * inside the organisation"; the public projection denylist (master plan v2
 * §4.8) excludes recipe lines from every anonymous surface regardless.
 */
enum RecipeConfidentiality: string
{
    case Internal = 'internal';
    case Confidential = 'confidential';
}
