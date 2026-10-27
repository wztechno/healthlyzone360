<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Presenters\B2bAgreementPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/platform/b2b/applications/{application}/agreements — every
 * version, newest first, drafts included.
 *
 * Requires `b2b_application.view_platform`. The reviewer sees the drafts the
 * applicant does not, because writing them is the reviewer's job.
 */
final class PlatformB2bAgreementIndexController
{
    public function __construct(
        private readonly B2bLocator $locator,
        private readonly B2bAgreementPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $application): JsonResponse
    {
        $record = $this->locator->application($application);

        $agreements = B2bAgreement::query()
            ->where('b2b_application_id', $record->getKey())
            ->orderByDesc('version')
            ->get();

        return ApiResponse::data(
            $agreements->map(fn (B2bAgreement $agreement): array => $this->presenter->agreement($agreement))->all(),
            ['count' => $agreements->count()],
        );
    }
}
