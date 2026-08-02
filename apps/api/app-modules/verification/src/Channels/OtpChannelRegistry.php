<?php

declare(strict_types=1);

namespace Healthy360\Verification\Channels;

use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Verification\Contracts\OtpChannelDriver;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Exceptions\ChannelUnavailable;

/**
 * Which channels exist, which of them are real, and which a caller may see.
 *
 * **`simulatedChannels` is a non-production concept** (master plan v2 §3 #16).
 * A production client is offered only channels that deliver; a local or test
 * client is offered the simulated ones as well, flagged. Deciding that here
 * rather than in each driver keeps the environment check in one place, and
 * makes "could a production customer end up waiting for an SMS that went to a
 * log file" a question with a single answer.
 *
 * The configuration maps a channel to a driver name rather than to a class, so
 * switching SMS from `log` to a real provider is a configuration change plus
 * one registered driver — and the switch is visible in `config/verification.php`
 * where an operator looks, not buried in a service provider.
 */
final class OtpChannelRegistry
{
    /**
     * @param  array<string, OtpChannelDriver>  $drivers  keyed by channel value
     */
    public function __construct(private readonly array $drivers) {}

    /**
     * @throws ChannelUnavailable
     */
    public function driverFor(OtpChannel $channel): OtpChannelDriver
    {
        $driver = $this->drivers[$channel->value] ?? null;

        if ($driver === null || ! $this->isEnabled($channel)) {
            throw ChannelUnavailable::for($channel);
        }

        return $driver;
    }

    /**
     * The channels that can carry a code to this kind of destination, as the
     * client should see them.
     *
     * Simulated channels are omitted outside local and testing. A client that
     * cannot see a channel cannot pick it, so the filter here is also the
     * enforcement — `driverFor()` is reached only through a channel this
     * method returned or through an explicit server-side choice.
     *
     * @return list<array{channel: string, simulated: bool}>
     */
    public function availableFor(ContactChannel $contact): array
    {
        $available = [];

        foreach (OtpChannel::forContact($contact) as $channel) {
            $driver = $this->drivers[$channel->value] ?? null;

            if ($driver === null || ! $this->isEnabled($channel)) {
                continue;
            }

            if ($driver->isSimulated() && ! $this->mayOfferSimulated()) {
                continue;
            }

            $available[] = ['channel' => $channel->value, 'simulated' => $driver->isSimulated()];
        }

        return $available;
    }

    /**
     * The channel a code goes out on when the caller does not choose, or null
     * when nothing can reach this kind of destination at all.
     *
     * Null is a real answer in production for a phone: with SMS and WhatsApp
     * both simulated, there is genuinely no way to reach a number, and the
     * activation rules are configured to match (A-011). Returning a channel
     * that cannot deliver would be the lie those rules exist to avoid.
     */
    public function defaultFor(ContactChannel $contact): ?OtpChannel
    {
        $available = $this->availableFor($contact);

        return $available === [] ? null : OtpChannel::from($available[0]['channel']);
    }

    /**
     * Whether a channel delivers for real — what an activation rule must ask
     * before it can require a verified destination of that kind.
     */
    public function isReal(OtpChannel $channel): bool
    {
        $driver = $this->drivers[$channel->value] ?? null;

        return $driver !== null && $this->isEnabled($channel) && ! $driver->isSimulated();
    }

    private function isEnabled(OtpChannel $channel): bool
    {
        return (bool) config('verification.channels.'.$channel->value.'.enabled', false);
    }

    private function mayOfferSimulated(): bool
    {
        return app()->environment(['local', 'testing']);
    }
}
