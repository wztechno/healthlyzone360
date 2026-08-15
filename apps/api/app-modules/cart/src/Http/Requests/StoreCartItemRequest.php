<?php

declare(strict_types=1);

namespace Healthy360\Cart\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for adding a line to a basket.
 *
 * **Shape only.** Whether the article is published, whether the channel offers
 * it that day, whether there is a confirmed price and whether that price is in
 * the basket's currency are all `LineProbe`'s questions, and they are answered
 * against the *combined* quantity inside `CartService::addItem`. A form request
 * that tried any of them would either duplicate the probe or contradict it, and
 * `cart.line_refused` carries every reason at once in a shape a `fields` map
 * cannot express.
 *
 * `quantity` is validated as **numeric and greater than zero** rather than as
 * an integer: a line can be 0.35 kg. Zero is refused here for the reason the
 * service refuses it — removing a line is its own action, not a quantity of
 * nothing — so a client that means "delete" is told so rather than silently
 * having written a row it then has to notice is gone.
 *
 * `delivery_date` is part of the line's identity, not a decoration: two
 * quantities of the same meal for two different days are two lines, and the
 * merge in `addItem` keys on it. It is `date_format:Y-m-d` rather than `date`
 * because "next Tuesday" parses happily and is not a day this platform can
 * schedule against.
 */
class StoreCartItemRequest extends FormRequest
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
            // Existence is the probe's to establish, not an `exists` rule's:
            // the article must be one *this channel* currently offers, and a
            // bare rule would accept a retired row from another kitchen.
            'catalogue_item_id' => ['required', 'uuid'],
            'catalogue_item_variant_id' => ['nullable', 'uuid'],
            'quantity' => ['nullable', 'numeric', 'gt:0'],
            'delivery_date' => ['nullable', 'date_format:Y-m-d'],
        ];
    }

    /**
     * @return array{catalogue_item_id: string, catalogue_item_variant_id?: string|null, quantity?: int|float|string|null, delivery_date?: string|null}
     */
    public function payload(): array
    {
        /** @var array{catalogue_item_id: string, catalogue_item_variant_id?: string|null, quantity?: int|float|string|null, delivery_date?: string|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
