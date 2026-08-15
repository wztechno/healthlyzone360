<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for opening a guest session.
 *
 * **Every field is optional, and the empty body is the normal case.** A guest
 * session is what an anonymous browser is handed before it has told us
 * anything; a required field here would mean a person cannot open a basket
 * until they have answered a question, which is the friction the whole guest
 * journey exists to remove.
 *
 * The two hints that *are* accepted are presentation preferences, not
 * references. They decide which language a passcode message is written in and
 * which market the account is recorded against — nothing joins on them, and a
 * value nobody recognises degrades to the platform default rather than
 * refusing the session. That is why there is no `exists:` rule on either: the
 * house rule against `exists:` is about identifiers a service must check
 * against a tenant's own rows, and applying a reference-table lookup here
 * would let a mistyped browser locale cost somebody their checkout.
 *
 * **The token is not an input and neither is anything about the caller.** The
 * IP and User-Agent fingerprints are hashed by the controller from what the
 * connection actually carried. Accepting them in a body would let a caller
 * choose their own fingerprint, which is the same as not having one.
 */
class StartGuestSessionRequest extends FormRequest
{
    /**
     * Anonymous by construction — there is nothing yet to authorise. The
     * refusals that matter to this endpoint are the rate limiter's.
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
            'preferred_language_code' => ['nullable', 'string', 'size:2'],
            'country_code' => ['nullable', 'string', 'size:2'],
        ];
    }

    /**
     * @return array{preferred_language_code?: string|null, country_code?: string|null}
     */
    public function payload(): array
    {
        /** @var array{preferred_language_code?: string|null, country_code?: string|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
