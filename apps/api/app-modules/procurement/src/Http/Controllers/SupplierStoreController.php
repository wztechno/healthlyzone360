<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Presenters\SupplierPresenter;
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
 *
 * Every field of the record is writable here, but **contacts are not**: they are
 * their own section-level replace, and a create that accepted them would give a
 * kitchen two ways to write the same set. The lightweight create inside the
 * goods-receipt dialog sends a name and nothing else; the full form sends the
 * record and then saves contacts against it.
 */
final class SupplierStoreController
{
    public function __construct(private readonly SupplierPresenter $presenter) {}

    public function __invoke(Request $request, TenantContext $context, AuditRecorder $audit): JsonResponse
    {
        $organisationId = $context->organisationId();

        $validated = $request->validate([
            'name_en' => ['required', 'string', 'max:160'],
            'name_ar' => ['nullable', 'string', 'max:160'],
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
            'address' => ['nullable', 'string', 'max:2000'],
            'payment_terms' => ['nullable', 'string', 'max:120'],
            // Mirrors the CHECK the migration adds, so a bad value is a named
            // 422 rather than a constraint violation.
            'lead_time_days' => ['nullable', 'integer', 'between:0,365'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $code = $validated['code'] ?? null;
        $code = $code === null || trim($code) === ''
            ? $this->uniqueCode($validated['name_en'])
            : $code;

        $supplier = Supplier::query()->create([
            'code' => $code,
            'name_en' => $validated['name_en'],
            'name_ar' => $validated['name_ar'] ?? null,
            'currency_code' => $validated['currency_code'] ?? null,
            'contact_email' => $validated['contact_email'] ?? null,
            'contact_phone' => $validated['contact_phone'] ?? null,
            'address' => $validated['address'] ?? null,
            'payment_terms' => $validated['payment_terms'] ?? null,
            'lead_time_days' => $validated['lead_time_days'] ?? null,
            'notes' => $validated['notes'] ?? null,
        ]);

        $audit->record(
            'procurement.supplier_created',
            actorUserId: $context->userId(),
            subjectType: 'supplier',
            subjectId: (string) $supplier->getKey(),
            // `supplier_ref`, not `code`: `AuditRecorder` redacts any key
            // containing that substring, so the obvious name would have written
            // `[redacted]` into every row.
            metadata: [
                'supplier_ref' => $supplier->code,
                'has_currency' => $supplier->currency_code !== null,
            ],
        );

        return ApiResponse::data(['supplier' => $this->presenter->supplier($supplier)], status: 201);
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
