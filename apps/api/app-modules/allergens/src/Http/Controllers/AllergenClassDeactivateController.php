<?php

declare(strict_types=1);

namespace Healthy360\Allergens\Http\Controllers;

use Healthy360\Allergens\Models\Allergen;
use Healthy360\Allergens\Presenters\AllergenClassPresenter;
use Healthy360\Allergens\Services\AllergenClassService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/reference/allergen-classes/{code}/deactivate.
 *
 * There is no DELETE on this resource and there never will be. Deactivation
 * withdraws a class from the public vocabulary while leaving every mapping,
 * every customer declaration and every frozen recipe label that references
 * the code still resolvable to a readable name. A delete would either orphan
 * those references or cascade through a food-safety record; neither is an
 * acceptable outcome of an administrative tidy-up.
 */
final class AllergenClassDeactivateController
{
    public function __construct(
        private readonly AllergenClassService $classes,
        private readonly AllergenClassPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $code): JsonResponse
    {
        $allergen = Allergen::query()->whereKey(strtolower($code))->first();

        if (! $allergen instanceof Allergen) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        if (! $allergen->is_active) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This allergen class is already inactive.',
                ['allergen_class' => $allergen->code],
            );
        }

        return ApiResponse::data([
            'allergen_class' => $this->presenter->admin($this->classes->deactivate($allergen)),
        ]);
    }
}
