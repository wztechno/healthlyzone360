<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Http\Requests\ReplaceCatalogueItemVariantsRequest;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Catalogues\Services\VariantService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/items/{item}/variants.
 *
 * A PUT because the body is the complete set of packs or configurations. The
 * admin contract offers the same decision two ways — a dedicated setter for
 * plans, an embedded array for products — and this mirrors the setter, because
 * the embedded form makes "I did not touch the packs" and "I deleted every
 * pack" the same request.
 *
 * `If-Match` carries the **item's** `lock_version`, not a variant's: the set
 * is the unit of change, and the replacement bumps the item so a concurrent
 * editor's next write is refused rather than silently overwriting this one.
 *
 * The response carries every variant including the ones this call archived, so
 * a client sees what the submission did rather than what it sent.
 */
final class CatalogueItemVariantReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly VariantService $variants,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceCatalogueItemVariantsRequest $request, string $item): JsonResponse
    {
        $record = $this->locator->item($item);
        $updated = $this->variants->replace($record, $request->variants(), $this->requiredLockVersion($request));

        $variants = CatalogueItemVariant::query()
            ->where('catalogue_item_id', $updated->getKey())
            ->orderBy('code')
            ->get();

        $packs = CatalogueItemPackVariant::query()
            ->whereIn('catalogue_item_variant_id', $variants->modelKeys())
            ->get()
            ->keyBy('catalogue_item_variant_id');

        return ApiResponse::data([
            'item' => $this->presenter->item($updated),
            'variants' => $variants->map(fn (CatalogueItemVariant $variant): array => $this->presenter->variant(
                $variant,
                $packs->get((string) $variant->getKey()),
            ))->all(),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
