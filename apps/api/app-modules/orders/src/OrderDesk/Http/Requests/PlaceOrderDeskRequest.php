<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Requests;

use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Enums\PaymentMethod;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for selling something across the counter.
 *
 * **The quote's body plus one field**, and the field is `payment_method`. That
 * is the whole difference between asking what a sale would cost and making one,
 * which is the point: a desk agent reads a total off the quote, the customer
 * says how they are paying, and the placement repeats the basket verbatim with
 * that one answer added. A body shaped any other way would mean the screen
 * rebuilding the sale between the two calls.
 *
 * `payment_method` is required and has no default. `persist()` hardcoded cash on
 * delivery for the whole of C1 and stopped being able to the moment somebody
 * could pay at a counter; a default here would put that decision back, one layer
 * up, where it would be even less visible. A counter sale paid in cash and one
 * settled by a WISH transfer are different evenings and the row has to say
 * which.
 *
 * **What is still absent is any amount.** No total, no unit price, no delivery
 * fee. `OrderPlacementService` reprices every line at placement against the
 * tariff standing at that moment — the quote's numbers were advisory and were
 * never stored — and a body that could state a total would be a client quoting
 * the server its own prices. The first thing anybody would do with it is quote a
 * lower one, at a counter, with nobody watching.
 *
 * The consequence is real and is correct: a price that moved between the quote
 * and the tap is charged at the new figure, and an article withdrawn in between
 * refuses the placement outright with `order.placement_refused`. The desk sees
 * the refusal, re-quotes, and tells the customer — which is what would have
 * happened if the tariff had moved thirty seconds earlier.
 *
 * `quantity` is validated numeric before `DeskBasket` sees it for the reason
 * `QuoteOrderDeskRequest` gives at length: the basket throws on a non-numeric
 * quantity by design, and an uncaught throw is a 500 where a 422 belongs.
 *
 * ## The `payment` block: required on a counter sale, prohibited on the others
 *
 * The one rule in this class that `fulfilment_type` decides, and the one place
 * that decision belongs at this layer rather than in the refusal envelope — the
 * three shape rules below are deliberately answered by
 * `OrderPlacementService::shapeReasons()` instead, and the difference is worth
 * stating because it looks inconsistent.
 *
 * Those three are about **what the order is**, and a placement wrong in two ways
 * should say both at once. This one is about **which endpoint behaviour runs**:
 * a counter body carrying a payment block takes `CounterSale::complete()` and
 * comes back fulfilled; every other body takes the bare placement and comes back
 * placed. That is not a fact about the order, it is the branch itself, and a
 * branch chosen by whether an optional object happened to be present is a
 * branch nobody can predict from the request.
 *
 * **Required for `counter`.** A walk-in pays now — that is what "counter" means.
 * The customer is in the room, the food is in front of them, and there is no
 * later moment at which the money arrives. A counter order left unpaid is a
 * *pickup* wearing the wrong label: something the kitchen is holding for
 * somebody who will settle when they come back. Making it optional would let the
 * desk create exactly that row, with a fulfilment type that says the customer
 * already walked away with the food and no receipt saying they paid for it, and
 * nothing downstream could tell it from a counter sale whose receipt was lost.
 * So an absent block is a `422`, not a placement.
 *
 * **Prohibited for `delivery` and `pickup`.** Their money arrives later — at the
 * door, or when the customer collects — through `POST /catalogue/orders/{order}/
 * payments`, recorded by whoever actually took it, with their own `confirmed_by`
 * and their own moment. Accepting a payment block here would mean receipting a
 * delivery at the instant it was placed, by a desk agent who has not been handed
 * anything, and a day's takings would then include money that is still in a
 * customer's pocket. Refused as `prohibited` rather than ignored, because a
 * field supplied and dropped means the caller believed something about this
 * order that is not true of it.
 *
 * **There is no amount**, for the same reason there is no total: the receipt is
 * for exactly what the placement priced. See `CounterSaleDraft`.
 */
class PlaceOrderDeskRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware; a form request that
     * also guessed would give two answers to one question.
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
            'fulfilment_type' => ['required', Rule::in(FulfilmentType::codes())],
            'payment_method' => ['required', new Enum(PaymentMethod::class)],
            'branch_id' => ['nullable', 'uuid'],
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.catalogue_item_id' => ['required', 'uuid'],
            'lines.*.catalogue_item_variant_id' => ['nullable', 'uuid'],
            'lines.*.quantity' => ['required', 'numeric', 'gt:0'],
            // Which of these is required, forbidden or merely allowed is decided
            // by `fulfilment_type`, and it is deliberately **not** decided here.
            // `OrderPlacementService::shapeReasons()` answers it as
            // `customer_required` / `address_required` /
            // `address_not_applicable` inside the refusal envelope, beside every
            // other thing wrong with the placement — a `required_if` here would
            // pull one of the three out into a 422 and the desk would meet the
            // rule in two different shapes depending on which half it broke.
            'customer_account_id' => ['nullable', 'uuid'],
            'customer_address_id' => ['nullable', 'uuid'],
            'requested_delivery_date' => ['nullable', 'date_format:Y-m-d'],
            'delivery_window_code' => ['nullable', 'string', 'max:40'],
            // Required on a counter sale and refused on the other two — see the
            // class docblock for why this one rule is decided here while the
            // three customer/address rules are decided in the refusal envelope.
            'payment' => [
                Rule::requiredIf(fn (): bool => $this->isCounterSale()),
                Rule::prohibitedIf(fn (): bool => ! $this->isCounterSale()),
                'array',
            ],
            'payment.method' => ['required_with:payment', new Enum(PaymentMethod::class)],
            // Both bounded at the column's own width. `reference` and `notes`
            // are `Confidential` on `OrderPaymentReceipt`: a transfer identifier
            // points at a real transaction between two named parties, and a note
            // written at a counter is exactly where somebody puts a customer's
            // name.
            'payment.reference' => ['nullable', 'string', 'max:120'],
            'payment.notes' => ['nullable', 'string', 'max:300'],
        ];
    }

    /**
     * Whether this body is asking for a sale across the counter.
     *
     * Read from the raw input rather than from the validated set, because the
     * two `payment` rules above run *during* validation and there is nothing
     * validated yet. A body whose `fulfilment_type` is missing or nonsense
     * therefore reads as "not a counter sale", which makes `payment` prohibited
     * — the conservative half of the rule, and in any case that body is already
     * failing on `fulfilment_type` itself.
     */
    private function isCounterSale(): bool
    {
        return $this->input('fulfilment_type') === FulfilmentType::Counter->value;
    }

    /**
     * The counter sale's payment block, or null when this is not one.
     *
     * Separate from `payload()` because it is the *other* half of the request:
     * everything in `payload()` becomes a `ComposedPlacement`, and this becomes
     * the receipt beside it. Folding the two together would put a receipt field
     * inside a placement shape that has no column for it.
     *
     * @return array{method: string, reference: string|null, notes: string|null}|null
     */
    public function payment(): ?array
    {
        /** @var array{method?: string, reference?: string|null, notes?: string|null}|null $payment */
        $payment = $this->validated('payment');

        if ($payment === null || ! isset($payment['method'])) {
            return null;
        }

        return [
            'method' => (string) $payment['method'],
            'reference' => $this->stated($payment['reference'] ?? null),
            'notes' => $this->stated($payment['notes'] ?? null),
        ];
    }

    /**
     * @return array{
     *     fulfilment_type: string,
     *     payment_method: string,
     *     branch_id: string|null,
     *     lines: list<array{catalogue_item_id: string, catalogue_item_variant_id: string|null, quantity: string}>,
     *     customer_account_id: string|null,
     *     customer_address_id: string|null,
     *     requested_delivery_date: string|null,
     *     delivery_window_code: string|null
     * }
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $validated */
        $validated = $this->validated();

        /** @var list<array{catalogue_item_id: string, catalogue_item_variant_id?: string|null, quantity: int|float|string}> $lines */
        $lines = $validated['lines'];

        return [
            'fulfilment_type' => (string) $validated['fulfilment_type'],
            'payment_method' => (string) $validated['payment_method'],
            'branch_id' => $this->stated($validated['branch_id'] ?? null),
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
            'customer_account_id' => $this->stated($validated['customer_account_id'] ?? null),
            'customer_address_id' => $this->stated($validated['customer_address_id'] ?? null),
            'requested_delivery_date' => $this->stated($validated['requested_delivery_date'] ?? null),
            'delivery_window_code' => $this->stated($validated['delivery_window_code'] ?? null),
        ];
    }

    /**
     * An empty string is not a shorter identifier, it is an absent one.
     */
    private function stated(mixed $value): ?string
    {
        $trimmed = trim((string) ($value ?? ''));

        return $trimmed === '' ? null : $trimmed;
    }
}
