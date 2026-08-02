<?php

declare(strict_types=1);

namespace Healthy360\Verification\Results;

use Carbon\CarbonImmutable;
use Healthy360\Verification\Models\OtpChallenge;

/**
 * What a caller learns when a challenge is issued or resent.
 *
 * The shape is forced by the journey, not chosen for convenience (appendix E,
 * "five journey-forced shapes"). Every one of these fields exists because a
 * screen cannot be built without it:
 *
 *  * `resendAvailableAt` / `resendCooldownSeconds` — the resend button is
 *    disabled with a countdown from the moment the challenge is read, not from
 *    the moment the client happened to render. A client computing this from
 *    its own clock gets it wrong for exactly the users whose clocks are wrong.
 *  * `attemptsRemaining` — "2 tries left" is the difference between a person
 *    retyping carefully and a person locked out without warning.
 *  * `destinationMasked` — **server-authored**. The client never sees the
 *    address, so it cannot mask it; and a client-side mask of a value the
 *    client was given would mean the value was given.
 *  * `availableChannels` — what "try another way" may offer, with `simulated`
 *    on each. Simulated channels are absent outside local and testing.
 *  * `debugCode` — populated only when `verification.otp.expose_codes` is set
 *    *and* the environment is local or testing, so the developer affordance
 *    for the channels that do not really deliver cannot exist in production.
 */
final readonly class OtpChallengeResult
{
    /**
     * @param  list<array{channel: string, simulated: bool}>  $availableChannels
     */
    public function __construct(
        public OtpChallenge $challenge,
        public string $destinationMasked,
        public CarbonImmutable $expiresAt,
        public CarbonImmutable $resendAvailableAt,
        public int $resendCooldownSeconds,
        public int $attemptsRemaining,
        public int $resendsRemaining,
        public array $availableChannels,
        public bool $simulated,
        public ?string $debugCode = null,
    ) {}

    /**
     * The controller-ready payload. Presented here rather than in a presenter
     * because the HTTP layer is a follow-up and this is the shape it will
     * serialise; keeping it beside the fields means the two cannot drift while
     * they are apart.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $payload = [
            'challenge_id' => (string) $this->challenge->getKey(),
            'purpose' => $this->challenge->purpose->value,
            'channel' => $this->challenge->channel->value,
            'destination_masked' => $this->destinationMasked,
            'expires_at' => $this->expiresAt->toIso8601String(),
            'resend_available_at' => $this->resendAvailableAt->toIso8601String(),
            'resend_cooldown_seconds' => $this->resendCooldownSeconds,
            'attempts_remaining' => $this->attemptsRemaining,
            'resends_remaining' => $this->resendsRemaining,
            'available_channels' => $this->availableChannels,
            'simulated' => $this->simulated,
        ];

        if ($this->debugCode !== null) {
            $payload['debug_code'] = $this->debugCode;
        }

        return $payload;
    }
}
