<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Presenters\SupplierPresenter;
use Healthy360\Procurement\Services\SupplierService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * PATCH /catalogue/procurement/suppliers/{supplierId} — edit the record.
 *
 * **`code` is editable here**, unlike a delivery zone's or a price list's. The
 * difference is who wrote it: those codes are minted by an operator who meant
 * them, whereas a supplier code is frequently minted *by the server* from a
 * name typed into a goods-receipt dialog at the loading bay. Refusing to
 * correct `GULF-FRESH-TRADING-CO-2` into `GULF-01` would leave the kitchen
 * stuck with an accident. The uniqueness rule ignores this supplier's own row,
 * so re-saving the form without touching the code is not a conflict with
 * itself.
 *
 * `archived_at` is not reachable from here. Archiving is its own action with
 * its own audit event, so a PATCH cannot retire a supplier by writing a field.
 *
 * Ops controllers validate inline — no form requests — matching the siblings.
 * There is no `If-Match`: a supplier record carries no lock version, because
 * two people editing the same supplier's phone number is not the race a
 * delivery map's area claims are.
 */
final class SupplierUpdateController
{
    public function __construct(private readonly SupplierPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(
        Request $request,
        string $supplierId,
        SupplierService $suppliers,
        TenantContext $context,
    ): JsonResponse {
        $supplier = Supplier::query()->whereKey($supplierId)->first();
        if ($supplier === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $validated = $request->validate([
            'name_en' => ['sometimes', 'required', 'string', 'max:160'],
            'name_ar' => ['sometimes', 'nullable', 'string', 'max:160'],
            'code' => [
                'sometimes',
                'required',
                'string',
                'max:64',
                Rule::unique('suppliers', 'code')
                    ->where('organisation_id', $context->organisationId())
                    ->ignore($supplier->getKey()),
            ],
            'currency_code' => [
                'sometimes',
                'nullable',
                'string',
                'size:3',
                Rule::exists('currencies', 'code'),
            ],
            'contact_email' => ['sometimes', 'nullable', 'email', 'max:160'],
            'contact_phone' => ['sometimes', 'nullable', 'string', 'max:40'],
            'address' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'payment_terms' => ['sometimes', 'nullable', 'string', 'max:120'],
            // Mirrors the CHECK the migration adds, so a bad value is a named
            // 422 rather than a constraint violation.
            'lead_time_days' => ['sometimes', 'nullable', 'integer', 'between:0,365'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $updated = $suppliers->update($supplier, $validated);

        return ApiResponse::data(['supplier' => $this->presenter->supplier($updated)]);
    }
}
