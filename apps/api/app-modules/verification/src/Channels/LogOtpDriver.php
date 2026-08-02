<?php

declare(strict_types=1);

namespace Healthy360\Verification\Channels;

use Healthy360\Verification\Contracts\OtpChannelDriver;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Messages\OtpDispatch;
use Illuminate\Support\Facades\Log;

/**
 * The stand-in for a channel with no provider.
 *
 * SMS and WhatsApp have no selected vendor (OQ-008, INT-005/006), and this is
 * what the platform does about it in the meantime: record that a message would
 * have been sent, and be honest that it was not. `isSimulated()` is true, so
 * the channel never reaches a production client's list and never satisfies an
 * activation requirement.
 *
 * **The code is not in the log line, and that is the point.** The obvious
 * convenience — writing the passcode where a developer can read it — is the
 * exact failure the code-leak sweep exists to catch: logs are shipped,
 * aggregated, indexed and read by people who are not the account holder. A
 * developer who needs the code in local development gets it from the challenge
 * result, gated by `verification.otp.expose_codes` and by the environment, not
 * from a log file that behaves the same way in production.
 */
final class LogOtpDriver implements OtpChannelDriver
{
    public function __construct(private readonly OtpChannel $channel) {}

    public function channel(): OtpChannel
    {
        return $this->channel;
    }

    public function isSimulated(): bool
    {
        return true;
    }

    public function send(OtpDispatch $dispatch): void
    {
        Log::info('Simulated passcode delivery.', [
            'channel' => $this->channel->value,
            'purpose' => $dispatch->purpose->value,
            'otp_challenge_id' => $dispatch->challengeId,
            'destination' => $dispatch->destinationMasked,
            'simulated' => true,
        ]);
    }
}
