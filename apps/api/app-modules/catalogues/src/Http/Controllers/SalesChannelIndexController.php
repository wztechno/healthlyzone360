<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/sales-channels.
 *
 * Unpaginated, like the ingredient-category list and for the same reason: a
 * kitchen has a handful of routes to market, not a catalogue of them, and a
 * cursor over five rows is ceremony. Inactive channels are included — a
 * merchandiser assigning availability needs to see that the wholesale desk
 * exists and is switched off.
 */
final class SalesChannelIndexController
{
    public function __construct(private readonly CatalogueItemAdminPresenter $presenter) {}

    public function __invoke(): JsonResponse
    {
        $channels = SalesChannel::query()
            ->orderBy('channel_kind')
            ->orderBy('code')
            ->get();

        return ApiResponse::data(
            $channels->map(fn (SalesChannel $channel): array => $this->presenter->salesChannel($channel))->all(),
            ['count' => $channels->count()],
        );
    }
}
