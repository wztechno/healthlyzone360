<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use Illuminate\Support\Facades\DB;

final class IngredientMutationLock
{
    /** Must be called inside the transaction, before reading the protected state. */
    public static function acquire(string $ingredientId): void
    {
        DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['ingredient-allergens:'.$ingredientId]);
    }
}
