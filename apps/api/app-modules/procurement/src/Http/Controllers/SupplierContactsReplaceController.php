<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierContact;
use Healthy360\Procurement\Presenters\SupplierPresenter;
use Healthy360\Procurement\Services\SupplierContactService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * PUT /catalogue/procurement/suppliers/{supplierId}/contacts — set-replace.
 *
 * The body is the whole desired contact set: contacts carrying an `id` are
 * updated, contacts without one are created, and contacts absent from the body
 * are deleted. One request, one transaction, one **Save contacts** button on
 * the screen — never a save fired per card, which would delete the card the
 * user was halfway through adding.
 *
 * A `PUT` rather than a `POST` for the reason the delivery-zone area replace is
 * one: the request is idempotent, and sending it twice must leave the same set
 * rather than a doubled one.
 *
 * Twenty contacts is the cap. A supplier with more than twenty named people is
 * not a supplier record, it is a directory, and the bound is what stops a
 * malformed client from writing one.
 */
final class SupplierContactsReplaceController
{
    public function __construct(private readonly SupplierPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $supplierId, SupplierContactService $contacts): JsonResponse
    {
        $supplier = Supplier::query()->whereKey($supplierId)->first();
        if ($supplier === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $validated = $request->validate([
            'contacts' => ['present', 'array', 'max:20'],
            'contacts.*.id' => ['nullable', 'uuid'],
            'contacts.*.name' => ['required', 'string', 'max:120'],
            'contacts.*.role_title' => ['nullable', 'string', 'max:120'],
            'contacts.*.email' => ['nullable', 'email', 'max:160'],
            'contacts.*.phone' => ['nullable', 'string', 'max:40'],
            'contacts.*.whatsapp_phone' => ['nullable', 'string', 'max:40'],
            'contacts.*.is_primary' => ['nullable', 'boolean'],
            'contacts.*.display_order' => ['nullable', 'integer', 'between:0,65535'],
        ]);

        $replaced = $contacts->replace($supplier, $this->submitted($validated['contacts']));

        return ApiResponse::data(
            ['contacts' => $replaced->map(fn (SupplierContact $contact): array => $this->presenter->contact($contact))->all()],
            ['count' => $replaced->count()],
        );
    }

    /**
     * The validated body as the shape the service asks for.
     *
     * Rebuilt field by field rather than passed through: validation proves the
     * values are well formed but says nothing about the array's *shape*, and
     * the service's contract is what the two 422 rules are written against.
     *
     * @param  array<int, array<string, mixed>>  $contacts
     * @return list<array{
     *     id: string|null,
     *     name: string,
     *     role_title: string|null,
     *     email: string|null,
     *     phone: string|null,
     *     whatsapp_phone: string|null,
     *     is_primary: bool,
     *     display_order: int|null
     * }>
     */
    private function submitted(array $contacts): array
    {
        return array_values(array_map(static fn (array $contact): array => [
            'id' => self::text($contact['id'] ?? null),
            'name' => (string) $contact['name'],
            'role_title' => self::text($contact['role_title'] ?? null),
            'email' => self::text($contact['email'] ?? null),
            'phone' => self::text($contact['phone'] ?? null),
            'whatsapp_phone' => self::text($contact['whatsapp_phone'] ?? null),
            'is_primary' => (bool) ($contact['is_primary'] ?? false),
            'display_order' => isset($contact['display_order']) ? (int) $contact['display_order'] : null,
        ], $contacts));
    }

    private static function text(mixed $value): ?string
    {
        return is_string($value) ? $value : null;
    }
}
