<?php

declare(strict_types=1);

namespace Healthy360\Identity\Services;

use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Exceptions\InvalidContactValue;

/**
 * The one place a contact value becomes canonical.
 *
 * Every comparison, every hash and every message uses the output of this
 * class, so `Ali@Example.COM ` and `ali@example.com` are one contact and not
 * two. Normalisation that happened at three call sites would be three
 * normalisations, and the duplicate-detection index would quietly stop
 * detecting duplicates.
 *
 * **Phone numbers are validated for shape, not for existence.** The number
 * must already be in E.164 — a leading `+`, a country code, 8 to 15 digits —
 * and everything cosmetic (spaces, dashes, brackets, dots) is stripped. What
 * this class deliberately does *not* do is infer a country code from a local
 * number, because doing that correctly needs
 * `giggsey/libphonenumber-for-php-lite`, which is a dependency awaiting
 * approval (appendix C). Guessing "+961" for a Lebanese-looking string would
 * send somebody else's phone a code that unlocks this account, so the honest
 * behaviour until the library is approved is to refuse and say what format is
 * wanted. The client collects a country code; the server does not invent one.
 */
final class ContactValueNormaliser
{
    /**
     * The canonical form of a value on this channel.
     *
     * @throws InvalidContactValue
     */
    public function normalise(ContactChannel $channel, string $value): string
    {
        return match ($channel) {
            ContactChannel::Email => $this->email($value),
            ContactChannel::Phone => $this->phone($value),
        };
    }

    /**
     * @throws InvalidContactValue
     */
    private function email(string $value): string
    {
        $trimmed = mb_strtolower(trim($value));

        if (filter_var($trimmed, FILTER_VALIDATE_EMAIL) === false) {
            throw InvalidContactValue::malformedEmail();
        }

        return $trimmed;
    }

    /**
     * @throws InvalidContactValue
     */
    private function phone(string $value): string
    {
        $stripped = preg_replace('/[\s\-().]/', '', trim($value)) ?? '';

        if (preg_match('/^\+[1-9]\d{7,14}$/', $stripped) !== 1) {
            throw InvalidContactValue::malformedPhone();
        }

        return $stripped;
    }

    /**
     * What a client may be shown in place of the value it did not supply.
     *
     * Server-authored, always: a masked destination is the one part of a
     * challenge that tells an unauthenticated caller something about an
     * account, so the amount revealed is a server decision. Email keeps the
     * first character of the local part and the whole domain — enough for the
     * owner to recognise their own address, not enough to reconstruct one. A
     * phone keeps its last two digits, which is what a person checks against
     * the handset in their hand.
     */
    public function mask(ContactChannel $channel, string $normalised): string
    {
        return match ($channel) {
            ContactChannel::Email => $this->maskEmail($normalised),
            ContactChannel::Phone => $this->maskPhone($normalised),
        };
    }

    private function maskEmail(string $normalised): string
    {
        $at = mb_strpos($normalised, '@');

        if ($at === false || $at === 0) {
            return '•••';
        }

        return mb_substr($normalised, 0, 1).str_repeat('•', max(1, $at - 1)).mb_substr($normalised, $at);
    }

    private function maskPhone(string $normalised): string
    {
        $digits = mb_strlen($normalised) - 1;

        if ($digits <= 2) {
            return '•••';
        }

        return '+'.str_repeat('•', $digits - 2).mb_substr($normalised, -2);
    }
}
