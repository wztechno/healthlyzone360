<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Allergens;

use RuntimeException;

final class LookupFailure extends RuntimeException
{
    public function __construct(public readonly string $reason = 'unavailable')
    {
        parent::__construct('Allergen lookup '.$reason.'.');
    }
}
