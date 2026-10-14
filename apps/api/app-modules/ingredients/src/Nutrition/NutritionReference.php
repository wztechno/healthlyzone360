<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Nutrition;

final readonly class NutritionReference
{
    /** @param array<string, mixed> $candidate
     * @param  array<string, mixed>  $snapshot
     */
    public function __construct(public array $candidate, public array $snapshot) {}

    /** @return array<string, mixed> */
    public function provenance(?string $reviewer): array
    {
        return [
            'ref' => $this->candidate['ref'], 'provider' => 'usda', 'match_kind' => 'representative',
            'data_type' => $this->candidate['data_type'], 'description' => $this->candidate['label'],
            'brand' => $this->candidate['brand'], 'basis' => 'per_100g',
            'retrieved_at' => $this->candidate['retrieved_at'],
            'source_revision' => $this->snapshot['publicationDate'] ?? null,
            'source_hash' => $this->candidate['source_hash'], 'mapping_version' => NutritionReferenceService::MAPPING_VERSION,
            'preparation_confirmed_at' => now()->toIso8601String(), 'preparation_confirmed_by' => $reviewer,
            'source_snapshot' => $this->snapshot,
        ];
    }
}
