<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\Kitchens\Http\Requests\ReplaceBranchOperatingRequest;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Kitchens\Presenters\BranchOperatingPresenter;
use Healthy360\Kitchens\Services\BranchOperatingService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/kitchen/branch-operating — set-replace of the current branch's
 * week.
 *
 * The week is the unit of change: "we now close at six, and Sundays are off"
 * is one decision, and applying half of it produces a schedule nobody agreed
 * to. The replacement runs in one transaction, which is also why these rows
 * need no `If-Match` — there is no half-week for a validator to protect.
 *
 * A **closed day is a row** with no times; an omitted weekday is a day nobody
 * has decided about. Both are storable, and only that distinction lets a
 * checkout say "we are shut on Sundays" rather than "we cannot answer".
 *
 * The three table CHECKs are restated as per-row messages naming the day and
 * the field, because a constraint violation tells an operator which index
 * failed and this tells them which Tuesday is wrong.
 */
final class BranchOperatingReplaceController
{
    public function __construct(
        private readonly BranchOperatingService $operating,
        private readonly BranchOperatingPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceBranchOperatingRequest $request): JsonResponse
    {
        $week = $this->operating->replace($request->days());

        return ApiResponse::data(
            array_map(fn (BranchOpeningHour $day): array => $this->presenter->day($day), $week),
            $this->presenter->meta($week),
        );
    }
}
