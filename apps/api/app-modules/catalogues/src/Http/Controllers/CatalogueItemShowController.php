<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemDietClassification;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/items/{item}.
 *
 * Returns `ETag: "<lock_version>"` — the client's half of the
 * optimistic-concurrency contract: read the resource, keep the validator, send
 * it back as `If-Match` when writing.
 *
 * Everything hanging off the item comes with it. Opening a listing and
 * immediately asking "and what packs, ingredients, diets and channels does it
 * have" is one interaction, not five, and each set is bounded by what a human
 * typed into one form.
 *
 * Diet classifications are returned as **codes**, not identifiers, matching
 * what the setter accepts and what the admin contract carries — a round trip
 * that changed representation halfway would make the obvious client code
 * wrong.
 */
final class CatalogueItemShowController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $item): JsonResponse
    {
        $record = $this->locator->item($item);

        return ApiResponse::data([
            'item' => $this->presenter->item($record),
            'variants' => $this->variants($record),
            'ingredients' => $this->ingredients($record),
            'diet_classifications' => $this->dietClassifications($record),
            'channels' => $this->channels($record),
        ])->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function variants(CatalogueItem $item): array
    {
        $variants = CatalogueItemVariant::query()
            ->where('catalogue_item_id', $item->getKey())
            ->orderBy('code')
            ->get();

        $packs = CatalogueItemPackVariant::query()
            ->whereIn('catalogue_item_variant_id', $variants->modelKeys())
            ->get()
            ->keyBy('catalogue_item_variant_id');

        return array_values($variants->map(fn (CatalogueItemVariant $variant): array => $this->presenter->variant(
            $variant,
            $packs->get((string) $variant->getKey()),
        ))->all());
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function ingredients(CatalogueItem $item): array
    {
        return array_values(CatalogueItemIngredient::query()
            ->where('catalogue_item_id', $item->getKey())
            ->orderBy('display_order')
            ->get()
            ->map(fn (CatalogueItemIngredient $row): array => $this->presenter->ingredient($row))
            ->all());
    }

    /**
     * @return list<string>
     */
    private function dietClassifications(CatalogueItem $item): array
    {
        return array_values(DietClassification::query()
            ->whereIn('id', CatalogueItemDietClassification::query()
                ->where('catalogue_item_id', $item->getKey())
                ->select('diet_classification_id'))
            ->orderBy('display_order')
            ->orderBy('code')
            ->pluck('code')
            ->all());
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function channels(CatalogueItem $item): array
    {
        return array_values(ChannelCatalogueItem::query()
            ->where('catalogue_item_id', $item->getKey())
            ->orderBy('sales_channel_id')
            ->get()
            ->map(fn (ChannelCatalogueItem $row): array => $this->presenter->channelAssignment($row))
            ->all());
    }
}
