<?php

declare(strict_types=1);

namespace Healthy360\Verification\Exceptions;

use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Support\Api\ApiError;
use Healthy360\Support\Api\Contracts\ProvidesApiError;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Verification\Enums\OtpChannel;
use RuntimeException;

/**
 * No channel can carry a code to this destination.
 *
 * In production with no SMS provider this is the honest answer for a phone
 * number, and it is why phone verification is not an activation requirement
 * (A-011). Carrying a stable reason string rather than an `ErrorCode`: the
 * HTTP surface is a follow-up, and inventing a wire code here would mean two
 * vocabularies to reconcile.
 */
final class ChannelUnavailable extends RuntimeException implements ProvidesApiError
{
    private function __construct(private readonly string $reason, string $message)
    {
        parent::__construct($message);
    }

    public static function for(OtpChannel $channel): self
    {
        return new self('otp.channel_unavailable', "The {$channel->value} channel is not available.");
    }

    public static function forContact(ContactChannel $contact): self
    {
        return new self('otp.channel_unavailable', "No verification channel can reach a {$contact->value} contact right now.");
    }

    public function reason(): string
    {
        return $this->reason;
    }

    public function toApiError(): ApiError
    {
        return ApiError::make(ErrorCode::OtpChannelUnavailable, $this->getMessage(), ['reason' => $this->reason]);
    }
}
