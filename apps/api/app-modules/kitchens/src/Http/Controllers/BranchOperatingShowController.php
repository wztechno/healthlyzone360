<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Kitchens\Presenters\BranchOperatingPresenter;
use Healthy360\Kitchens\Services\BranchOperatingService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/kitchen/branch-operating — the current branch's week.
 *
 * The branch comes from `X-Branch-Id` through `branch.context`. That
 * middleware permits *no* branch, because an organisation-wide membership may
 * legitimately select none, so this endpoint refuses that case explicitly with
 * `400 context.branch_required` rather than guessing which location the caller
 * meant.
 *
 * **Unconfigured days are absent, not filled in.** A week with three rows
 * means four days nobody has decided about; inventing `is_open: false` for
 * them would tell a customer the branch is shut on Thursday when the truth is
 * that nobody has said. `meta.is_complete` is what a screen puts the "finish
 * setting this up" prompt behind.
 *
 * No `ETag`: these rows carry no `lock_version`. The week is replaced whole in
 * one transaction, so there is no half-week for a validator to protect.
 */
final class BranchOperatingShowController
{
    public function __construct(
        private readonly BranchOperatingService $operating,
        private readonly BranchOperatingPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(): JsonResponse
    {
        $week = $this->operating->week();

        return ApiResponse::data(
            array_map(fn (BranchOpeningHour $day): array => $this->presenter->day($day), $week),
            $this->presenter->meta($week),
        );
    }
}
