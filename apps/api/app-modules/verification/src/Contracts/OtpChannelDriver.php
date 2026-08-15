<?php

declare(strict_types=1);

namespace Healthy360\Verification\Contracts;

use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Messages\OtpDispatch;

/**
 * How a passcode reaches a person.
 *
 * The interface exists because exactly one of the three channels is real. Mail
 * delivers; SMS and WhatsApp have no provider selected (OQ-008, INT-005/006)
 * and are served by a log driver. Writing the SMS path against an interface
 * now means the day a provider is chosen, one class is added and nothing else
 * changes — and, more importantly, it means the substitute is a *declared*
 * substitute rather than a `// TODO` in the middle of the send path.
 *
 * `isSimulated()` is the honesty flag that keeps that declaration visible all
 * the way to the client (master plan v2 §3 #16). A driver that pretends to
 * deliver must say so, because the alternative is a customer waiting for a
 * message that was written to a log file.
 */
interface OtpChannelDriver
{
    public function channel(): OtpChannel;

    /**
     * Whether this driver only appears to deliver.
     *
     * Never inferred from the environment by the driver itself — it is a
     * property of the driver, and `OtpChannelRegistry` is what decides whether
     * a simulated channel may be offered at all.
     */
    public function isSimulated(): bool;

    /**
     * Deliver the passcode.
     *
     * Runs inside `SendOtpMessage`, which is queued and encrypted, so a driver
     * may block on a network call without holding a request open — and must
     * not log the code it was given.
     */
    public function send(OtpDispatch $dispatch): void;
}
