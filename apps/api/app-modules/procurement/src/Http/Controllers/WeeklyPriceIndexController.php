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
 * GET /catalogue/procurement/weekly-prices — what a week's purchases averaged to
 * (PROD1).
 *
 * Without `publication_id`, the **standing** price per ingredient: what the
 * estimator is actually using right now, which is the question a manager asks
 * when a batch estimate looks wrong. With one, every row that publication
 * carried — the historical record, which does not move.
 *
 * Unpriced rows are included and are the point: an ingredient nobody could price
 * this week is the flag the requirement asks for, and it is published as a row
 * with a null amount rather than omitted. A caller that treated null as zero
 * would price food at nothing; one that treated the list as complete would
 * silently drop the ingredients that need attention.
 *
 * Behind `inventory.view_costs_organisation` — every row is a price, so there is
 * nothing here a redaction could usefully leave behind.
 */
final class WeeklyPriceIndexController
{
    private const int DEFAULT_PER_PAGE = 50;

    private const int MAX_PER_PAGE = 200;

    public function __construct(private readonly WeeklyPricePresenter $presenter) {}

    public function __invoke(
        Request $request,
        WeeklyPriceQuery $prices,
        TenantContext $context,
    ): JsonResponse {
        $validated = $request->validate([
            'publication_id' => ['sometimes', 'uuid'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
        ]);

        $page = (int) ($validated['page'] ?? 1);
        $perPage = (int) ($validated['per_page'] ?? self::DEFAULT_PER_PAGE);
        $publicationId = isset($validated['publication_id']) ? (string) $validated['publication_id'] : null;

        $result = $publicationId === null
            ? $prices->standing($context->organisationId(), $page, $perPage)
            : $prices->forPublication($context->organisationId(), $publicationId, $page, $perPage);

        return ApiResponse::data(
            [
                'weekly_prices' => array_map(
                    fn ($price): array => $this->presenter->price($price),
                    $result['rows'],
                ),
            ],
            [
                'page' => $page,
                'per_page' => $perPage,
                // Stated rather than inferred from a short page: a pager that
                // offers a page it cannot fetch is worse than one that stops.
                'has_more' => $result['has_more'],
                'is_standing' => $publicationId === null,
            ],
        );
    }
}
