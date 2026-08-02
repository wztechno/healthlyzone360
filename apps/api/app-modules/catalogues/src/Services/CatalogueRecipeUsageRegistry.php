<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * The catalogues module's answer to "what else is selling this recipe" — and,
 * since K1.8, the hand that takes those listings off sale when the recipe's
 * allergen label moves underneath them.
 *
 * Bound by `CataloguesServiceProvider`, replacing the recipes module's null
 * implementation. The direction of the dependency is the point: recipes ask,
 * catalogues answer, and the module graph stays Catalogues → Recipes with no
 * cycle. That the second question *writes* does not change the direction —
 * the recipes module still says only "this label changed", and what a listing
 * does about it is a catalogue decision made here.
 *
 * **Published items only**, in both answers. A draft item pointing at a recipe
 * is somebody working on next month's menu; blocking a retirement on it would
 * make drafting a future dish an obstacle to withdrawing a current one, and
 * quarantining it would fill the review queue with work nobody needs to do
 * before service. Only a live listing has a customer behind it, and only a live
 * listing is showing a label derived from the version in question.
 */
final readonly class CatalogueRecipeUsageRegistry implements RecipeUsageRegistry
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * @return list<string>
     */
    public function publishedItemIds(Recipe $recipe): array
    {
        if (! $this->context->hasOrganisation()) {
            return [];
        }

        return array_values(CatalogueItem::query()
            ->where('recipe_id', $recipe->getKey())
            ->where('status', CatalogueItemStatus::Published->value)
            ->orderBy('slug')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all());
    }

    /**
     * Take every live listing of this recipe off sale, because the label
     * underneath it moved (K1.8).
     *
     * Published only, and for the same reason `publishedItemIds()` is: a draft
     * listing is not in front of anybody, and quarantining it would fill the
     * review queue with work nobody needs to do before service. The retired
     * ones are history and stay history.
     *
     * **`lock_version` deliberately does not move.** The gate this quarantine
     * arms is structural — `PublishCatalogueItem` refuses a `review_required`
     * item whatever validator the caller holds — so bumping the validator would
     * buy no safety and would turn every open editor's next save into a
     * spurious `409` for a change they did not make and cannot see.
     *
     * One audit event per item rather than one for the batch: the review queue
     * is worked item by item, and "why is this listing off sale" has to be
     * answerable from that listing's own trail.
     *
     * @return list<string>
     */
    public function quarantinePublishedItems(Recipe $recipe, string $reason): array
    {
        if (! $this->context->hasOrganisation()) {
            return [];
        }

        $items = CatalogueItem::query()
            ->where('recipe_id', $recipe->getKey())
            ->where('status', CatalogueItemStatus::Published->value)
            ->orderBy('slug')
            ->get();

        if ($items->isEmpty()) {
            return [];
        }

        DB::transaction(function () use ($items, $reason): void {
            foreach ($items as $item) {
                CatalogueItem::withoutTenancy()
                    ->whereKey($item->getKey())
                    ->update([
                        'status' => CatalogueItemStatus::ReviewRequired->value,
                        'review_reason' => $reason,
                        'updated_at' => now(),
                    ]);
            }
        });

        foreach ($items as $item) {
            $this->audit->record(
                'catalogue.item_quarantined',
                actorUserId: $this->context->userId(),
                subjectType: 'catalogue_item',
                subjectId: (string) $item->getKey(),
                metadata: [
                    'slug' => $item->slug,
                    'recipe_id' => (string) $recipe->getKey(),
                    'previous_status' => CatalogueItemStatus::Published->value,
                    'origin' => 'allergen_rollup_changed',
                    'review_reason' => $reason,
                ],
            );
        }

        return array_values($items->map(static fn (CatalogueItem $item): string => (string) $item->getKey())->all());
    }
}
