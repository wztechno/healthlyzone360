<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * POST /catalogue/procurement/suppliers — add a supplier to the organisation's
 * book so a goods receipt can be posted against it.
 *
 * `inventory.manage_organisation` gates the write, matching the goods-receipt
 * post beside it: naming who stock is bought from is the same warehouse job as
 * recording that it arrived, and neither needs the cost-reading permission. The
 * default currency a supplier carries is a hint the receipt form pre-selects,
 * not a cost figure — the money a receipt books lives on its lines.
 *
 * Ops controllers validate inline — no form requests — matching the sibling ops
 * controllers. `code` is optional: a kitchen adds a supplier by name and the
 * server mints a unique per-organisation code from it, exactly as the ingredient
 * catalogue mints a slug, so the supplier book never demands a code the person
 * filling in a delivery note does not have.
 */
final class SupplierStoreController
{
    public function __invoke(Request $request, TenantContext $context, AuditRecorder $audit): JsonResponse
    {
        $organisationId = $context->organisationId();

        $validated = $request->validate([
            'name_en' => ['required', 'string', 'max:160'],
            'code' => [
                'nullable',
                'string',
                'max:64',
                Rule::unique('suppliers', 'code')->where('organisation_id', $organisationId),
            ],
            'currency_code' => [
                'nullable',
                'string',
                'size:3',
                Rule::exists('currencies', 'code'),
            ],
            'contact_email' => ['nullable', 'email', 'max:160'],
            'contact_phone' => ['nullable', 'string', 'max:40'],
        ]);

        $code = $validated['code'] ?? null;
        $code = $code === null || trim($code) === ''
            ? $this->uniqueCode($validated['name_en'])
            : $code;

        $supplier = Supplier::query()->create([
            'code' => $code,
            'name_en' => $validated['name_en'],
            'currency_code' => $validated['currency_code'] ?? null,
            'contact_email' => $validated['contact_email'] ?? null,
            'contact_phone' => $validated['contact_phone'] ?? null,
        ]);

        $audit->record(
            'procurement.supplier_created',
            actorUserId: $context->userId(),
            subjectType: 'supplier',
            subjectId: (string) $supplier->getKey(),
            metadata: [
                'code' => $supplier->code,
                'has_currency' => $supplier->currency_code !== null,
            ],
        );

        return ApiResponse::data(['supplier' => [
            'id' => (string) $supplier->getKey(),
            'code' => $supplier->code,
            'name_en' => $supplier->name_en,
            'currency_code' => $supplier->currency_code,
            'contact_email' => $supplier->contact_email,
            'contact_phone' => $supplier->contact_phone,
        ]], status: 201);
    }

    /**
     * A unique per-organisation supplier code minted from the name — the same
     * discipline the ingredient catalogue uses for its slug. Uppercased so it
     * reads like the seeded `SUP-001` codes rather than a URL slug, and suffixed
     * `-2`, `-3`… until it clears the `(organisation_id, code)` unique index.
     */
    private function uniqueCode(string $name): string
    {
        $base = Str::upper(Str::limit(Str::slug($name), 56, ''));

        if ($base === '') {
            $base = 'SUPPLIER';
        }

        $code = $base;
        $suffix = 2;

        while (Supplier::query()->where('code', $code)->exists()) {
            $code = $base.'-'.$suffix;
            $suffix++;
        }

        return $code;
    }
}
