<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\InventoryService;
use Illuminate\Database\Eloquent\Builder;

/**
 * The one definition of "this branch needs ordering" (§4).
 *
 * **Why this is a class and not two `where` clauses.** The hub badge counts the
 * queue and the order builder lists it, and those are two endpoints that must
 * never disagree — a badge saying *3 items need attention* over a builder
 * showing two is a bug nobody reports and everybody stops trusting. The
 * predicate is therefore written once, here, and both surfaces call it. A test
 * pins their equality on the same fixture, but the reason they agree is that
 * there is only one predicate to be right or wrong.
 *
 * ## The union, and why the low-stock rule alone was not enough
 *
 * The queue is the distinct union of two rules over the branch's existing
 * levels:
 *
 * - **out of stock** — `quantity <= 0`;
 * - **low stock** — `reorder_threshold` is set and `quantity <= reorder_threshold`.
 *
 * INV1.3's low-stock predicate deliberately ignores levels with no threshold,
 * because "nobody asked to be warned about this" is not the same as "this is
 * fine". That is the right rule for a *warning* and the wrong one for an
 * *ordering queue*: a kitchen that never set a threshold on olive oil and has
 * run out of olive oil has a problem whether or not it asked to be told. So
 * emptiness joins lowness here, and only here (§2's first correction).
 *
 * A level meeting both rules is **one** row and it is labelled out of stock —
 * which is why {@see counts()} derives the low tally by subtraction rather than
 * counting the low rule a second time. Out-of-stock plus low always equals the
 * total, by construction, and no arithmetic on the client can make three
 * numbers that do not add up.
 *
 * ## Levels only, never stock items
 *
 * A stock item with no level row at this branch is *not* a shortage. It has
 * never moved here, and inventing a zero for it would fill the queue with every
 * shelf the kitchen has ever derived. §4 is explicit: such an item reaches an
 * order through **Add another item**, as an explicit request, and
 * {@see OrderProposalService} appends it there.
 */
final readonly class SupplyNeedsQuery
{
    /**
     * bcmath scale, matching `decimal(14,4)` on `stock_levels`.
     */
    private const int SCALE = 4;

    /**
     * Every level at one branch that needs ordering.
     *
     * Returns a builder rather than rows so the count endpoint can `count()` it
     * without hydrating anything and the proposal can join, order and eager-load
     * over the same constraint. The organisation is not filtered here: the
     * global scope on {@see StockLevel} already fails closed on the active
     * tenant, and a second hand-written `where` would be a copy of a rule that
     * is only safe while there is exactly one of it.
     *
     * @return Builder<StockLevel>
     */
    public function forBranch(string $branchId): Builder
    {
        return StockLevel::query()
            ->where('branch_id', $branchId)
            ->where(function (Builder $level): void {
                $level->where('quantity', '<=', 0)
                    ->orWhere(function (Builder $low): void {
                        $low->whereNotNull('reorder_threshold')
                            ->whereColumn('quantity', '<=', 'reorder_threshold');
                    });
            });
    }

    /**
     * The hub's three numbers.
     *
     * `low_stock_count` is the remainder, not a second query. Counting the low
     * rule directly would double-count every level that is both empty and below
     * its threshold — the overwhelmingly common case, since an empty shelf with
     * a threshold set satisfies both — and the two tallies would exceed the
     * total they are supposed to partition. Subtraction makes that
     * unrepresentable.
     *
     * @return array{count: int, out_of_stock_count: int, low_stock_count: int}
     */
    public function counts(string $branchId): array
    {
        $count = $this->forBranch($branchId)->count();
        $outOfStock = $this->forBranch($branchId)->where('quantity', '<=', 0)->count();

        return [
            'count' => $count,
            'out_of_stock_count' => $outOfStock,
            'low_stock_count' => $count - $outOfStock,
        ];
    }

    /**
     * The per-row echo of the SQL above, for the rows the proposal has already
     * loaded.
     *
     * `bccomp` on the decimal string rather than a float cast, for the reason
     * {@see InventoryService::isLowStock()} gives
     * about its own boundary: `0.0000 <= 0` must be exact, and a negative
     * quantity — which a correction can legitimately produce — is emptier still.
     *
     * @param  numeric-string  $quantity
     */
    public static function isOutOfStock(string $quantity): bool
    {
        return bccomp($quantity, '0', self::SCALE) <= 0;
    }
}
