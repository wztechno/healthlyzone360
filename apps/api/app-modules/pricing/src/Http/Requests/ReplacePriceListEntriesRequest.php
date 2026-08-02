<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of a price list's entries.
 *
 * `entries` is `present`, not `required`: an empty array withdraws every price
 * from the list — closing each standing row rather than deleting it — which is
 * a decision a merchandiser makes and not a field they forgot.
 *
 * There is no `effective_from`, no `effective_to` and no `superseded_by_id` in
 * these rules, and that is the shape of the whole endpoint. The body is the
 * desired *current* state; the dates are the server's account of when it was
 * told, and a client that could write them could backdate a price change to
 * before an order was taken. Derived values are never client-supplied
 * (appendix C).
 *
 * `unit_amount_minor` is validated as an integer here and re-checked against
 * `price_status` in the service, where the two are one fact rather than two
 * fields.
 */
class ReplacePriceListEntriesRequest extends FormRequest
{
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
            'entries' => ['present', 'array', 'max:500'],
            'entries.*.catalogue_item_id' => ['required', 'uuid'],
            'entries.*.catalogue_item_variant_id' => ['nullable', 'uuid'],
            'entries.*.min_quantity' => ['nullable', 'numeric'],
            'entries.*.unit_amount_minor' => ['nullable', 'integer'],
            'entries.*.price_status' => ['required', 'string', 'max:20'],
        ];
    }

    /**
     * @return list<array{catalogue_item_id: string, catalogue_item_variant_id?: string|null, min_quantity?: int|float|string|null, unit_amount_minor?: int|string|null, price_status?: string|null}>
     */
    public function entries(): array
    {
        /** @var list<array{catalogue_item_id: string, catalogue_item_variant_id?: string|null, min_quantity?: int|float|string|null, unit_amount_minor?: int|string|null, price_status?: string|null}> $entries */
        $entries = $this->validated('entries') ?? [];

        return $entries;
    }
}
