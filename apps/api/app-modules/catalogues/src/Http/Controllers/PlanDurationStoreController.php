<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Requests\StorePlanDurationRequest;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanVocabularyService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/plan-vocabulary/durations.
 *
 * The one endpoint where §4.3 is visible to a client: `duration_kind` decides
 * whether `duration_days` is required or refused, and a one-off carries no
 * number rather than a zero.
 */
final class PlanDurationStoreController
{
    public function __construct(
        private readonly PlanVocabularyService $vocabulary,
        private readonly PlanAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StorePlanDurationRequest $request): JsonResponse
    {
        /** @var array{code: string, duration_kind: string, duration_days?: int|null, name_en: string, name_ar?: string|null, display_order?: int|null} $attributes */
        $attributes = $request->validated();

        $row = $this->vocabulary->createDuration($attributes);

        return ApiResponse::data(['duration' => $this->presenter->duration($row)], status: 201);
    }
}
