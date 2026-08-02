<?php

declare(strict_types=1);

namespace Healthy360\Verification\Messages;

use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Enums\OtpPurpose;

/**
 * Everything a driver needs to send one passcode, and nothing else.
 *
 * A value object rather than the challenge model on purpose. This is the only
 * object in the system that carries the plaintext code, so it travels between
 * exactly two places — the service that generated it and the driver that sends
 * it — and it can be reasoned about in isolation: nothing here is persisted,
 * and the queued job that carries it declares `ShouldBeEncrypted`.
 *
 * `expiresInSeconds` rather than an absolute time, because the message says
 * "expires in 5 minutes" and computing that from a timestamp at render time
 * would drift by however long the message sat in the queue.
 */
final readonly class OtpDispatch
{
    public function __construct(
        public string $challengeId,
        public OtpChannel $channel,
        public OtpPurpose $purpose,
        public string $destination,
        public string $destinationMasked,
        public string $code,
        public int $expiresInSeconds,
        public string $locale,
        public string $direction,
        public ?string $recipientName = null,
    ) {}
}
