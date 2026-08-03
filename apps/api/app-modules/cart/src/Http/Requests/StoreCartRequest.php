<?php

declare(strict_types=1);

namespace Healthy360\Cart\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for opening (or re-finding) a basket.
 *
 * **One field, and it is a code rather than an identifier.** A shopper knows
 * they are buying through the consumer web channel; they do not hold a channel
 * UUID, and a client that had to fetch one first would need a kitchen-admin
 * read permission to do it. The code is resolved across organisations, which is
 * what makes "which kitchen is this" the server's answer rather than the
 * client's assertion.
 *
 * `organisation_id` is deliberately **not** accepted. It comes from the channel
 * the code names, and a body that could state the seller independently would be
 * two answers to one question — the second of which a client could get wrong
 * and open a basket owned by a kitchen that does not run the channel.
 *
 * `branch_id` is not accepted either, though `CartService::getOrCreate` takes
 * one. Choosing where the food is produced is a decision made later, on a
 * screen that can show cut-offs and delivery terms, and accepting it at
 * open-time would let a client pick a kitchen location before the customer has
 * seen one. When that screen exists it gets its own endpoint.
 */
class StoreCartRequest extends FormRequest
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
            // No `exists:` rule, the K1.2 reason applied to a customer
            // surface: the row must be an *active* channel, and a bare rule
            // would happily accept a switched-off one. The locator answers
            // 404 for both, so the two cases stay indistinguishable.
            'channel_code' => ['required', 'string', 'max:40'],
        ];
    }

    /**
     * @return array{channel_code: string}
     */
    public function payload(): array
    {
        /** @var array{channel_code: string} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
