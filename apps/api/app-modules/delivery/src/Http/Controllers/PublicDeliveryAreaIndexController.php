<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Controllers;

use Healthy360\Delivery\Presenters\DeliveryAreaPresenter;
use Healthy360\ReferenceData\Models\Country;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/reference/delivery-areas?country_code=LB — anonymous.
 *
 * The gazetteer a customer picks their neighbourhood from. Public for the
 * reason the allergen and diet lists are: an address form that only works
 * after sign-in cannot be part of sign-up, and J1's onboarding asks for an
 * area before an account exists.
 *
 * Served through the public projection: one server-localised `name` chosen
 * from `Accept-Language`, never both language columns. Inactive areas are
 * excluded — a place the platform has withdrawn must not be offered — while a
 * zone that already claims one keeps it and every historical reference still
 * resolves internally.
 *
 * **Cursor-paginated, unlike the other two public vocabularies.** Fourteen
 * allergen classes and twelve diet classifications are constants; the
 * gazetteer is 125 rows for one country today and grows with every market, so
 * this is the public list that will not stay small. It walks oldest-first over
 * `(created_at, id)` like every other cursor in this API — which, for a seeded
 * gazetteer, is insertion order and therefore source order.
 *
 * `country_code` is **required**. A default would serve Lebanon to a customer
 * in Dubai, and an unfiltered list would serve every market's places in one
 * response and make `code` look ambiguous when it is unique per country.
 * Rate limiting comes from the `api` group (60/min per IP for an anonymous
 * caller).
 */
final class PublicDeliveryAreaIndexController
{
    public function __construct(private readonly DeliveryAreaPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $countryCode = $this->countryCode($request);
        $locale = DeliveryAreaPresenter::locale($request->header('Accept-Language'));

        $query = DeliveryArea::query()
            ->where('country_code', $countryCode)
            ->where('is_active', true);

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request));

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (DeliveryArea $area): array => $this->presenter->publicProjection($area, $locale))->all(),
            $page['meta'] + ['locale' => $locale, 'country_code' => $countryCode],
        );
    }

    /**
     * @throws ApiException
     */
    private function countryCode(Request $request): string
    {
        $raw = $request->query('country_code');

        if (! is_string($raw) || trim($raw) === '') {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'A country_code is required — area codes are unique within a country, not across the platform.',
                ['parameter' => 'country_code'],
            );
        }

        $code = mb_strtoupper(trim($raw));

        // An unknown country is a 400 rather than an empty list: a client that
        // sent `country_code=UK` has a bug, and an empty page would look like
        // "we do not deliver there yet".
        if (! Country::query()->whereKey($code)->exists()) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'This is not a country the platform recognises. Use an ISO 3166-1 alpha-2 code.',
                ['parameter' => 'country_code'],
            );
        }

        return $code;
    }
}
