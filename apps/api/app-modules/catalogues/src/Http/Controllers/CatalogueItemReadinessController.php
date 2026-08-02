<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Services\CatalogueItemReadiness;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/items/{item}/readiness — would publication succeed, and
 * if not, why.
 *
 * A read of the same gate `POST …/publish` enforces, and deliberately nothing
 * more: the evaluator behind both is one service, so an answer here that says
 * "publishable" is the answer the publish attempt will give a moment later
 * against the same rows. What it buys is a review queue that can show thirty
 * listings' readiness without publishing any of them, and a plan editor that
 * can show which cells of a price matrix are still empty while somebody is
 * filling them in.
 *
 * Behind `catalogue.view_organisation` rather than
 * `catalogue.publish_organisation`. Knowing what a listing is missing is the
 * merchandiser's business — they are the ones who fix it — while deciding to
 * publish is somebody else's. It follows that a caller who can read this may
 * learn that a plan is unpriced; that is a boolean about completeness and never
 * an amount, the same line the `ConfirmedPriceRegistry` port draws.
 *
 * `reasons` is empty exactly when `publishable` is true. Both are on the wire
 * because a client rendering a badge wants the boolean and a client rendering a
 * checklist wants the list, and deriving one from the other at every call site
 * is how the two drift apart in a UI.
 *
 * **`publishable: true` is not a promise about permission.** A subscription
 * plan additionally needs `plan.publish_organisation`, which is checked inside
 * the publish action where the item type is known. This endpoint answers "is
 * the data ready", not "may you"; conflating the two would make a merchandiser
 * without plan authority read "not ready" about a plan that is perfectly ready.
 */
final class CatalogueItemReadinessController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly CatalogueItemReadiness $readiness,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $item): JsonResponse
    {
        $record = $this->locator->item($item);
        $reasons = $this->readiness->reasons($record);

        return ApiResponse::data(
            [
                'publishable' => $reasons === [],
                'reasons' => array_map(
                    // The context is cast to an object so an empty one
                    // serialises as `{}` rather than `[]`. A field whose JSON
                    // type depends on whether it happens to be empty is a
                    // client bug waiting for the first reason that carries
                    // nothing.
                    static fn (array $reason): array => [
                        'code' => $reason['code'],
                        'detail' => $reason['detail'],
                        'context' => (object) $reason['context'],
                    ],
                    $reasons,
                ),
            ],
            [
                'slug' => $record->slug,
                'item_type' => $record->item_type->value,
                'status' => $record->status->value,
            ],
        );
    }
}
