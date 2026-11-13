<?php

declare(strict_types=1);

namespace Healthy360\Support\Http\Controllers;

use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/staff-notifications — the caller's own recent alerts,
 * newest first, with their unread count in `meta`.
 *
 * The organisation policy says whose kitchen a row belongs to, not whose bell it
 * rings, so `user_id` is filtered here as it is on both writes. It sits under
 * `/catalogue` because `/me` routes carry no tenant context, and row-level
 * security would then return nothing.
 *
 * `unread_count` is every unread row, not the unread rows on this page, so a bell
 * can read higher than the list it opens. Of a row's `data`, only what the bell
 * draws is served: the money stays in the email.
 */
final class StaffNotificationIndexController
{
    private const int RECENT = 30;

    public function __invoke(): JsonResponse
    {
        $mine = StaffNotification::query()->where('user_id', (string) auth()->id());

        $rows = (clone $mine)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(self::RECENT)
            ->get();

        return ApiResponse::data(
            $rows->map(fn (StaffNotification $row): array => [
                'id' => (string) $row->getKey(),
                'type' => $row->type,
                'order_id' => $row->subject_id,
                'order_number' => (string) ($row->data['order_number'] ?? ''),
                'severe' => (bool) ($row->data['severe'] ?? false),
                'read_at' => $row->read_at?->toIso8601String(),
                'created_at' => $row->created_at?->toIso8601String(),
            ])->all(),
            [
                'count' => $rows->count(),
                'unread_count' => (clone $mine)->whereNull('read_at')->count(),
            ],
        );
    }
}
