<?php

declare(strict_types=1);

namespace Healthy360\Allergens\Http\Controllers;

use Healthy360\Allergens\Http\Requests\StoreAllergenClassRequest;
use Healthy360\Allergens\Presenters\AllergenClassPresenter;
use Healthy360\Allergens\Services\AllergenClassService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/reference/allergen-classes — platform operators only.
 *
 * Adding a class is rare and consequential: every tenant inherits it, and the
 * code can never be taken back. Behind `platform.context` *and*
 * `reference.manage_platform` — the workspace and the grant are separate
 * questions and both must answer yes.
 */
final class AllergenClassStoreController
{
    public function __construct(
        private readonly AllergenClassService $classes,
        private readonly AllergenClassPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreAllergenClassRequest $request): JsonResponse
    {
        /** @var array{code: string, name_en: string, name_ar: string, description_en?: string|null, description_ar?: string|null, regulatory_ref: string, is_eu_14: bool, is_us_big_9: bool, us_declaration_required?: bool, us_threshold_ppm?: int|null, display_order?: int|null} $attributes */
        $attributes = $request->validated();

        $allergen = $this->classes->create($attributes);

        return ApiResponse::data(['allergen_class' => $this->presenter->admin($allergen)], status: 201);
    }
}
