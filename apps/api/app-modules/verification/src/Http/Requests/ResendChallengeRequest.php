<?php

declare(strict_types=1);

namespace Healthy360\Verification\Http\Requests;

use Healthy360\Verification\Enums\OtpChannel;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for asking for the same challenge again.
 *
 * `channel` exists because "try another way" is a real button: a challenge
 * result carries `available_channels`, and an endpoint that could not accept
 * one of them back would make that field decorative. It is optional, and its
 * absence means "the same way as last time" rather than "the default for this
 * contact" — a person who chose WhatsApp once should not be quietly moved back
 * to SMS by pressing resend.
 *
 * A channel that cannot reach this destination is refused by the service, not
 * here: `ChannelUnavailable` knows which channels *would* work and says so in
 * `details.available_channels`, and a rule here could only manage "invalid".
 */
class ResendChallengeRequest extends FormRequest
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
            'channel' => ['nullable', new Enum(OtpChannel::class)],
        ];
    }

    /**
     * @return array{channel?: string|null}
     */
    public function payload(): array
    {
        /** @var array{channel?: string|null} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
