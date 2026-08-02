<?php

declare(strict_types=1);

namespace Healthy360\Identity\Enums;

/**
 * The kind of destination a contact point names.
 *
 * Deliberately *not* the transport. An email address has one way to reach it;
 * a phone number has three (SMS, WhatsApp, a voice call), and which one is
 * used is a property of the message, not of the number. Modelling the channel
 * as `sms | whatsapp | email` here — the shape the OTP challenge uses — would
 * mean storing the same number twice and asking a customer to verify it twice.
 */
enum ContactChannel: string
{
    case Email = 'email';

    case Phone = 'phone';
}
