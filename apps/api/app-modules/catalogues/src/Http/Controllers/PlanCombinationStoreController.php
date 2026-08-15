<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Requests\StoreMealCombinationOptionRequest;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanVocabularyService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/plan-vocabulary/combinations.
 *
 * A duplicate `code` within the organisation is `409`, not a silent update: the
 * caller believed it was creating something.
 */
final class PlanCombinationStoreController
{
    public function __construct(
        private readonly PlanVocabularyService $vocabulary,
        private readonly PlanAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreMealCombinationOptionRequest $request): JsonResponse
    {
        /** @var array{code: string, name_en: string, name_ar?: string|null, includes_breakfast?: bool|null, includes_lunch?: bool|null, includes_dinner?: bool|null, meals_per_day: int, display_order?: int|null} $attributes */
        $attributes = $request->validated();

        $row = $this->vocabulary->createCombination($attributes);

        return ApiResponse::data(['combination' => $this->presenter->combination($row)], status: 201);
    }
}
