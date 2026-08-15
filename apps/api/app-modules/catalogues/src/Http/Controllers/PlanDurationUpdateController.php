<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Requests\UpdatePlanDurationRequest;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanLocator;
use Healthy360\Catalogues\Services\PlanVocabularyService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/plan-vocabulary/durations/{duration}.
 *
 * Precondition-free, and `code` refused rather than ignored — see the
 * combinations updater.
 *
 * Flipping `duration_kind` to `one_off` without clearing `duration_days` is a
 * `422` rather than a silent NULLing, and so is the reverse: the two columns
 * are one fact, and a client that changed half of it has stated a
 * contradiction.
 */
final class PlanDurationUpdateController
{
    public function __construct(
        private readonly PlanLocator $locator,
        private readonly PlanVocabularyService $vocabulary,
        private readonly PlanAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdatePlanDurationRequest $request, string $duration): JsonResponse
    {
        if ($request->has('code')) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'A vocabulary code is fixed once created — a plan configuration is identified by it. Deactivate this one and create a replacement instead.',
                ['fields' => ['code' => ['A vocabulary code is fixed once created.']]],
            );
        }

        $row = $this->locator->duration($duration);

        return ApiResponse::data([
            'duration' => $this->presenter->duration(
                $this->vocabulary->updateDuration($row, $request->validated()),
            ),
        ]);
    }
}
