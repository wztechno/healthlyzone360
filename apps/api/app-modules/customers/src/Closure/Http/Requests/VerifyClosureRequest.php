<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for the passcode that proves an erasure.
 *
 * One field, and the rules are shape only: a code of the wrong length is
 * refused here rather than spent as an attempt against the challenge, which
 * matters because three wrong codes close it. Whether the code is *correct* is
 * `OtpService`'s, and every way of being wrong — mistyped, expired, superseded,
 * locked out — comes back as one indistinguishable refusal, because
 * distinguishing them tells an attacker holding a borrowed session which of
 * their guesses was closest.
 *
 * There is no `request_id` in the body. The request is in the path, and the
 * challenge is bound to it on the row — `account_closure_requests.otp_challenge_id`
 * — which is what stops a code obtained for one closure finalising another,
 * including a support-initiated one the customer never agreed to.
 */
class VerifyClosureRequest extends FormRequest
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
            'code' => ['required', 'string', 'min:4', 'max:12'],
        ];
    }
}
