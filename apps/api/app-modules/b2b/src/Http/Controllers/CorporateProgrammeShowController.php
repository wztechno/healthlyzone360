<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Presenters\CorporateProgrammePresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/b2b/programmes/{programme}.
 */
final class CorporateProgrammeShowController
{
    public function __construct(
        private readonly B2bLocator $locator,
        private readonly CorporateProgrammePresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $programme): JsonResponse
    {
        $record = $this->locator->programme($programme);

        return ApiResponse::data(['programme' => $this->presenter->programme($record)]);
    }
}
