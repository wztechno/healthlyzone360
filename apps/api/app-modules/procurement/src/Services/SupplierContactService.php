<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierContact;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The contact set is replaced as one document, in one transaction (§3.2).
 *
 * **Set-replace rather than per-card writes, and the UI has one Save button to
 * match.** A supplier's contacts are edited together — you add Samir, promote
 * him over the person who left and delete the person who left, and any two of
 * those three arriving separately leaves the supplier in a state the kitchen
 * never asked for. Sending the whole desired set means the server sees the
 * intention rather than three fragments of it. The corollary is the one the
 * plan spells out: the screen must not silently replace the set whenever one
 * card changes, because a set-replace fired by a keystroke would delete a card
 * the user was halfway through adding.
 *
 * Two rules are checked **before** the write rather than caught after it:
 *
 * 1. At most one `is_primary`. The partial unique index enforces it, but a
 *    23505 surfacing as a 500 tells the person nothing; the 422 names the rule.
 * 2. Every contact reaches somebody. The CHECK enforces it; the 422 says which
 *    contact and why.
 *
 * Primary flags are cleared across the whole set before the final one is set.
 * The partial unique index is checked per statement, so promoting B while A is
 * still primary would collide inside the transaction even though the end state
 * is legal — clearing first is what makes a straight swap possible.
 *
 * Audit metadata is counts only. How many contacts a supplier has is
 * operational history; their phone numbers are not something an audit reader
 * holding `audit.view_organisation` should be handed.
 */
final readonly class SupplierContactService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  list<array{
     *     id?: string|null,
     *     name: string,
     *     role_title?: string|null,
     *     email?: string|null,
     *     phone?: string|null,
     *     whatsapp_phone?: string|null,
     *     is_primary?: bool|null,
     *     display_order?: int|null
     * }>  $contacts
     * @return Collection<int, SupplierContact>
     *
     * @throws ApiException
     */
    public function replace(Supplier $supplier, array $contacts): Collection
    {
        $this->assertAtMostOnePrimary($contacts);
        $this->assertEveryContactIsReachable($contacts);

        $existing = SupplierContact::query()
            ->where('supplier_id', $supplier->getKey())
            ->get()
            ->keyBy(fn (SupplierContact $contact): string => (string) $contact->getKey());

        DB::transaction(function () use ($supplier, $contacts, $existing): void {
            $keptIds = [];

            // Clear every primary flag first. The end state may legally move
            // the flag from one contact to another, but the partial unique
            // index is checked per statement and would refuse the moment both
            // rows claimed it.
            SupplierContact::query()
                ->where('supplier_id', $supplier->getKey())
                ->where('is_primary', true)
                ->update(['is_primary' => false]);

            foreach ($contacts as $index => $contact) {
                $id = $this->trimmedOrNull($contact['id'] ?? null);

                $attributes = [
                    'name' => trim($contact['name']),
                    'role_title' => $this->trimmedOrNull($contact['role_title'] ?? null),
                    'email' => $this->trimmedOrNull($contact['email'] ?? null),
                    'phone' => $this->trimmedOrNull($contact['phone'] ?? null),
                    'whatsapp_phone' => $this->trimmedOrNull($contact['whatsapp_phone'] ?? null),
                    'is_primary' => (bool) ($contact['is_primary'] ?? false),
                    // Position in the submitted set is the order the kitchen
                    // just arranged on screen; an explicit value overrides it.
                    'display_order' => (int) ($contact['display_order'] ?? $index),
                ];

                $record = $id === null ? null : $existing->get($id);

                if ($record instanceof SupplierContact) {
                    $record->fill($attributes)->save();
                } else {
                    // An id naming a contact of some other supplier is a new
                    // contact here, never a cross-supplier steal.
                    $record = SupplierContact::query()->create($attributes + [
                        'organisation_id' => $supplier->organisation_id,
                        'supplier_id' => $supplier->getKey(),
                    ]);
                }

                $keptIds[] = (string) $record->getKey();
            }

            $removed = $existing->keys()->diff($keptIds)->all();

            if ($removed !== []) {
                SupplierContact::query()->whereIn('id', $removed)->delete();
            }
        });

        $this->audit->record(
            'procurement.supplier_contacts_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'supplier',
            subjectId: (string) $supplier->getKey(),
            // Counts only. How many contacts a supplier has is operational
            // history; their phone numbers are not an audit reader's business.
            metadata: [
                'contact_count' => count($contacts),
                'previous_contact_count' => $existing->count(),
            ],
        );

        return $supplier->load('contacts')->contacts;
    }

    /**
     * @param  list<array<string, mixed>>  $contacts
     *
     * @throws ApiException
     */
    private function assertAtMostOnePrimary(array $contacts): void
    {
        $primaries = [];

        foreach ($contacts as $index => $contact) {
            if (($contact['is_primary'] ?? false) === true) {
                $primaries[] = $index;
            }
        }

        if (count($primaries) > 1) {
            throw $this->invalid(
                'contacts.'.$primaries[1].'.is_primary',
                'A supplier has at most one primary contact. Clear the flag on the others first.',
            );
        }
    }

    /**
     * @param  list<array<string, mixed>>  $contacts
     *
     * @throws ApiException
     */
    private function assertEveryContactIsReachable(array $contacts): void
    {
        foreach ($contacts as $index => $contact) {
            $reachable = $this->trimmedOrNull($contact['email'] ?? null) !== null
                || $this->trimmedOrNull($contact['phone'] ?? null) !== null
                || $this->trimmedOrNull($contact['whatsapp_phone'] ?? null) !== null;

            if (! $reachable) {
                throw $this->invalid(
                    'contacts.'.$index.'.email',
                    'A contact needs at least one of an email address, a telephone number or a WhatsApp number.',
                );
            }
        }
    }

    private function trimmedOrNull(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
