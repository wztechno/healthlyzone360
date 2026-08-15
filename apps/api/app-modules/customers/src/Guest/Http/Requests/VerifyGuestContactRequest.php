<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for submitting a passcode against a guest's own challenge.
 *
 * **No `exists:` on `challenge_id`, and here the reason is sharper than the
 * house rule's.** A validation rule would answer "no such challenge" as a
 * `422` on a field, which is a different answer from the one an identifier
 * belonging to *somebody else's* account gets — and the difference is a free
 * "is this a real challenge" oracle. The controller resolves the row scoped to
 * the session's customer account and answers `404` for both, which is the only
 * shape that discloses nothing.
 *
 * **No length rule on `code`.** How long a passcode is belongs to
 * `verification.otp.length`; a form request that restated `size:6` would become
 * a second authority and would start refusing valid codes on the day an
 * operator lengthened them. `max:16` is a payload guard.
 *
 * The code is a `string`, never an integer. A passcode with a leading zero is a
 * passcode, and JSON numbers eat leading zeros.
 */
class VerifyGuestContactRequest extends FormRequest
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
            'challenge_id' => ['required', 'uuid'],
            'code' => ['required', 'string', 'max:16'],
        ];
    }

    /**
     * @return array{challenge_id: string, code: string}
     */
    public function payload(): array
    {
        /** @var array{challenge_id: string, code: string} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
