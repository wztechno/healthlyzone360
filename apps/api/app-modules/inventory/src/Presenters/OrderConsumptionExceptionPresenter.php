<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Presenters;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Models\OrganisationBranch;
use Illuminate\Support\Collection;

/**
 * The wire shape of a consumption exception (INV1.5) — a review row a kitchen can
 * act on, joined to the human-readable names of the things it points at.
 *
 * An exception stores soft references (order id, order-line id, catalogue-item id)
 * so the record survives whatever happens to the rows it points at. This presenter
 * resolves those references *for display only* — the order's number, the sold
 * item's English name, the branch's name — in one batched read per collection, so
 * a page of exceptions is three lookups rather than three-per-row.
 *
 * **Nothing confidential passes through here.** The join reaches the order book,
 * the catalogue item and the branch — never a recipe version, a formulation
 * quantity, an ingredient cost or a supplier term. A reviewer sees *which* sale on
 * *which* line at *which* branch could not be deducted and why, and nothing about
 * how the dish is made.
 */
final class OrderConsumptionExceptionPresenter
{
    /**
     * @param  Collection<int, OrderConsumptionException>  $exceptions
     * @return list<array<string, mixed>>
     */
    public function collection(Collection $exceptions): array
    {
        $orderIds = $exceptions->pluck('order_id')->filter()->unique()->values()->all();
        $itemIds = $exceptions->pluck('catalogue_item_id')->filter()->unique()->values()->all();

        /** @var Collection<string, Order> $orders */
        $orders = Order::query()
            ->whereIn('id', $orderIds)
            ->get(['id', 'order_number', 'branch_id'])
            ->keyBy('id');

        $branchIds = $orders->pluck('branch_id')->filter()->unique()->values()->all();

        /** @var Collection<string, OrganisationBranch> $branches */
        $branches = OrganisationBranch::query()
            ->whereIn('id', $branchIds)
            ->get(['id', 'name'])
            ->keyBy('id');

        /** @var Collection<string, CatalogueItem> $items */
        $items = CatalogueItem::query()
            ->whereIn('id', $itemIds)
            ->get(['id', 'name_en'])
            ->keyBy('id');

        return array_values(
            $exceptions
                ->map(fn (OrderConsumptionException $exception): array => $this->row($exception, $orders, $branches, $items))
                ->all(),
        );
    }

    /**
     * @param  Collection<string, Order>  $orders
     * @param  Collection<string, OrganisationBranch>  $branches
     * @param  Collection<string, CatalogueItem>  $items
     * @return array<string, mixed>
     */
    public function row(
        OrderConsumptionException $exception,
        Collection $orders,
        Collection $branches,
        Collection $items,
    ): array {
        $order = $orders->get($exception->order_id);
        $branchId = $order?->branch_id;
        $branch = $branchId === null ? null : $branches->get($branchId);
        $item = $exception->catalogue_item_id === null ? null : $items->get($exception->catalogue_item_id);

        return [
            'id' => (string) $exception->getKey(),
            'order_id' => $exception->order_id,
            'order_number' => $order?->order_number,
            'order_line_id' => $exception->order_line_id,
            'catalogue_item_id' => $exception->catalogue_item_id,
            'item_name_en' => $item?->name_en,
            'branch_id' => $branchId,
            'branch_name' => $branch?->name,
            'reason_code' => $exception->reason_code,
            'detail' => $exception->detail,
            'resolved' => $exception->resolved_at !== null,
            'resolved_at' => $exception->resolved_at?->toIso8601String(),
            'resolved_by' => $exception->resolved_by,
            'resolution_note' => $exception->resolution_note,
            'created_at' => $exception->created_at?->toIso8601String(),
        ];
    }
}
