<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Requests\StoreEnergyBandRequest;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanVocabularyService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/plan-vocabulary/energy-bands.
 */
final class PlanEnergyBandStoreController
{
    public function __construct(
        private readonly PlanVocabularyService $vocabulary,
        private readonly PlanAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreEnergyBandRequest $request): JsonResponse
    {
        /** @var array{code: string, name_en: string, name_ar?: string|null, min_kcal: int, max_kcal: int, display_order?: int|null} $attributes */
        $attributes = $request->validated();

        $row = $this->vocabulary->createEnergyBand($attributes);

        return ApiResponse::data(['energy_band' => $this->presenter->energyBand($row)], status: 201);
    }
}
