<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Requests;

use Healthy360\Orders\Enums\FulfilmentType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for asking what a desk sale would cost.
 *
 * **Shape only, and less than usual even by that standard.** Whether the article
 * is published, whether the counter offers it today, whether it is priced and in
 * which currency, whether the kitchen delivers to the address and whether the
 * cut-off has passed are all things the quote **answers**, in its body, as data.
 * A rule here that pre-empted any of them would turn the endpoint's whole
 * purpose into a 422 with one message where the response carries all of them at
 * once.
 *
 * **`quantity` is validated as numeric before `DeskBasket` ever sees it, and
 * that ordering is load-bearing.** `DeskBasket::aggregate()` throws
 * `InvalidArgumentException` on a non-numeric quantity — a deliberate loud
 * failure, because `bcadd` handed a malformed string returns zero and would sell
 * the article free — and an uncaught `InvalidArgumentException` is a 500. So the
 * numeric rule here is what turns a fat-fingered body into a 422 with a field
 * path instead of an exception with a stack trace. `gt:0` for the reason the
 * cart gives: removing a line is its own action, not a quantity of nothing.
 *
 * Numeric rather than integer, because a desk sells 0.35 kg of something as
 * readily as it sells three coffees.
 *
 * **No `exists:` rules on any identifier.** The K1.2 argument at its sharpest
 * here: the article must be one *this kitchen's counter* offers, the account and
 * the address must belong together, and a bare `exists` would accept a retired
 * row from another kitchen or somebody else's street. `LineProbe` and
 * `ResolvesDeskParty` answer those, and their answers are better sentences.
 *
 * `fulfilment_type` is the one genuinely required field beside the lines,
 * because it decides which of the others mean anything: an address is required
 * for a delivery, forbidden on a pickup, and the difference is not inferable
 * from the body.
 */
class QuoteOrderDeskRequest extends FormRequest
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
            // The same fact the queue names as a query parameter, in a body
            // because a POST states its facts in one. It narrows nothing here —
            // it decides which branch's cut-off applies and which branch-scoped
            // delivery zone wins, both of which change the answer.
            'branch_id' => ['nullable', 'uuid'],
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.catalogue_item_id' => ['required', 'uuid'],
            'lines.*.catalogue_item_variant_id' => ['nullable', 'uuid'],
            'lines.*.quantity' => ['required', 'numeric', 'gt:0'],
            'customer_account_id' => ['nullable', 'uuid'],
            'customer_address_id' => ['nullable', 'uuid'],
            // `date_format` rather than `date`, for the reason every other date
            // on this platform is: "next Tuesday" parses happily and is not a
            // day a kitchen can schedule against.
            'requested_delivery_date' => ['nullable', 'date_format:Y-m-d'],
            'delivery_window_code' => ['nullable', 'string', 'max:40'],
        ];
    }

    /**
     * @return array{
     *     fulfilment_type: string,
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
            'branch_id' => $this->stated($validated['branch_id'] ?? null),
            'lines' => array_map(
                static fn (array $line): array => [
                    'catalogue_item_id' => (string) $line['catalogue_item_id'],
                    'catalogue_item_variant_id' => ($line['catalogue_item_variant_id'] ?? null) === null
                        ? null
                        : (string) $line['catalogue_item_variant_id'],
                    // Cast to string here rather than in the basket, because
                    // `order_lines.quantity` is a decimal column and every
                    // quantity on this platform is carried as a string from the
                    // boundary inwards. A JSON number that round-tripped through
                    // a float would acquire a fifteenth decimal place and a line
                    // total nobody could reproduce.
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
     * An empty string is not a shorter identifier, it is an absent one — and on
     * `customer_account_id` the difference decides whether this is a sale to a
     * named regular or to a stranger.
     */
    private function stated(mixed $value): ?string
    {
        $trimmed = trim((string) ($value ?? ''));

        return $trimmed === '' ? null : $trimmed;
    }
}
