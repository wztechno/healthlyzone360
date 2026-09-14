<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Inventory\Presenters\OrderConsumptionExceptionPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /catalogue/inventory/consumption-exceptions — the review list (INV1.5).
 *
 * Every thing a confirmed order could not deduct honestly (INV1.2), newest first,
 * flattened with the order number, sold item and branch it belongs to. Filterable
 * by resolution state (`resolved=true|false`) and by the date range the exception
 * was raised in, so a kitchen can walk what is still open or audit what was
 * settled.
 *
 * Behind `inventory.view_organisation` at the route — reading the queue is a plain
 * ops read; settling or retrying an item is the gated write. Cursor-paginated over
 * the row's own `(created_at, id)` like the purchases ledger. The presenter reads
 * no recipe line, formulation quantity or ingredient cost — only which sale on
 * which line could not be deducted and why.
 */
final class ConsumptionExceptionIndexController
{
    public function __construct(private readonly OrderConsumptionExceptionPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        /*
        | `in:` rather than `boolean:` on the flag. Laravel's boolean rule
        | compares strictly against true/false/0/1/'0'/'1', so the `true|false`
        | this endpoint documents — and that a query string can only ever carry
        | as a word — is rejected by it. filter_var below reads all four.
        */
        $validated = $request->validate([
            'resolved' => ['nullable', 'in:true,false,1,0'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);

        $query = OrderConsumptionException::query()
            ->where('organisation_id', $context->organisationId());

        if (array_key_exists('resolved', $validated) && $validated['resolved'] !== null) {
            $resolved = filter_var($validated['resolved'], FILTER_VALIDATE_BOOLEAN);
            $resolved
                ? $query->whereNotNull('resolved_at')
                : $query->whereNull('resolved_at');
        }

        if (isset($validated['from'])) {
            $query->where('created_at', '>=', $validated['from']);
        }

        if (isset($validated['to'])) {
            $query->where('created_at', '<=', $validated['to']);
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request), newestFirst: true);

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            ['exceptions' => $this->presenter->collection($page['items'])],
            $page['meta'],
        );
    }
}
