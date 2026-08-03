<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Requests;

use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Verification\Enums\OtpChannel;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for "delete everything you hold about this address".
 *
 * **Every rule here is a rule about the *shape* of the submission and none is
 * a rule about the world.** That is the constraint an unauthenticated erasure
 * endpoint imposes on its own validation layer: a rule that consulted the
 * database — `exists`, `unique`, a custom rule that looked anything up — would
 * produce a refusal that only a value we hold can produce, and the endpoint
 * would become the enumeration oracle `GuestDeletionService` was built to
 * refuse being. A syntax refusal discloses nothing, because it is derived
 * entirely from what the caller just typed.
 *
 * `value` therefore carries no format rule beyond a length guard, for the same
 * reason `StoreGuestContactRequest` gives: `ContactValueNormaliser` is the
 * single judgement about what an address or a number is, and it raises
 * `InvalidContactValue` — which renders itself — when the string is not one.
 *
 * `delivery_channel` is accepted and is a *hint*. If the address is unknown
 * nothing is sent at all, and the field changes nothing; if it is known,
 * `OtpService` may still fall back to a channel that exists in this deployment.
 * Neither outcome is visible in the response.
 */
class RequestGuestDeletionRequest extends FormRequest
{
    /**
     * Anonymous, necessarily. A guest has no account to sign into — that is
     * the definition of a guest — so the proof is the passcode that follows,
     * never a credential on this request.
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
            'channel' => ['required', new Enum(ContactChannel::class)],
            'value' => ['required', 'string', 'max:255'],
            'delivery_channel' => ['nullable', new Enum(OtpChannel::class)],
        ];
    }

    /**
     * @return array{channel: string, value: string, delivery_channel?: string|null}
     */
    public function payload(): array
    {
        /** @var array{channel: string, value: string, delivery_channel?: string|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
