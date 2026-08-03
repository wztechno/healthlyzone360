<?php

declare(strict_types=1);

namespace Healthy360\B2b\Exceptions;

use Healthy360\Support\Api\ApiError;
use Healthy360\Support\Api\Contracts\ProvidesApiError;
use Healthy360\Support\Api\ErrorCode;
use RuntimeException;

/**
 * A records bundle could not be handed over.
 *
 * Stable reason strings rather than error codes, per the convention: the wire
 * vocabulary belongs to the HTTP follow-up. Both reasons map onto codes that
 * already exist, so B2 adds nothing to the shared `ErrorCode` enum.
 *
 * `not_downloadable` deliberately answers with a conflict rather than a 404.
 * The caller is looking at an export that exists and that they may see — it is
 * still building, or its window has closed and the bytes are gone — and the
 * status is in `details` so a client can say which of those it is. A 404 would
 * be a lie about a row the caller can already list.
 */
final class RecordExportRefused extends RuntimeException implements ProvidesApiError
{
    /**
     * @param  array<string, scalar|null>  $details
     */
    private function __construct(
        private readonly string $reason,
        string $message,
        private readonly array $details = [],
    ) {
        parent::__construct($message);
    }

    public static function purposeRequired(): self
    {
        return new self(
            'record_export.purpose_required',
            'Downloading a records bundle has to say what it is for.',
        );
    }

    public static function notDownloadable(string $status): self
    {
        return new self(
            'record_export.not_downloadable',
            'This bundle is not available to download.',
            ['status' => $status],
        );
    }

    public function reason(): string
    {
        return $this->reason;
    }

    public function toApiError(): ApiError
    {
        $code = $this->reason === 'record_export.purpose_required'
            ? ErrorCode::ValidationFailed
            : ErrorCode::ResourceConflict;

        return ApiError::make($code, $this->getMessage(), ['reason' => $this->reason] + $this->details);
    }
}
