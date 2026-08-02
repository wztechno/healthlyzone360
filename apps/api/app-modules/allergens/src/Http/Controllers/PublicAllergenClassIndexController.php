<?php

declare(strict_types=1);

namespace Healthy360\Allergens\Http\Controllers;

use Healthy360\Allergens\Models\Allergen;
use Healthy360\Allergens\Presenters\AllergenClassPresenter;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/reference/allergen-classes — anonymous.
 *
 * The regulatory vocabulary a customer needs to declare an allergy and read a
 * label. It is public because it has to be: an allergy filter that only works
 * after sign-in is not an allergy filter.
 *
 * Served through the public projection (master plan v2 §4.8): one
 * server-localised `name` chosen from `Accept-Language`, never both columns.
 * Inactive classes are excluded — a class the platform has withdrawn must not
 * be offered to a customer, while every historical reference to its code
 * still resolves internally.
 *
 * Rate limiting comes from the `api` group (60/min per IP for an anonymous
 * caller); the list is small and constant, so no cursor is needed and none is
 * offered.
 */
final class PublicAllergenClassIndexController
{
    public function __construct(private readonly AllergenClassPresenter $presenter) {}

    public function __invoke(Request $request): JsonResponse
    {
        $locale = AllergenClassPresenter::locale($request->header('Accept-Language'));

        $classes = Allergen::query()
            ->where('is_active', true)
            ->orderBy('display_order')
            ->orderBy('code')
            ->get();

        return ApiResponse::data(
            $classes->map(fn (Allergen $allergen): array => $this->presenter->publicProjection($allergen, $locale))->all(),
            ['count' => $classes->count(), 'locale' => $locale],
        );
    }
}
