<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Presenters\SupplierPresenter;
use Healthy360\Procurement\Services\SupplierService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /catalogue/procurement/suppliers/{supplierId}/archive.
 *
 * **Not a delete, and reversible.** The supplier leaves every picker and every
 * automatic suggestion, and keeps every goods receipt posted against it — which
 * is the whole point, because a purchases ledger that forgets who it bought
 * from stops being a ledger. `…/restore` puts it back, because the reason a
 * supplier went quiet is very often that they were on holiday.
 *
 * An action rather than a PATCH field, so archiving is one deliberate request
 * with its own audit event instead of something a form save can do by
 * accident. Idempotent: archiving an archived supplier keeps the original
 * timestamp.
 */
final class SupplierArchiveController
{
    public function __construct(private readonly SupplierPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $supplierId, SupplierService $suppliers): JsonResponse
    {
        $supplier = Supplier::query()->whereKey($supplierId)->first();
        if ($supplier === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return ApiResponse::data(['supplier' => $this->presenter->supplier($suppliers->archive($supplier))]);
    }
}
