<?php

declare(strict_types=1);

namespace Healthy360\Verification\Jobs;

use Healthy360\Verification\Channels\OtpChannelRegistry;
use Healthy360\Verification\Messages\OtpDispatch;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Deliver one passcode.
 *
 * **`ShouldBeEncrypted` is the reason this job exists as its own class.** The
 * payload carries the plaintext code, and a queue payload is written to Redis
 * or to a database table where it sits until a worker picks it up — in plain
 * text, by default, readable by anything with the connection. Encrypting the
 * payload means the only decrypted copy of a code lives in the worker's memory
 * for the duration of one send. The code-leak sweep asserts exactly this: the
 * literal must not appear in a serialised payload.
 *
 * **Queued rather than sent inline** so an SMTP timeout cannot hold the
 * request that issued the challenge — the challenge is already committed, and
 * a client waiting on the mail server would see a failure for a code that was
 * successfully issued.
 *
 * `notifications` queue, kept separate from `default` so a backlog of domain
 * work never delays a code somebody is staring at a screen waiting for.
 *
 * Three tries with a backoff, and no retry after that: a passcode has a
 * five-minute life, so a fourth attempt several minutes later would deliver a
 * code that no longer works and would look, to the person receiving it, like a
 * second unexplained message.
 */
final class SendOtpMessage implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [5, 15];

    public function __construct(public readonly OtpDispatch $dispatch)
    {
        $this->onQueue('notifications');
    }

    public function handle(OtpChannelRegistry $channels): void
    {
        $channels->driverFor($this->dispatch->channel)->send($this->dispatch);
    }

    /**
     * Tags carry the challenge, never the destination and never the code, so a
     * Horizon dashboard cannot become the leak the encryption prevented.
     *
     * @return list<string>
     */
    public function tags(): array
    {
        return [
            'otp',
            'otp:'.$this->dispatch->channel->value,
            'otp-challenge:'.$this->dispatch->challengeId,
        ];
    }
}
