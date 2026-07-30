<?php

declare(strict_types=1);

namespace Healthy360\Support\Api\Exceptions;

use Healthy360\Support\Api\ApiError;
use Healthy360\Support\Api\ErrorCode;
use RuntimeException;
use Throwable;

/**
 * Base class for every deliberate API failure. Throwing one of these is the
 * only supported way for application code to choose an error code and HTTP
 * status; the exception handler renders it into the error envelope, so no
 * call site ever builds an error body by hand.
 *
 * Deliberately not `renderable()`: exposing a render() method would let the
 * framework bypass the central renderer and lose the correlation identifier.
 */
class ApiException extends RuntimeException
{
    /**
     * @param  array<string, mixed>  $details
     */
    public function __construct(
        public readonly ErrorCode $errorCode,
        ?string $message = null,
        public readonly array $details = [],
        private readonly ?int $status = null,
        ?Throwable $previous = null,
    ) {
        parent::__construct($message ?? $errorCode->message(), 0, $previous);
    }

    public function status(): int
    {
        return $this->status ?? $this->errorCode->status();
    }

    public function toApiError(): ApiError
    {
        return new ApiError($this->errorCode, $this->getMessage(), $this->details, $this->status());
    }
}
