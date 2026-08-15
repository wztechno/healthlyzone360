<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\Kitchens\Presenters\MarketplaceLocale;
use Healthy360\Kitchens\Services\MarketplaceKitchens;
use Healthy360\Kitchens\Services\MarketplaceProjector;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/marketplace/kitchens/{kitchen} — anonymous.
 *
 * One kitchen, with its branches, their delivery zones and their operating
 * weeks.
 *
 * A kitchen that is suspended, has no active branch, or is not a kitchen at all
 * answers `404 resource.not_found` — the same answer an identifier that never
 * existed gets. The alternative, a `403` or a "temporarily unavailable" body,
 * would tell an anonymous caller which organisations exist and what the
 * platform has done to them, which is nobody's business but the tenant's.
 */
final class PublicKitchenShowController
{
    public function __construct(
        private readonly MarketplaceKitchens $kitchens,
        private readonly MarketplaceProjector $projector,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $kitchen): JsonResponse
    {
        $locale = MarketplaceLocale::from($request->header('Accept-Language'));

        // Either the identifier or the slug: a client that walked the list holds
        // one, and a human reading a link holds the other. The same convention
        // the kitchen-admin surfaces already use for `{item}` and `{channel}`.
        $found = $this->kitchens->visible()
            ->where(fn ($query) => $query->where('slug', $kitchen)->when(
                preg_match('/^[0-9a-f-]{36}$/i', $kitchen) === 1,
                fn ($scoped) => $scoped->orWhere('id', $kitchen),
            ))
            ->first();

        if (! $found instanceof Organisation) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'No kitchen with that identifier is open on the marketplace.');
        }

        return ApiResponse::data(
            $this->projector->kitchen($found, $locale),
            ['locale' => $locale],
        );
    }
}
