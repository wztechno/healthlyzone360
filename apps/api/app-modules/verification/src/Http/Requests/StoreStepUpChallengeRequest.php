<?php

declare(strict_types=1);

namespace Healthy360\Verification\Http\Requests;

use Healthy360\Verification\Enums\OtpPurpose;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for asking for a step-up passcode.
 *
 * The purpose is restricted to the two the enum says grant a step-up, and the
 * list is **derived from `OtpPurpose::grantsStepUp()`** rather than written out
 * here. That is the point of the whole purpose column: a code obtained for
 * contact verification must not unlock a payment change, and a second hand-kept
 * list would be the place that eventually disagrees with the first. A future
 * purpose becomes issuable here by saying so on the enum, which is also where
 * the consumer checks it.
 *
 * `channel` is deliberately absent. A step-up is sent to the destination the
 * account has already proven, and letting the caller pick the transport for a
 * challenge that unlocks account closure would hand an attacker the one
 * decision the server should be making.
 */
class StoreStepUpChallengeRequest extends FormRequest
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
            'purpose' => ['required', 'string', Rule::in($this->stepUpPurposes())],
        ];
    }

    /**
     * @return array{purpose: string}
     */
    public function payload(): array
    {
        /** @var array{purpose: string} $validated */
        $validated = $this->validated();

        return $validated;
    }

    /**
     * @return list<string>
     */
    private function stepUpPurposes(): array
    {
        return array_values(array_map(
            static fn (OtpPurpose $purpose): string => $purpose->value,
            array_filter(
                OtpPurpose::cases(),
                static fn (OtpPurpose $purpose): bool => $purpose->grantsStepUp(),
            ),
        ));
    }
}
