<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Tenancy\TenantContext;

/**
 * Every write to a supplier's own record after it exists (§3.1).
 *
 * **There is no delete, and archiving is the whole reason.** A supplier that
 * stopped trading owns every goods receipt posted against it, every link a
 * later slice writes and every purchase order it was ever sent. Deleting one
 * would either orphan that history or cascade it away, and a purchases ledger
 * that forgets who it bought from is not a ledger. Archiving takes the supplier
 * out of every picker and every automatic suggestion while leaving all of it
 * standing, and `restore()` is there because the reason a supplier went quiet is
 * frequently that they were on holiday.
 *
 * Audit metadata is identifiers and counts only — never an amount, and never a
 * key containing `code`: `AuditRecorder` redacts that substring blindly, so
 * `supplier_ref` carries the human-readable code that `code` would have turned
 * into `[redacted]`.
 */
final readonly class SupplierService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * Apply the validated fields a request actually sent.
     *
     * Keyed on presence rather than on null, so a client clearing a supplier's
     * notes ( `notes: null` ) genuinely clears them while a client that never
     * mentioned notes leaves them alone. `archived_at` is not writable here —
     * archiving is its own action, so a PATCH cannot reach it by accident.
     *
     * @param  array<string, mixed>  $attributes
     */
    public function update(Supplier $supplier, array $attributes): Supplier
    {
        $writable = [
            'code',
            'name_en',
            'name_ar',
            'currency_code',
            'contact_email',
            'contact_phone',
            'address',
            'payment_terms',
            'lead_time_days',
            'notes',
        ];

        $changed = [];

        foreach ($writable as $field) {
            if (! array_key_exists($field, $attributes)) {
                continue;
            }

            $value = $attributes[$field];

            if ($field === 'lead_time_days') {
                $value = $value === null ? null : (int) $value;
            } elseif (is_string($value)) {
                $value = trim($value);

                // An emptied optional field is absent, not an empty string —
                // otherwise "no address" and "an address of nothing" become two
                // states a screen has to tell apart.
                if ($value === '' && $field !== 'code' && $field !== 'name_en') {
                    $value = null;
                }
            }

            if ($supplier->getAttribute($field) === $value) {
                continue;
            }

            $supplier->setAttribute($field, $value);
            $changed[] = $field;
        }

        if ($changed === []) {
            return $supplier;
        }

        $supplier->save();

        $this->audit->record(
            'procurement.supplier_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'supplier',
            subjectId: (string) $supplier->getKey(),
            metadata: [
                'supplier_ref' => $supplier->code,
                'changed_fields' => $changed,
            ],
        );

        return $supplier;
    }

    /**
     * Take the supplier out of every picker without losing anything behind it.
     *
     * Idempotent: archiving an archived supplier keeps the original timestamp
     * and records nothing, because the second click of a button that already
     * worked is not a second event.
     */
    public function archive(Supplier $supplier): Supplier
    {
        if ($supplier->isArchived()) {
            return $supplier;
        }

        $supplier->archived_at = now();
        $supplier->save();

        $this->audit->record(
            'procurement.supplier_archived',
            actorUserId: $this->context->userId(),
            subjectType: 'supplier',
            subjectId: (string) $supplier->getKey(),
            metadata: ['supplier_ref' => $supplier->code],
        );

        return $supplier;
    }

    /**
     * Put the supplier back in the book. Idempotent for the same reason.
     */
    public function restore(Supplier $supplier): Supplier
    {
        if (! $supplier->isArchived()) {
            return $supplier;
        }

        $supplier->archived_at = null;
        $supplier->save();

        $this->audit->record(
            'procurement.supplier_restored',
            actorUserId: $this->context->userId(),
            subjectType: 'supplier',
            subjectId: (string) $supplier->getKey(),
            metadata: ['supplier_ref' => $supplier->code],
        );

        return $supplier;
    }
}
