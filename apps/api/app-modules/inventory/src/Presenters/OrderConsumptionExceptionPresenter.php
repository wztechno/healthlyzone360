<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Presenters;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
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
 * a page of exceptions is four lookups rather than four-per-row.
 *
 * It also carries what the screen needs to send a reviewer to the fix: the sold
 * item's type and recipe id (where the recipe editor opens), and the ingredient the
 * detail line names (`ingredient_id`, read out of the detail) with its English name.
 *
 * **Nothing confidential passes through here.** The join reaches the order book,
 * the catalogue item, the ingredient master and the branch — never a recipe version,
 * a formulation quantity, an ingredient cost or a supplier term. A reviewer sees
 * *which* sale on *which* line at *which* branch could not be deducted and why.
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
            ->get(['id', 'name_en', 'item_type', 'recipe_id'])
            ->keyBy('id');

        $ingredientIds = $exceptions
            ->map(fn (OrderConsumptionException $exception): ?string => self::ingredientIdIn($exception->detail))
            ->filter()
            ->unique()
            ->values()
            ->all();

        /** @var Collection<string, Ingredient> $ingredients */
        $ingredients = Ingredient::query()
            ->whereIn('id', $ingredientIds)
            ->get(['id', 'name_en'])
            ->keyBy('id');

        return array_values(
            $exceptions
                ->map(fn (OrderConsumptionException $exception): array => $this->row($exception, $orders, $branches, $items, $ingredients))
                ->all(),
        );
    }

    /**
     * @param  Collection<string, Order>  $orders
     * @param  Collection<string, OrganisationBranch>  $branches
     * @param  Collection<string, CatalogueItem>  $items
     * @param  Collection<string, Ingredient>  $ingredients
     * @return array<string, mixed>
     */
    public function row(
        OrderConsumptionException $exception,
        Collection $orders,
        Collection $branches,
        Collection $items,
        Collection $ingredients,
    ): array {
        $order = $orders->get($exception->order_id);
        $branchId = $order?->branch_id;
        $branch = $branchId === null ? null : $branches->get($branchId);
        $item = $exception->catalogue_item_id === null ? null : $items->get($exception->catalogue_item_id);
        $ingredientId = self::ingredientIdIn($exception->detail);
        $ingredient = $ingredientId === null ? null : $ingredients->get($ingredientId);

        return [
            'id' => (string) $exception->getKey(),
            'order_id' => $exception->order_id,
            'order_number' => $order?->order_number,
            'order_line_id' => $exception->order_line_id,
            'catalogue_item_id' => $exception->catalogue_item_id,
            'item_name_en' => $item?->name_en,
            'item_type' => $item?->item_type->value,
            'recipe_id' => $item?->recipe_id,
            'ingredient_id' => $ingredientId,
            'ingredient_name_en' => $ingredient?->name_en,
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

    /**
     * The ingredient a detail line names — "A recipe line for ingredient {uuid} has no quantity or
     * unit.", "Ingredient {uuid}: …" — or null when it names none. The detail is the only place the
     * exception records it, so it is read back from there rather than stored twice.
     */
    public static function ingredientIdIn(?string $detail): ?string
    {
        if ($detail === null) {
            return null;
        }

        $matched = preg_match(
            '/\bingredient\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i',
            $detail,
            $match,
        );

        return $matched === 1 ? strtolower($match[1]) : null;
    }
}
