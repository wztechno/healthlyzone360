<?php

declare(strict_types=1);

namespace Healthy360\Cart\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for setting a basket line to an exact quantity.
 *
 * **One field, and only one, on purpose.** The article, the pack and the
 * delivery date are what make this line *this* line — `CartService` merges on
 * exactly that triple — so changing any of them is removing a line and adding
 * another, not editing one. A PATCH that accepted `catalogue_item_id` would let
 * a client mutate a row into a different line and quietly collide with the
 * unique index that keeps baskets from growing duplicates.
 *
 * `quantity` is `required` rather than `sometimes`: an empty PATCH body would
 * otherwise be a successful no-op that still reprobed and still moved the
 * cart's validator, which is a write pretending to be a read.
 *
 * The new quantity is **reprobed** by the service, and can be refused — a
 * raise can cross a tier priced in another currency, a drop can fall below the
 * only tier that priced the article at all. Neither is visible from the number
 * alone, so no rule here can anticipate them.
 */
class UpdateCartItemRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware; a form request
     * that also guessed would give two answers to one question.
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
            'quantity' => ['required', 'numeric', 'gt:0'],
        ];
    }

    /**
     * @return array{quantity: int|float|string}
     */
    public function payload(): array
    {
        /** @var array{quantity: int|float|string} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
