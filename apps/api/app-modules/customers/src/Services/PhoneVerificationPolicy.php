<?php

declare(strict_types=1);

namespace Healthy360\Customers\Services;

use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Verification\Channels\OtpChannelRegistry;

/**
 * Whether a customer must prove a phone number before their account activates.
 *
 * **Gate A-011, and the answer in production is no.**
 *
 * The source journey has a mobile OTP step, and taking it literally would be
 * the single worst decision available here: SMS and WhatsApp have no selected
 * provider (OQ-008), their drivers write to a log file, and a person cannot
 * prove possession of a number the platform cannot send to. Requiring it would
 * make every real customer permanently un-activatable while every test passed.
 *
 * So the requirement is configuration
 * (`verification.phone_required_for_activation`, default false) **and** the
 * configuration is checked against reality: even set to true, the requirement
 * only applies if some channel can actually reach a phone. Two guards for one
 * rule, because they fail differently — the flag is a business decision
 * somebody makes, and the channel check is a fact about the deployment. An
 * environment that turned the flag on before integrating a provider would
 * otherwise lock out its own customers, and the symptom would look like a bug
 * in onboarding rather than a mis-set flag.
 */
final class PhoneVerificationPolicy
{
    public function __construct(private readonly OtpChannelRegistry $channels) {}

    public function isRequired(): bool
    {
        return (bool) config('verification.phone_required_for_activation', false)
            && $this->isDeliverable();
    }

    /**
     * Whether any real (non-simulated) channel can reach a phone.
     *
     * Also the honest answer to "can we ask for a phone verification at all",
     * which the account checklist uses to decide whether to offer the step
     * rather than to invite somebody to wait for a message that will not
     * arrive.
     */
    public function isDeliverable(): bool
    {
        foreach ($this->channels->availableFor(ContactChannel::Phone) as $channel) {
            if ($channel['simulated'] === false) {
                return true;
            }
        }

        return false;
    }
}
