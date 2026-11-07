<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Jobs;

use Carbon\CarbonImmutable;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use stdClass;
use Throwable;

/**
 * Tell the managers what is about to pass its date while there is still some on
 * the shelf: a finished batch's use-by, or the date on a delivery line.
 *
 * **Once a subject.** {@see StaffAlerts} writes one row per recipient, batch and
 * delivery line, so this repeats safely. An alert says "check the shelf", because
 * stock is one number per shelf and whether these units are the ones left is
 * unknowable until lots are built.
 *
 * **Tables, not models.** Inventory may not import Procurement or Production, so
 * the two dates are read the way `HeldStockForSale` reads them.
 *
 * **Each kitchen inside its own `during()`, and one kitchen's failure goes no
 * further**, for the reasons `EscalateUnacceptedOrders` gives.
 */
final class AlertExpiringStock implements ShouldQueue
{
    use Queueable;

    /** How many days before its date a shelf is called out. */
    public const int DAYS_AHEAD = 2;

    /** How far back a passed date still alerts, so a first run does not mail a year of old deliveries. */
    public const int DAYS_BACK = 7;

    public function __construct()
    {
        $this->onQueue('default');
    }

    public function handle(DatabaseTenantContext $database, StaffAlerts $alerts): void
    {
        $today = CarbonImmutable::now('Asia/Beirut')->startOfDay();
        $from = $today->subDays(self::DAYS_BACK)->toDateString();
        $until = $today->addDays(self::DAYS_AHEAD)->toDateString();

        foreach ($this->tradingKitchens() as $organisationId) {
            try {
                $database->during(null, $organisationId, null, function () use ($alerts, $organisationId, $from, $until): void {
                    foreach ([...$this->batches($organisationId, $from, $until), ...$this->deliveries($organisationId, $from, $until)] as $row) {
                        $alerts->send(StaffAlertType::StockExpiring, $organisationId, (string) $row->id, [
                            'order_number' => $row->name.' · '.$row->date,
                        ]);
                    }
                });
            } catch (Throwable $e) {
                report($e);
            }
        }
    }

    /**
     * @return list<string>
     */
    private function tradingKitchens(): array
    {
        return array_values(Organisation::query()
            ->orderBy('id')
            ->get(['id', 'status'])
            ->filter(static fn (Organisation $organisation): bool => $organisation->status->isTrading())
            ->map(static fn (Organisation $organisation): string => (string) $organisation->getKey())
            ->values()
            ->all());
    }

    /**
     * Finished batches dated in the window, on a shelf that still holds stock.
     *
     * @return Collection<int, object{id: string, name: string, date: string}&stdClass>
     */
    private function batches(string $organisationId, string $from, string $until): Collection
    {
        return DB::table('production_orders as batch')
            ->join('stock_items as item', function ($join) use ($organisationId): void {
                $join->on('item.ingredient_id', '=', 'batch.production_item_ingredient_id')
                    ->where('item.organisation_id', '=', $organisationId);
            })
            ->join('stock_levels as level', function ($join): void {
                $join->on('level.stock_item_id', '=', 'item.id')->on('level.branch_id', '=', 'batch.branch_id');
            })
            ->where('batch.organisation_id', $organisationId)
            ->where('batch.status', 'completed')
            ->whereBetween('batch.expiry_date', [$from, $until])
            ->where('level.quantity', '>', 0)
            ->selectRaw('batch.id, item.name_en as name, batch.expiry_date::text as date')
            ->get()
            ->map(static fn (object $row): object => (object) [
                'id' => (string) $row->id,
                'name' => (string) $row->name,
                'date' => (string) $row->date,
            ]);
    }

    /**
     * Delivery lines dated in the window, on a shelf that still holds stock.
     *
     * @return Collection<int, object{id: string, name: string, date: string}&stdClass>
     */
    private function deliveries(string $organisationId, string $from, string $until): Collection
    {
        return DB::table('goods_receipt_lines as line')
            ->join('goods_receipts as receipt', 'receipt.id', '=', 'line.goods_receipt_id')
            ->join('stock_items as item', 'item.id', '=', 'line.stock_item_id')
            ->join('stock_levels as level', function ($join): void {
                $join->on('level.stock_item_id', '=', 'line.stock_item_id')->on('level.branch_id', '=', 'receipt.branch_id');
            })
            ->where('receipt.organisation_id', $organisationId)
            ->whereBetween('line.expires_on', [$from, $until])
            ->where('level.quantity', '>', 0)
            ->selectRaw('line.id, item.name_en as name, line.expires_on::text as date')
            ->get()
            ->map(static fn (object $row): object => (object) [
                'id' => (string) $row->id,
                'name' => (string) $row->name,
                'date' => (string) $row->date,
            ]);
    }
}
