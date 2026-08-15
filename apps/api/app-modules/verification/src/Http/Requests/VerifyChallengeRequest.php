<?php

declare(strict_types=1);

namespace Healthy360\Verification\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for submitting a passcode.
 *
 * The code is validated as a **string of digits**, never as an integer, because
 * leading zeros are half the reason the generator pads them: `012345` cast to a
 * number becomes `12345`, which is a different code and would fail against a
 * challenge that is perfectly correct. The keyspace is only a million wide, so
 * throwing a tenth of it away at the parsing layer is not a rounding error.
 *
 * The length is a range rather than the configured six. `verification.otp.length`
 * is an operator setting and a validation rule that hard-coded today's value
 * would silently reject every code the moment somebody widened it.
 *
 * There is no `challenge_id` here: the challenge is the route's own path
 * segment, and a body that could name a different one would be two answers to
 * the question of which credential is being spent.
 */
class VerifyChallengeRequest extends FormRequest
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
            'code' => ['required', 'string', 'regex:/^[0-9]{4,10}$/'],
        ];
    }

    /**
     * @return array{code: string}
     */
    public function payload(): array
    {
        /** @var array{code: string} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
