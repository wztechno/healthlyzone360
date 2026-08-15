<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for ending a subscription for good.
 *
 * One optional field, and it is a short vocabulary word rather than prose. The
 * column is `varchar(40)` and the journal writes it into `audit_logs` metadata,
 * where a free-text box filled in by somebody in an unhappy moment is how a
 * name, an address or a complaint about a named member of staff ends up in a
 * table nobody classified — the argument `ClosureReasonCode` makes at greater
 * length one module over.
 *
 * It defaults to `customer_request` in the service rather than here, so the
 * console and the queue reach the same default as HTTP.
 *
 * There is no confirmation flag. `cancelled` is terminal and irreversible, and
 * a `{"confirm": true}` field would be a confirmation the server cannot verify
 * anybody saw — the confirmation belongs in the client, and what the platform
 * owes in exchange is the credit memo this call returns.
 */
class CancelSubscriptionRequest extends FormRequest
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
            'reason' => ['nullable', 'string', 'max:40', 'regex:/^[a-z][a-z0-9_]*$/'],
        ];
    }
}
