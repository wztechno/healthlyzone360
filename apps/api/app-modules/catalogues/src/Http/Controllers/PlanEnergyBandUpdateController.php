<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Requests\UpdateEnergyBandRequest;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanLocator;
use Healthy360\Catalogues\Services\PlanVocabularyService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/plan-vocabulary/energy-bands/{band}.
 *
 * Precondition-free, and `code` refused rather than ignored — see the
 * combinations updater for both arguments.
 */
final class PlanEnergyBandUpdateController
{
    public function __construct(
        private readonly PlanLocator $locator,
        private readonly PlanVocabularyService $vocabulary,
        private readonly PlanAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateEnergyBandRequest $request, string $band): JsonResponse
    {
        if ($request->has('code')) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'A vocabulary code is fixed once created — a plan configuration is identified by it. Deactivate this one and create a replacement instead.',
                ['fields' => ['code' => ['A vocabulary code is fixed once created.']]],
            );
        }

        $row = $this->locator->energyBand($band);

        return ApiResponse::data([
            'energy_band' => $this->presenter->energyBand(
                $this->vocabulary->updateEnergyBand($row, $request->validated()),
            ),
        ]);
    }
}
