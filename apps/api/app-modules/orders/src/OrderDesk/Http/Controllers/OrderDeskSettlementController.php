<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Orders\Models\CashSettlement;
use Healthy360\Orders\OrderDesk\Services\CashSettlements;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * GET and POST /api/v1/catalogue/order-desk/settlements, and a manager's sign-off.
 *
 * `index` and `store` take `order.settle_cash_organisation`, held by the cashier
 * who counts the money and the managers above them. `signOff` takes
 * `order.supervise_organisation`.
 */
final class OrderDeskSettlementController
{
    /** Enough recent hand-ins to find this week's on one screen. */
    private const int RECENT = 50;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly CashSettlements $settlements,
    ) {}

    public function index(): JsonResponse
    {
        $organisationId = $this->locator->sellerId();

        $recent = CashSettlement::query()
            ->orderByDesc('recorded_at')
            ->orderByDesc('id')
            ->limit(self::RECENT)
            ->get();

        return ApiResponse::data([
            'drivers' => $this->settlements->drivers($organisationId),
            'couriers' => $this->settlements->couriers($organisationId),
            'settlements' => $this->present($recent),
        ]);
    }

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function store(Request $request): JsonResponse
    {
        /** @var array{job_ids: list<string>, handed_in_minor: int, short_reason?: string|null} $validated */
        $validated = $request->validate([
            'job_ids' => ['required', 'array', 'min:1', 'max:200'],
            'job_ids.*' => ['required', 'uuid', 'distinct'],
            'handed_in_minor' => ['required', 'integer', 'min:0'],
            'short_reason' => ['nullable', 'string', 'max:300'],
        ]);

        $settlement = $this->settlements->settle(
            $this->locator->sellerId(),
            $validated['job_ids'],
            $validated['handed_in_minor'],
            $validated['short_reason'] ?? null,
            (string) $request->user()?->getKey(),
        );

        return ApiResponse::data(['settlement' => $this->present(new Collection([$settlement]))[0]], status: 201);
    }

    /**
     * @throws ApiException
     */
    public function signOff(Request $request, string $settlement): JsonResponse
    {
        $record = CashSettlement::query()->whereKey($settlement)->first();

        if (! $record instanceof CashSettlement) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $signed = $this->settlements->signOff($record, (string) $request->user()?->getKey());

        return ApiResponse::data(['settlement' => $this->present(new Collection([$signed]))[0]]);
    }

    /**
     * `user_profiles` for the names, for the reason the cash report joins it:
     * `users` carries no name. A person with no profile yet reads as null.
     *
     * @param  Collection<int, CashSettlement>  $settlements
     * @return list<array<string, mixed>>
     */
    private function present(Collection $settlements): array
    {
        $names = DB::table('user_profiles')
            ->whereIn('user_id', $settlements->pluck('driver_user_id')->merge($settlements->pluck('recorded_by'))->merge($settlements->pluck('signed_off_by'))->filter()->unique()->values())
            ->selectRaw("user_id, nullif(trim(coalesce(given_name, '') || ' ' || coalesce(family_name, '')), '') as name")
            ->pluck('name', 'user_id');
        $branches = DB::table('organisation_branches')
            ->whereIn('id', $settlements->pluck('branch_id')->filter()->unique()->values())
            ->pluck('name', 'id');

        return array_values($settlements->map(fn (CashSettlement $settlement): array => [
            'id' => (string) $settlement->getKey(),
            'kind' => $settlement->kind,
            'party_name' => $settlement->courier_name ?? $names[$settlement->driver_user_id] ?? null,
            'branch_id' => $settlement->branch_id,
            'branch_name' => $settlement->branch_id === null ? null : ($branches[$settlement->branch_id] ?? null),
            'currency_code' => $settlement->currency_code,
            'expected_minor' => $settlement->expected_minor,
            'fee_minor' => $settlement->fee_minor,
            'expense_minor' => $settlement->expense_minor,
            'handed_in_minor' => $settlement->handed_in_minor,
            'short_minor' => $settlement->short_minor,
            'short_reason' => $settlement->short_reason,
            'recorded_by_name' => $names[$settlement->recorded_by] ?? null,
            'recorded_at' => $settlement->recorded_at->toIso8601String(),
            'signed_off_by_name' => $settlement->signed_off_by === null ? null : ($names[$settlement->signed_off_by] ?? null),
            'signed_off_at' => $settlement->signed_off_at?->toIso8601String(),
        ])->values()->all());
    }
}
