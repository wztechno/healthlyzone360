<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Presenters\SupplierPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /catalogue/procurement/suppliers/{supplierId} — one supplier and its
 * named contacts.
 *
 * Contacts are embedded rather than left behind a second endpoint, because
 * unlike a delivery zone's map they are a bounded set a person maintains by
 * hand: a supplier has a handful of people, not a hundred places, and the page
 * that shows the record is the page that edits them.
 *
 * An archived supplier is served normally. The archive is not a hiding place —
 * a receipt posted last month names this supplier, and the screen that explains
 * it needs the record. `archived_at` is what tells the client to render the
 * record read-only.
 */
final class SupplierShowController
{
    public function __construct(private readonly SupplierPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $supplierId): JsonResponse
    {
        $supplier = Supplier::query()->with('contacts')->whereKey($supplierId)->first();
        if ($supplier === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return ApiResponse::data(['supplier' => $this->presenter->detail($supplier)]);
    }
}
