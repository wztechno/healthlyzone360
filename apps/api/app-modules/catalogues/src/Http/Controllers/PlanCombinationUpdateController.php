<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Requests\UpdateMealCombinationOptionRequest;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanLocator;
use Healthy360\Catalogues\Services\PlanVocabularyService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/plan-vocabulary/combinations/{combination}.
 *
 * **No `If-Match`.** Vocabulary rows carry no `lock_version` (appendix D), and
 * the concurrency contract applies only to resources that do
 * (`docs/api/conventions.md`): sending a validator a resource cannot honour
 * would be worse than sending none.
 *
 * `code` is **refused, not ignored**. A code is what a plan configuration's
 * identifier is derived from, so moving it would rename variants that a price
 * already points at — and a client that sent one believed it was writing
 * something.
 */
final class PlanCombinationUpdateController
{
    public function __construct(
        private readonly PlanLocator $locator,
        private readonly PlanVocabularyService $vocabulary,
        private readonly PlanAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateMealCombinationOptionRequest $request, string $combination): JsonResponse
    {
        if ($request->has('code')) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'A vocabulary code is fixed once created — a plan configuration is identified by it. Deactivate this one and create a replacement instead.',
                ['fields' => ['code' => ['A vocabulary code is fixed once created.']]],
            );
        }

        $row = $this->locator->combination($combination);

        return ApiResponse::data([
            'combination' => $this->presenter->combination(
                $this->vocabulary->updateCombination($row, $request->validated()),
            ),
        ]);
    }
}
