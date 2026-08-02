<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Presenters\DietClassificationPresenter;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/reference/diet-classifications — anonymous.
 *
 * The vocabulary a customer needs to filter a menu by how they eat. Public
 * because a diet filter that only works after sign-in is not a diet filter —
 * the argument the public allergen-class list already makes, applied to the
 * softer of the two vocabularies.
 *
 * Served through the public projection (master plan v2 §4.8): one
 * server-localised `name` chosen from `Accept-Language`, never both columns.
 * Inactive classifications are excluded — one the platform has withdrawn must
 * not be offered — while every historical reference to its code still resolves
 * internally.
 *
 * Rate limiting comes from the `api` group (60/min per IP for an anonymous
 * caller); the list is small and constant, so no cursor is needed and none is
 * offered.
 */
final class PublicDietClassificationIndexController
{
    public function __construct(private readonly DietClassificationPresenter $presenter) {}

    public function __invoke(Request $request): JsonResponse
    {
        $locale = DietClassificationPresenter::locale($request->header('Accept-Language'));

        $classifications = DietClassification::query()
            ->where('is_active', true)
            ->orderBy('display_order')
            ->orderBy('code')
            ->get();

        return ApiResponse::data(
            $classifications->map(fn (DietClassification $row): array => $this->presenter->publicProjection($row, $locale))->all(),
            ['count' => $classifications->count(), 'locale' => $locale],
        );
    }
}
