<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Requests;

use Healthy360\Identity\Enums\ContactChannel;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for the passcode that proves an erasure request.
 *
 * **The address is submitted again rather than carried in a token or a
 * challenge identifier, and that is the design.** A challenge identifier
 * handed out by step one would be a nullable field — present when we hold the
 * address, absent when we do not — and a nullable identifier is a boolean in
 * disguise whose value is "this address is known to us". So step two takes the
 * same two fields step one took and looks the challenge up itself, which means
 * the second request discloses exactly as much as the first: nothing.
 *
 * The rules are shape-only for the reason `RequestGuestDeletionRequest`
 * states. No `exists`, no lookup, no rule whose outcome depends on what the
 * database holds.
 *
 * `delivery_channel` is absent here on purpose: by this point a code has
 * already travelled, or nothing has, and offering to choose a route for a
 * message that is not being sent would imply one was.
 */
class ConfirmGuestDeletionRequest extends FormRequest
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
            'channel' => ['required', new Enum(ContactChannel::class)],
            'value' => ['required', 'string', 'max:255'],
            'code' => ['required', 'string', 'max:16'],
        ];
    }

    /**
     * @return array{channel: string, value: string, code: string}
     */
    public function payload(): array
    {
        /** @var array{channel: string, value: string, code: string} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
