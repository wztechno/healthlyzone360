<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Enums;

use Healthy360\Identity\Enums\ContactChannel;

/**
 * The kind of destination a suppression covers.
 *
 * Values identical to `ContactChannel` — they have to be, because the digests
 * on both tables are produced by the same hasher and compared to each other —
 * but a separate type, because `marketing_suppressions` deliberately holds no
 * foreign key into the contact-point graph. The suppression outlives every row
 * it was derived from; that is the point of it. Typing the column as the
 * identity module's enum would suggest a relationship that must not exist and
 * would put a Customers → Identity coupling on a table that reads nothing from
 * identity.
 *
 * `forChannel()` is the one crossing point, and it is explicit for that reason.
 * It is not named `from()`, which a backed enum already declares.
 */
enum SuppressionKind: string
{
    case Email = 'email';

    case Phone = 'phone';

    public static function forChannel(ContactChannel $channel): self
    {
        return match ($channel) {
            ContactChannel::Email => self::Email,
            ContactChannel::Phone => self::Phone,
        };
    }

    public function channel(): ContactChannel
    {
        return match ($this) {
            self::Email => ContactChannel::Email,
            self::Phone => ContactChannel::Phone,
        };
    }
}
