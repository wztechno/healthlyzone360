<?php

declare(strict_types=1);

namespace Healthy360\Identity\Exceptions;

use RuntimeException;

/**
 * A contact value could not be normalised into something sendable.
 *
 * A domain exception carrying a **stable reason string** rather than an
 * `ApiException` with an error code. J1 builds the domain ahead of its HTTP
 * surface (the OpenAPI specification and the shared `ErrorCode` enum are owned
 * by a parallel workstream this pass), and inventing wire codes here would
 * mean two vocabularies to reconcile later. The follow-up that adds the
 * controllers maps `reason()` onto `contact.*` codes in one place.
 */
final class InvalidContactValue extends RuntimeException
{
    private function __construct(private readonly string $reason, string $message)
    {
        parent::__construct($message);
    }

    public static function malformedEmail(): self
    {
        return new self('contact.malformed_email', 'That does not look like an email address.');
    }

    /**
     * The number is not in E.164.
     *
     * The message names the format rather than guessing at the country,
     * because guessing is exactly what the platform must not do until the
     * approved phone-number library lands (see `ContactValueNormaliser`).
     */
    public static function malformedPhone(): self
    {
        return new self('contact.malformed_phone', 'Enter the number in international format, starting with a plus and the country code.');
    }

    public static function alreadyVerifiedElsewhere(): self
    {
        return new self('contact.already_verified', 'That contact has already been verified on another account.');
    }

    public static function retired(): self
    {
        return new self('contact.retired', 'That contact has been removed and cannot be used again yet.');
    }

    /**
     * The stable machine key. The HTTP follow-up maps these onto the
     * `contact.*` error codes; nothing else should branch on the message.
     */
    public function reason(): string
    {
        return $this->reason;
    }
}
