<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Presenters\SupplierPresenter;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /catalogue/procurement/suppliers — the organisation's supplier book.
 *
 * **Archived suppliers are excluded by default**, and that is the endpoint's
 * one opinion. Every caller is a picker or a list, and a picker offering a
 * supplier the kitchen stopped buying from is how an order gets sent to a
 * shuttered warehouse. `?include_archived=true` is the archive filter on the
 * suppliers screen and nothing else asks for it.
 *
 * Contacts are counted in one query rather than fetched per row: the list shows
 * "who do I call" beside each supplier, and that summary is exactly the thing a
 * naive implementation turns into an N+1. Supplied items are counted by
 * `withCount` rather than loaded at all (SUP2) — the book shows a number, and
 * loading every link of every supplier to length an array would be the same
 * mistake in a second place.
 */
final class SupplierIndexController
{
    public function __construct(private readonly SupplierPresenter $presenter) {}

    public function __invoke(Request $request): JsonResponse
    {
        $includeArchived = $request->boolean('include_archived');

        $suppliers = Supplier::query()
            ->with('contacts')
            ->withCount('suppliedItems')
            ->unless($includeArchived, fn ($query) => $query->notArchived())
            ->orderBy('code')
            ->get();

        return ApiResponse::data(
            ['suppliers' => $suppliers->map(fn (Supplier $supplier): array => $this->presenter->supplier($supplier))->all()],
            [
                'count' => $suppliers->count(),
                'archived_count' => $suppliers->filter(static fn (Supplier $supplier): bool => $supplier->isArchived())->count(),
                'includes_archived' => $includeArchived,
            ],
        );
    }
}
