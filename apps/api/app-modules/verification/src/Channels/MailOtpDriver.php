<?php

declare(strict_types=1);

namespace Healthy360\Verification\Channels;

use Healthy360\Verification\Contracts\OtpChannelDriver;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Mail\OtpMessage;
use Healthy360\Verification\Messages\OtpDispatch;
use Illuminate\Support\Facades\Mail;

/**
 * The one channel that really delivers.
 *
 * Mail is why the email-only activation path is the production default
 * (A-011): it is the single destination the platform can actually reach today,
 * so it is the only one an account's usability may depend on.
 */
final class MailOtpDriver implements OtpChannelDriver
{
    public function channel(): OtpChannel
    {
        return OtpChannel::Email;
    }

    public function isSimulated(): bool
    {
        return false;
    }

    public function send(OtpDispatch $dispatch): void
    {
        Mail::to($dispatch->destination)->send(new OtpMessage($dispatch));
    }
}
