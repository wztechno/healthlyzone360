<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\PlanMenuEntry;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PlanMenuEntry>
 */
class PlanMenuEntryFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'catalogue_item_id' => CatalogueItem::factory()->subscriptionPlan(),
            'organisation_id' => fn (array $attributes): ?string => CatalogueItem::withoutTenancy()
                ->whereKey($attributes['catalogue_item_id'] ?? null)
                ->value('organisation_id'),

            // The dish defaults to a **published meal in the plan's own
            // catalogue** — the only shape the service accepts. A bare
            // `CatalogueItem::factory()->meal()` would invent a catalogue and
            // therefore an organisation of its own, and every fixture built on
            // it would be a cross-kitchen menu entry that the API refuses:
            // exactly the state a forecast suite would then be quietly
            // measuring.
            'meal_catalogue_item_id' => fn (array $attributes): string => (string) CatalogueItem::factory()
                ->meal()
                ->published()
                ->create([
                    'catalogue_id' => CatalogueItem::withoutTenancy()
                        ->whereKey($attributes['catalogue_item_id'] ?? null)
                        ->value('catalogue_id'),
                    'organisation_id' => $attributes['organisation_id'] ?? null,
                ])
                ->getKey(),
            'cycle_day' => 1,
            'slot' => 'lunch',
            'sequence' => 1,
            'created_by' => null,
        ];
    }

    public function on(int $cycleDay, string $slot = 'lunch', int $sequence = 1): static
    {
        return $this->state(fn (array $attributes): array => [
            'cycle_day' => $cycleDay,
            'slot' => $slot,
            'sequence' => $sequence,
        ]);
    }
}
