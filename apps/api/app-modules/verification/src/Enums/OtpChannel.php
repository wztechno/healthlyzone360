<?php

declare(strict_types=1);

namespace Healthy360\Verification\Enums;

use Healthy360\Identity\Enums\ContactChannel;

/**
 * How a passcode travels.
 *
 * Distinct from `ContactChannel`, which says what *kind* of destination a
 * contact point is. One phone number is reachable three ways, and the two
 * enums exist so a customer verifies their number once and the platform
 * chooses SMS or WhatsApp per message — including falling back when one is
 * unavailable, which is the whole reason the OTP framework carries a channel
 * list at all.
 */
enum OtpChannel: string
{
    case Email = 'email';

    case Sms = 'sms';

    case Whatsapp = 'whatsapp';

    /**
     * The channels that can carry a code to this kind of destination, in
     * preference order.
     *
     * @return list<self>
     */
    public static function forContact(ContactChannel $contact): array
    {
        return match ($contact) {
            ContactChannel::Email => [self::Email],
            ContactChannel::Phone => [self::Sms, self::Whatsapp],
        };
    }

    /**
     * The destination kind this channel delivers to — the inverse, used to
     * refuse an SMS to an email address before a driver has to.
     */
    public function contactChannel(): ContactChannel
    {
        return $this === self::Email ? ContactChannel::Email : ContactChannel::Phone;
    }
}
