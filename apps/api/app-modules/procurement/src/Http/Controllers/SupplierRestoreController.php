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
 * POST /catalogue/procurement/suppliers/{supplierId}/restore — put an archived
 * supplier back in the book.
 *
 * The counterpart to archive, and the reason archiving is safe to offer: a
 * kitchen that stopped buying from somebody for a season can start again
 * without re-typing the record, its contacts and — from slice 2 — its item
 * links. Idempotent: restoring a live supplier changes nothing.
 */
final class SupplierRestoreController
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

        return ApiResponse::data(['supplier' => $this->presenter->supplier($suppliers->restore($supplier))]);
    }
}
