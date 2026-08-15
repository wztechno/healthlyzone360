<?php

declare(strict_types=1);

namespace Healthy360\Allergens\Http\Controllers;

use Healthy360\Allergens\Http\Requests\UpdateAllergenClassRequest;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Allergens\Presenters\AllergenClassPresenter;
use Healthy360\Allergens\Services\AllergenClassService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/reference/allergen-classes/{code} — platform operators only.
 *
 * Names, translations, descriptions, market applicability and thresholds are
 * all editable. The `code` is not, and the request refuses it explicitly
 * rather than dropping it (see `UpdateAllergenClassRequest`).
 *
 * Inactive classes are reachable here on purpose: an administrator has to be
 * able to correct a withdrawn class's Arabic name so old labels keep
 * rendering.
 */
final class AllergenClassUpdateController
{
    public function __construct(
        private readonly AllergenClassService $classes,
        private readonly AllergenClassPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateAllergenClassRequest $request, string $code): JsonResponse
    {
        $allergen = Allergen::query()->whereKey(strtolower($code))->first();

        if (! $allergen instanceof Allergen) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $updated = $this->classes->update($allergen, $request->validated());

        return ApiResponse::data(['allergen_class' => $this->presenter->admin($updated)]);
    }
}
