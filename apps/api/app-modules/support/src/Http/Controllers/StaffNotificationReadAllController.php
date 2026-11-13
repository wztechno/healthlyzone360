<?php

declare(strict_types=1);

namespace Healthy360\Support\Http\Controllers;

use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Http\Response;

/**
 * POST /api/v1/catalogue/staff-notifications/read-all — marks every one of the
 * caller's own alerts read, including those older than the page the bell shows.
 * A colleague's unread rows are untouched: see `StaffNotificationReadController`.
 */
final class StaffNotificationReadAllController
{
    public function __invoke(): Response
    {
        StaffNotification::query()
            ->where('user_id', (string) auth()->id())
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        return ApiResponse::noContent();
    }
}
