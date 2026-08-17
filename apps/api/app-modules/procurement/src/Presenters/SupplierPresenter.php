<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Presenters;

use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierContact;

/**
 * The one wire shape of a supplier.
 *
 * Before this class the list and the create response each hand-rolled their own
 * array, which is how the two drifted: adding a field to the book meant
 * remembering two places, and the second was always the one forgotten. Every
 * supplier the API serves now leaves through `supplier()`, so a list row and a
 * freshly created record are the same object to a client — which is what lets
 * the universal app write one mapper instead of three.
 *
 * `contact_count` and `primary_contact` ride on the canonical shape rather than
 * on the detail variant, because the *list* is what needs them: a supplier book
 * showing "who do I call" beside each name is the screen's whole point, and
 * fetching contacts per row to render it would be the N+1 the summary exists to
 * avoid. Both are served from the loaded `contacts` relation when it is there
 * and counted when it is not, so the caller decides the query shape.
 *
 * There is no cost redaction here. A supplier record carries no money — the
 * currency it invoices in is a hint the receipt form pre-selects, not an amount
 * — so `inventory.view_organisation` is the whole gate and the presenter has no
 * second face to show. Slice 2's supplied items are the first thing here that
 * will need one.
 */
final class SupplierPresenter
{
    /**
     * @return array{
     *     id: string,
     *     code: string,
     *     name_en: string,
     *     name_ar: string|null,
     *     currency_code: string|null,
     *     contact_email: string|null,
     *     contact_phone: string|null,
     *     address: string|null,
     *     payment_terms: string|null,
     *     lead_time_days: int|null,
     *     notes: string|null,
     *     archived_at: string|null,
     *     contact_count: int,
     *     primary_contact: array{name: string, phone: string|null}|null
     * }
     */
    public function supplier(Supplier $supplier): array
    {
        $primary = $this->primaryContact($supplier);

        return [
            'id' => (string) $supplier->getKey(),
            'code' => $supplier->code,
            'name_en' => $supplier->name_en,
            'name_ar' => $supplier->name_ar,
            'currency_code' => $supplier->currency_code,
            'contact_email' => $supplier->contact_email,
            'contact_phone' => $supplier->contact_phone,
            'address' => $supplier->address,
            'payment_terms' => $supplier->payment_terms,
            'lead_time_days' => $supplier->lead_time_days,
            'notes' => $supplier->notes,
            'archived_at' => $supplier->archived_at?->toIso8601String(),
            'contact_count' => $this->contactCount($supplier),
            'primary_contact' => $primary === null ? null : [
                'name' => $primary->name,
                // The number a kitchen actually dials, WhatsApp included: on a
                // list row "who do I call" is the question, and a contact
                // reachable only on WhatsApp is still reachable.
                'phone' => $primary->phone ?? $primary->whatsapp_phone,
            ],
        ];
    }

    /**
     * The canonical shape plus the full contact set — the supplier's own page.
     *
     * Expects `contacts` loaded; the relation orders itself.
     *
     * @return array<string, mixed>
     */
    public function detail(Supplier $supplier): array
    {
        return $this->supplier($supplier) + [
            'contacts' => $supplier->contacts->map(fn (SupplierContact $contact): array => $this->contact($contact))->all(),
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     name: string,
     *     role_title: string|null,
     *     email: string|null,
     *     phone: string|null,
     *     whatsapp_phone: string|null,
     *     is_primary: bool,
     *     display_order: int
     * }
     */
    public function contact(SupplierContact $contact): array
    {
        return [
            'id' => (string) $contact->getKey(),
            'name' => $contact->name,
            'role_title' => $contact->role_title,
            'email' => $contact->email,
            'phone' => $contact->phone,
            'whatsapp_phone' => $contact->whatsapp_phone,
            'is_primary' => $contact->is_primary,
            'display_order' => $contact->display_order,
        ];
    }

    /**
     * The primary named contact, falling back to the first in display order.
     *
     * The fallback is the honest answer to "who do I call": a supplier whose
     * contacts nobody flagged still has a person at the top of the list, and
     * showing an empty cell beside a supplier with three contacts on file would
     * be a worse answer than showing the first of them.
     */
    private function primaryContact(Supplier $supplier): ?SupplierContact
    {
        if (! $supplier->relationLoaded('contacts')) {
            return SupplierContact::query()
                ->where('supplier_id', $supplier->getKey())
                ->orderByDesc('is_primary')
                ->orderBy('display_order')
                ->orderBy('name')
                ->first();
        }

        return $supplier->contacts->firstWhere('is_primary', true)
            ?? $supplier->contacts->first();
    }

    private function contactCount(Supplier $supplier): int
    {
        if ($supplier->relationLoaded('contacts')) {
            return $supplier->contacts->count();
        }

        $counted = $supplier->getAttribute('contacts_count');

        return is_numeric($counted)
            ? (int) $counted
            : SupplierContact::query()->where('supplier_id', $supplier->getKey())->count();
    }
}
