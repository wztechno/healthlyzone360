<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Requests;

use Healthy360\Identity\Enums\ContactChannel;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for adding a destination to the caller's own contact list.
 *
 * **The value's shape is not checked here**, and that is not laziness. There is
 * exactly one place a contact value becomes canonical —
 * `ContactValueNormaliser` — and a rule here would be a second opinion about
 * what a valid address is. Two opinions eventually disagree, and when they do
 * the duplicate-detection index quietly stops detecting duplicates because one
 * path normalised and the other did not. The normaliser refuses with
 * `InvalidContactValue`, which renders itself; all this rule owes is a length
 * bound so an unbounded string never reaches it.
 *
 * That matters most for phone numbers. The number must already be in E.164
 * because guessing a country code would send somebody else's handset a code
 * that unlocks this account — a rule expressed here could not know that, and a
 * lenient one would let the guess happen.
 *
 * `is_login_identity` is not accepted. The login mirror is written once, at
 * registration, in the same transaction as the account; a client that could
 * nominate a second one would be moving where a password reset goes.
 *
 * Neither is `verified_at`, for the obvious reason: a contact one may declare
 * proven is a contact nobody has proven.
 */
class StoreContactRequest extends FormRequest
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
            'channel' => ['required', new Enum(ContactChannel::class)],
            'value' => ['required', 'string', 'max:255'],
            'label' => ['nullable', 'string', 'max:60'],
            'is_primary' => ['nullable', 'boolean'],
        ];
    }

    /**
     * @return array{channel: string, value: string, label?: string|null, is_primary?: bool|null}
     */
    public function payload(): array
    {
        /** @var array{channel: string, value: string, label?: string|null, is_primary?: bool|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
