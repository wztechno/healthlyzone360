<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Orders\Models\DailyClose;
use Healthy360\Orders\OrderDesk\Services\DailyCloses;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * GET and POST /api/v1/catalogue/order-desk/closes, and a manager's sign-off.
 *
 * The seats are `OrderDeskSettlementController`'s, for the same reason: `index` and
 * `store` take `order.settle_cash_organisation`, held by whoever counts the cash,
 * and `signOff` takes `order.supervise_organisation`.
 */
final class OrderDeskCloseController
{
    /** Enough recent closes to find this fortnight's on one screen. */
    private const int RECENT = 50;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly DailyCloses $closes,
    ) {}

    public function index(): JsonResponse
    {
        $recent = DailyClose::query()
            ->orderByDesc('closed_at')
            ->orderByDesc('id')
            ->limit(self::RECENT)
            ->get();

        $organisationId = $this->locator->sellerId();

        return ApiResponse::data([
            ...$this->closes->open($organisationId),
            'totals' => $this->closes->totals($organisationId),
            'closes' => $this->present($recent),
        ]);
    }

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function store(Request $request): JsonResponse
    {
        $organisationId = $this->locator->sellerId();

        /** @var array{branch_id?: string|null, currency_code: string, opening_float_minor: int, counted_minor: int, variance_reason?: string|null} $validated */
        $validated = $request->validate([
            'branch_id' => ['nullable', 'uuid', Rule::exists('organisation_branches', 'id')->where('organisation_id', $organisationId)],
            'currency_code' => ['required', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'opening_float_minor' => ['required', 'integer', 'min:0'],
            'counted_minor' => ['required', 'integer', 'min:0'],
            'variance_reason' => ['nullable', 'string', 'max:300'],
        ]);

        $close = $this->closes->close(
            $organisationId,
            $validated['branch_id'] ?? null,
            $validated['currency_code'],
            $validated['opening_float_minor'],
            $validated['counted_minor'],
            $validated['variance_reason'] ?? null,
            (string) $request->user()?->getKey(),
        );

        return ApiResponse::data(['close' => $this->present(new Collection([$close]))[0]], status: 201);
    }

    /**
     * @throws ApiException
     */
    public function signOff(Request $request, string $close): JsonResponse
    {
        $record = DailyClose::query()->whereKey($close)->first();

        if (! $record instanceof DailyClose) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $signed = $this->closes->signOff($record, (string) $request->user()?->getKey());

        return ApiResponse::data(['close' => $this->present(new Collection([$signed]))[0]]);
    }

    /**
     * @param  Collection<int, DailyClose>  $closes
     * @return list<array<string, mixed>>
     */
    private function present(Collection $closes): array
    {
        $names = DB::table('user_profiles')
            ->whereIn('user_id', $closes->pluck('recorded_by')->merge($closes->pluck('signed_off_by'))->filter()->unique()->values())
            ->selectRaw("user_id, nullif(trim(coalesce(given_name, '') || ' ' || coalesce(family_name, '')), '') as name")
            ->pluck('name', 'user_id');
        $branches = DB::table('organisation_branches')
            ->whereIn('id', $closes->pluck('branch_id')->filter()->unique()->values())
            ->pluck('name', 'id');

        return $closes->map(fn (DailyClose $close): array => [
            'id' => (string) $close->getKey(),
            'branch_id' => $close->branch_id,
            'branch_name' => $close->branch_id === null ? null : ($branches[$close->branch_id] ?? null),
            'currency_code' => $close->currency_code,
            'business_date' => $close->business_date->toDateString(),
            'opened_at' => $close->opened_at->toIso8601String(),
            'closed_at' => $close->closed_at->toIso8601String(),
            'opening_float_minor' => $close->opening_float_minor,
            'counter_cash_minor' => $close->counter_cash_minor,
            'handed_in_minor' => $close->handed_in_minor,
            'cash_refunds_minor' => $close->cash_refunds_minor,
            'expected_minor' => $close->expected_minor,
            'counted_minor' => $close->counted_minor,
            'variance_minor' => $close->variance_minor,
            'variance_reason' => $close->variance_reason,
            'recorded_by_name' => $names[$close->recorded_by] ?? null,
            'signed_off_by_name' => $close->signed_off_by === null ? null : ($names[$close->signed_off_by] ?? null),
            'signed_off_at' => $close->signed_off_at?->toIso8601String(),
        ])->values()->all();
    }
}
