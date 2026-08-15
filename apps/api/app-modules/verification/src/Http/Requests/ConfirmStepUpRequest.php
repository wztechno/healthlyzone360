<?php

declare(strict_types=1);

namespace Healthy360\Verification\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for spending a step-up passcode.
 *
 * The challenge is named in the body rather than in the path, unlike every
 * other verification endpoint, and that is the shape the journey forces: this
 * is one confirmation surface behind which two purposes sit, and a client that
 * has just been refused with `auth.step_up_required` holds a challenge
 * identifier and a code, not a resource it is navigating to.
 *
 * Whether the challenge is the caller's own, and whether its purpose grants a
 * step-up at all, are questions about a row and cannot be asked here. They are
 * asked in the controller, where a challenge belonging to somebody else is
 * indistinguishable from one that does not exist.
 *
 * `code` is a string of digits for the reason spelled out in
 * `VerifyChallengeRequest`: an integer cast eats leading zeros.
 */
class ConfirmStepUpRequest extends FormRequest
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
            'challenge_id' => ['required', 'uuid'],
            'code' => ['required', 'string', 'regex:/^[0-9]{4,10}$/'],
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
