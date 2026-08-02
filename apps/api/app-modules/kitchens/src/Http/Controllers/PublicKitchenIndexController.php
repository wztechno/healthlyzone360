<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Kitchens\Http\Concerns\ReadsMarketplaceFilters;
use Healthy360\Kitchens\Presenters\MarketplaceLocale;
use Healthy360\Kitchens\Services\MarketplaceKitchens;
use Healthy360\Kitchens\Services\MarketplaceProjector;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/marketplace/kitchens — anonymous.
 *
 * The discovery list: every active kitchen with at least one open branch,
 * cursor-paginated over `(created_at, id)` like every other collection in this
 * API.
 *
 * Anonymous by the same argument the public allergen and diet vocabularies
 * make: a marketplace a person has to sign in to browse is not a marketplace.
 * Rate limiting is the `api` group's — 60 a minute keyed by IP for an anonymous
 * caller.
 *
 * Served entirely through `MarketplaceKitchenPresenter`; nothing here reaches a
 * cost, a supplier, a formulation or an internal note, because the presenter
 * is handed rows that carry none.
 */
final class PublicKitchenIndexController
{
    use ReadsMarketplaceFilters;

    public function __construct(
        private readonly MarketplaceKitchens $kitchens,
        private readonly MarketplaceProjector $projector,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $locale = MarketplaceLocale::from($request->header('Accept-Language'));
        $query = $this->kitchens->visible();

        $term = $this->stringParameter($request, 'query');

        if ($term !== null) {
            $this->kitchens->whereNameMatches($query, $term);
        }

        $countryCode = $this->stringParameter($request, 'country_code', 2);

        if ($countryCode !== null) {
            $query->where('country_code', mb_strtoupper($countryCode));
        }

        $area = $this->stringParameter($request, 'area', 60);

        if ($area !== null) {
            $this->kitchens->whereDeliversToArea($query, $area, $countryCode === null ? null : mb_strtoupper($countryCode));
        }

        $channels = $this->listParameter($request, 'channels', 8);

        if ($channels !== null) {
            $this->kitchens->whereRunsChannelKind($query, $this->kindsFor($channels));
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request));

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (Organisation $kitchen): array => $this->projector->kitchen($kitchen, $locale))->all(),
            $page['meta'] + [
                'locale' => $locale,
                'unsupported_filters' => $this->unsupportedFilters($request),
            ],
        );
    }

    /**
     * The channel *kinds* behind the consumer switches a caller asked for.
     *
     * Three of the eight switches — `subscription`, `delivery`, `pickup` — have
     * no stored kind at all (`MarketplaceChannels` records why), so asking for
     * them yields no kinds and therefore no kitchens. That is the honest answer:
     * the platform cannot name a single kitchen that has declared any of them.
     *
     * @param  list<string>  $switches
     * @return list<string>
     */
    private function kindsFor(array $switches): array
    {
        $kinds = [];

        foreach ($switches as $switch) {
            $kind = match ($switch) {
                'b2c' => SalesChannelKind::B2cWeb,
                'b2b' => SalesChannelKind::B2b,
                'pos' => SalesChannelKind::Pos,
                'marketplace' => SalesChannelKind::Marketplace,
                'corporate' => SalesChannelKind::Corporate,
                default => null,
            };

            if ($kind !== null) {
                $kinds[$kind->value] = true;
            }
        }

        return array_keys($kinds);
    }
}
