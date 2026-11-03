<?php

declare(strict_types=1);

namespace Healthy360\Audit\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/v1/catalogue/activity — the kitchen's audit trail, newest first, for an
 * owner investigating a number. The first route on `audit.view_organisation`.
 *
 * Read-only by design, and it reads `audit_logs` as written, so nothing here can
 * change what it shows. `metadata` is already redacted on the way in. An order's
 * number is looked up for the reader, because a UUID explains nothing.
 *
 * Bounded, as the order desk queue is bounded: a window that holds more than
 * {@see self::LIMIT} rows says so in `meta.truncated`.
 */
final class AuditActivityIndexController
{
    private const int LIMIT = 500;

    private const int MAX_DAYS = 31;

    public function __construct(private readonly TenantContext $context) {}

    /**
     * @throws ValidationException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);

        $from = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['from'], 'UTC')->startOfDay();
        $to = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['to'], 'UTC')->startOfDay();

        if ($to->greaterThan($from->addDays(self::MAX_DAYS - 1))) {
            throw ValidationException::withMessages(['to' => 'The window may not exceed '.self::MAX_DAYS.' days.']);
        }

        $logs = AuditLog::query()
            ->where('organisation_id', $this->context->organisationId())
            ->where('occurred_at', '>=', $from)
            ->where('occurred_at', '<', $to->addDay())
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->limit(self::LIMIT + 1)
            ->get();

        $truncated = $logs->count() > self::LIMIT;
        $logs = $logs->take(self::LIMIT);

        $names = DB::table('user_profiles')
            ->whereIn('user_id', $logs->pluck('actor_user_id')->filter()->unique()->values())
            ->selectRaw("user_id, nullif(trim(coalesce(given_name, '') || ' ' || coalesce(family_name, '')), '') as name")
            ->pluck('name', 'user_id');

        $orderNumbers = DB::table('orders')
            ->whereIn('id', $logs->where('subject_type', 'order')->pluck('subject_id')->filter()->unique()->values())
            ->pluck('order_number', 'id');

        return ApiResponse::data($logs->map(fn (AuditLog $log): array => [
            'id' => (string) $log->getKey(),
            'at' => $log->occurred_at->toIso8601String(),
            'action' => $log->action,
            'actor_name' => $log->actor_user_id === null ? null : ($names[$log->actor_user_id] ?? null),
            'subject_type' => $log->subject_type,
            'order_number' => $orderNumbers[$log->subject_id] ?? null,
            'metadata' => (object) ($log->metadata ?? []),
        ])->values()->all(), ['truncated' => $truncated]);
    }
}
