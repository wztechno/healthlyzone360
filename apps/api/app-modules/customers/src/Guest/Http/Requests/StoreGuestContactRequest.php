<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Requests;

use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Verification\Enums\OtpChannel;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for "send me a passcode at this address".
 *
 * **Two channel fields, and they are not the same question.** `channel` says
 * what kind of destination this is — an address or a number — and is a property
 * of the contact point. `delivery_channel` says how the passcode should travel,
 * and is a property of the message: one phone number is reachable by SMS and by
 * WhatsApp, and which is used may differ between two codes sent to the same
 * number. Collapsing them into one field is the mistake that makes a customer
 * verify their number twice.
 *
 * `delivery_channel` is optional because the server picks better than the
 * client can. `OtpService` knows which drivers are real in this deployment and
 * falls back when one is not; a client that insisted on WhatsApp would get a
 * refusal where the server would have sent an SMS.
 *
 * **No format rule on `value`.** Whether a string is an address or a number is
 * `ContactValueNormaliser`'s judgement, and it is the same judgement that
 * decides what gets stored — a second opinion here would refuse values the
 * store accepts, or accept values it refuses, and there is no version of that
 * disagreement that ends well. `max:255` is a payload guard, not a format
 * claim.
 */
class StoreGuestContactRequest extends FormRequest
{
    /**
     * Authorisation is the route's `guest.session` middleware: holding a live
     * token *is* the standing this endpoint requires.
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
