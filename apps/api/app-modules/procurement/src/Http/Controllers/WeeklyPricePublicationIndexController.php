<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Presenters\WeeklyPricePresenter;
use Healthy360\Procurement\Services\WeeklyPriceQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /catalogue/procurement/weekly-prices/publications — the publishing run
 * history (PROD1).
 *
 * The job runs hourly and catches up every completed-but-unpublished week
 * oldest-first, so after an outage a manager's first question is "did the weeks
 * I missed get published, and what did they find". This answers it: a row per
 * week with the four counts (computed, carried, unpriced, late lines) and the
 * publication it superseded, if it was a recompute.
 *
 * `has_late_receipts` is the one worth reading twice. A published row is never
 * rewritten — the table is append-only — so a receipt priced after the week
 * closed cannot move that week's average. The flag says the basis has since
 * moved, which is the honest half of that promise, and a deliberate recompute
 * publishes a **new** superseding row rather than correcting the old one.
 *
 * Behind `inventory.view_costs_organisation`, with the prices it summarises.
 */
final class WeeklyPricePublicationIndexController
{
    private const int DEFAULT_PER_PAGE = 26;

    private const int MAX_PER_PAGE = 100;

    public function __construct(private readonly WeeklyPricePresenter $presenter) {}

    public function __invoke(
        Request $request,
        WeeklyPriceQuery $prices,
        TenantContext $context,
    ): JsonResponse {
        $validated = $request->validate([
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
        ]);

        $page = (int) ($validated['page'] ?? 1);
        $perPage = (int) ($validated['per_page'] ?? self::DEFAULT_PER_PAGE);

        $result = $prices->publications($context->organisationId(), $page, $perPage);

        return ApiResponse::data(
            [
                'publications' => array_map(
                    fn ($publication): array => $this->presenter->publication($publication),
                    $result['rows'],
                ),
            ],
            ['page' => $page, 'per_page' => $perPage, 'has_more' => $result['has_more']],
        );
    }
}
