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
 * **`kitchen_id` is accepted, and it is not that second answer.** A channel code
 * is unique per organisation, not per platform: every kitchen on the marketplace
 * trades through its own `web-shop`. A bare code therefore names a *kind* of
 * channel, and resolving it "across organisations" picked whichever kitchen's
 * row the database returned first — so a shopper's basket belonged to one
 * arbitrary kitchen and every other kitchen's meal was refused (browse-03). The
 * kitchen narrows the code to one row; it does not assert a seller the channel
 * disagrees with, because the locator only ever returns a channel that kitchen
 * owns, and a kitchen without one is the same 404 an unknown code is. A
 * marketplace kitchen *is* its organisation (`MarketplaceMealPresenter`
 * publishes `organisation_id` as `kitchen_id`), so the field names what the
 * client already holds. Omitted, the code resolves to the basket the shopper
 * already has open on it — see `CartLocator::channelForShopper`.
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
            // No `exists:` rule for the same reason: a kitchen that does not
            // exist and one that does not trade through this code are both
            // the locator's 404. `uuid` stays, because a malformed value would
            // otherwise reach a uuid column and fail as a server error.
            'kitchen_id' => ['sometimes', 'nullable', 'uuid'],
        ];
    }

    /**
     * @return array{channel_code: string, kitchen_id: string|null}
     */
    public function payload(): array
    {
        /** @var array{channel_code: string, kitchen_id?: string|null} $validated */
        $validated = $this->validated();

        return [
            'channel_code' => $validated['channel_code'],
            'kitchen_id' => $validated['kitchen_id'] ?? null,
        ];
    }
}
