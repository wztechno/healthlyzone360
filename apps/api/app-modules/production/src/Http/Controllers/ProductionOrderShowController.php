<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Production\Models\ProductionOrderLine;
use Healthy360\Production\Presenters\ProductionOrderPresenter;
use Healthy360\Production\Services\ProductionOrderService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * GET /api/v1/catalogue/production/orders/{productionOrder} — one batch (PROD1).
 *
 * ## A draft's plan is live and a confirmed batch's is not
 *
 * A draft has committed to nothing, so it reads its plan fresh: the shelves move
 * under it, and showing yesterday's availability would be showing a number
 * nobody can act on. From confirm onwards the **lines are the answer** — they are
 * what the kitchen agreed to, what the reservations were opened against and what
 * the estimate was computed from — and re-deriving them would make all three
 * disagree on exactly the batches nobody can reconstruct.
 *
 * So the response carries `lines` once they exist and `plan` while they do not,
 * and never both pretending to be the same thing.
 *
 * Requires `production.view_organisation`; money inside the payload additionally
 * requires `production.view_costs_organisation`.
 *
 * `cooking_temperatures` is the batch's core-temperature readings, newest first,
 * shaped as the temperature log's `cooking` rows. Read with `DB::table` because
 * the readings belong to quality control and this module may not import it; the
 * desk list never carries them, which would be a query per row.
 */
final class ProductionOrderShowController
{
    use ResolvesProductionOrder;

    public function __construct(
        private readonly ProductionOrderPresenter $presenter,
        private readonly ProductionOrderService $orders,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $productionOrder, TenantContext $context): JsonResponse
    {
        $order = $this->resolveOrder($productionOrder, $context);
        $withCosts = $this->withCosts();

        /** @var list<ProductionOrderLine> $lines */
        $lines = $order->lines()->orderBy('display_order')->get()->all();

        $payload = [
            'production_order' => $this->presenter->summary($order, $withCosts),
            'lines' => $this->presenter->lines($lines, $withCosts),
            'cooking_temperatures' => $this->cookingTemperatures($order),
        ];

        if ($lines === []) {
            $payload['plan'] = $this->presenter->plan($this->orders->plan($order), $withCosts);
        }

        return ApiResponse::data($payload, ['costs_visible' => $withCosts]);
    }

    /**
     * The batch's core-temperature readings in the temperature log's `cooking`
     * shape (`TemperatureLogController::log()`), with its name expression.
     *
     * @return list<array<string, string|null>>
     */
    private function cookingTemperatures(ProductionOrder $order): array
    {
        return array_values(DB::table('cooking_temperatures as c')
            ->join('production_orders as o', 'o.id', '=', 'c.production_order_id')
            ->leftJoin('recipe_versions as v', 'v.id', '=', 'o.recipe_version_id')
            ->leftJoin('recipes as r', 'r.id', '=', 'v.recipe_id')
            ->leftJoin('user_profiles as p', 'p.user_id', '=', 'c.recorded_by')
            ->where('c.production_order_id', $order->getKey())
            ->orderByDesc('c.created_at')
            ->selectRaw("c.id, c.production_order_id, c.celsius, c.note, c.created_at, o.reference, o.lot_number, r.name_en as recipe, nullif(trim(coalesce(p.given_name, '') || ' ' || coalesce(p.family_name, '')), '') as recorded_by_name")
            ->get()
            ->map(static fn (object $row): array => [
                'id' => (string) $row->id,
                'production_order_id' => (string) $row->production_order_id,
                'batch_label' => self::text($row->lot_number ?? $row->reference),
                'recipe' => self::text($row->recipe),
                'celsius' => (string) $row->celsius,
                'note' => self::text($row->note),
                'recorded_by_name' => self::text($row->recorded_by_name),
                'recorded_at' => CarbonImmutable::parse($row->created_at)->toIso8601String(),
            ])
            ->all());
    }

    private static function text(mixed $value): ?string
    {
        return is_string($value) ? $value : null;
    }
}
