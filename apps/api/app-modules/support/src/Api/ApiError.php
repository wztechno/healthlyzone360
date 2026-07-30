<?php

declare(strict_types=1);

namespace Healthy360\Support\Api;

/**
 * The payload of the API error envelope: exactly one code, one safe message,
 * structured code-specific details and the HTTP status it is served with.
 * The correlation identifier is added by ApiResponse, so it can never be
 * forgotten by a caller.
 */
final readonly class ApiError
{
    /**
     * @param  array<string, mixed>  $details
     */
    public function __construct(
        public ErrorCode $code,
        public string $message,
        public array $details = [],
        public int $status = 500,
    ) {}

    /**
     * @param  array<string, mixed>  $details
     */
    public static function make(ErrorCode $code, ?string $message = null, array $details = [], ?int $status = null): self
    {
        return new self($code, $message ?? $code->message(), $details, $status ?? $code->status());
    }
}
