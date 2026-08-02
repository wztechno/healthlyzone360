<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Enums;

/**
 * How complete a version's data is, which is not the same question as whether
 * it may be published.
 *
 * `Indicative` is a formulation without costs — the sauces-and-dressings
 * source lists typical ingredients and no amounts of money at all, and
 * recording that honestly beats inventing figures. `Costed` is a version whose
 * lines carry unit and line costs, which is what a technical sheet is.
 *
 * The distinction is stored rather than derived from "are the cost columns
 * populated" so that a partially costed import is not silently promoted by
 * the arrival of one price.
 */
enum RecipeCompleteness: string
{
    case Indicative = 'indicative';
    case Costed = 'costed';
}
