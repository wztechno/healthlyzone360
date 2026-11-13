<?php

declare(strict_types=1);

namespace Healthy360\Support\Http\Controllers;

use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Http\Response;

/**
 * POST /api/v1/catalogue/staff-notifications/{notification}/read — marks one of
 * the caller's own alerts read.
 *
 * A colleague's row is a `404`, not a `403`: the organisation policy lets the
 * query see it, so `user_id` is what makes it nobody else's to touch, and saying
 * "forbidden" would confirm the row exists. Reading a row twice keeps the first
 * `read_at`.
 */
final class StaffNotificationReadController
{
    /**
     * @throws ApiException
     */
    public function __invoke(string $notification): Response
    {
        $row = StaffNotification::query()
            ->where('user_id', (string) auth()->id())
            ->whereKey($notification)
            ->first();

        if (! $row instanceof StaffNotification) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        if ($row->read_at === null) {
            $row->forceFill(['read_at' => now()])->save();
        }

        return ApiResponse::noContent();
    }
}
