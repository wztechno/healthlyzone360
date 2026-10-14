<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Nutrition;

interface NutritionReferenceProvider
{
    /** @return list<array{food: array<string, mixed>, retrieved_at: string}> */
    public function search(string $query): array;

    /** @return array{food: array<string, mixed>, retrieved_at: string} */
    public function fetch(string $id, bool $fresh = false): array;
}
