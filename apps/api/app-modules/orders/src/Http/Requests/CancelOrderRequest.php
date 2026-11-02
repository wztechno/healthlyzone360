<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Requests;

use Healthy360\Orders\Enums\CancellationDisposition;
use Healthy360\Orders\Enums\CancellationReason;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for cancelling an order.
 *
 * **`reason` is required, and that is the whole design.** `OrderLifecycle`
 * makes the same argument from the other side: a fixed vocabulary is only
 * useful if it is never optional, because one order cancelled "for no stated
 * reason" is the row that makes every count wrong. A kitchen that wants to know
 * how many orders it lost to stock and how many customers changed their minds
 * cannot answer from a column that is sometimes null.
 *
 * An enum rather than free text, and not merely for tidiness: the answer is
 * read by machines as often as by people, free text turns a count into a search
 * problem, and it is also how a customer's name ends up in a column nobody
 * classified.
 *
 * No `note` field. It would be the free-text column this enum exists to
 * prevent, arriving under a name that made it sound optional.
 *
 * `delivery_failed` is refused here: only closing a failed delivery sets it, so
 * that the reason always means a run really came back. `disposition` is optional
 * to the shape and required by `KitchenOrderCancelController` once cooking has
 * started, because whether it is needed depends on the order, not the request.
 */
class CancelOrderRequest extends FormRequest
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
            'reason' => ['required', (new Enum(CancellationReason::class))->except(CancellationReason::DeliveryFailed)],
            'disposition' => ['nullable', new Enum(CancellationDisposition::class)],
        ];
    }

    /**
     * @return array{reason: string, disposition?: string|null}
     */
    public function payload(): array
    {
        /** @var array{reason: string, disposition?: string|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
