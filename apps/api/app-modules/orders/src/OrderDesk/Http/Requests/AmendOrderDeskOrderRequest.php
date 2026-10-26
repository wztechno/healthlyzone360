<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Requests;

use Healthy360\Orders\Enums\PaymentMethod;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for editing an order the desk (or the web shop) already took.
 *
 * `lines` is the **whole** basket, with the placement's line rules: the order's
 * lines become exactly these. Everything else is optional and absent means
 * "keep what is stored" — an edit to a quantity must not quietly move the slot,
 * the day or the address.
 *
 * There is no customer, no fulfilment type and no branch: those are fixed for
 * the life of the order. There is no amount either, for the reason the
 * placement has none — every line is repriced on the order's own channel.
 * Whether `payment_method` suits the order's fulfilment type is a fact about the
 * stored order, so the controller asks it once the order is read.
 */
class AmendOrderDeskOrderRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.catalogue_item_id' => ['required', 'uuid'],
            'lines.*.catalogue_item_variant_id' => ['nullable', 'uuid'],
            'lines.*.quantity' => ['required', 'numeric', 'gt:0'],
            'customer_address_id' => ['nullable', 'uuid'],
            'requested_delivery_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:today'],
            'delivery_window_code' => ['nullable', 'string', 'max:40'],
            'payment_method' => ['nullable', new Enum(PaymentMethod::class)],
        ];
    }

    /**
     * @return array{
     *     lines: list<array{catalogue_item_id: string, catalogue_item_variant_id: string|null, quantity: string}>,
     *     customer_address_id: string|null,
     *     requested_delivery_date: string|null,
     *     delivery_window_code: string|null,
     *     payment_method: string|null
     * }
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $validated */
        $validated = $this->validated();

        /** @var list<array{catalogue_item_id: string, catalogue_item_variant_id?: string|null, quantity: int|float|string}> $lines */
        $lines = $validated['lines'];

        return [
            'lines' => array_map(
                static fn (array $line): array => [
                    'catalogue_item_id' => (string) $line['catalogue_item_id'],
                    'catalogue_item_variant_id' => ($line['catalogue_item_variant_id'] ?? null) === null
                        ? null
                        : (string) $line['catalogue_item_variant_id'],
                    'quantity' => (string) $line['quantity'],
                ],
                $lines,
            ),
            'customer_address_id' => $this->stated($validated['customer_address_id'] ?? null),
            'requested_delivery_date' => $this->stated($validated['requested_delivery_date'] ?? null),
            'delivery_window_code' => $this->stated($validated['delivery_window_code'] ?? null),
            'payment_method' => $this->stated($validated['payment_method'] ?? null),
        ];
    }

    private function stated(mixed $value): ?string
    {
        $trimmed = trim((string) ($value ?? ''));

        return $trimmed === '' ? null : $trimmed;
    }
}
