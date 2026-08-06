<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\B2b\Presenters\CorporateProgrammePresenter;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/b2b/programmes — the corporate programmes the caller's active
 * organisation is the buyer on (B2).
 *
 * Every member of the organisation sees the same list — there is no
 * per-user grant (B7: org-shared server drafts) — so this reads exactly the
 * tenant-scoped table with no further narrowing.
 */
final class CorporateProgrammeIndexController
{
    public function __construct(private readonly CorporateProgrammePresenter $presenter) {}

    public function __invoke(): JsonResponse
    {
        $programmes = CorporateProgramme::query()->orderByDesc('created_at')->get();

        return ApiResponse::data(
            $programmes->map($this->presenter->programme(...))->all(),
            ['count' => $programmes->count()],
        );
    }
}
