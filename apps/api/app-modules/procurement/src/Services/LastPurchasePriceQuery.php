<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * "What did this last cost?", answered from the receipt ledger and nowhere else
 * (§3.4).
 *
 * **Nothing here is stored.** There is no `last_price` column on a supplier
 * link or on a stock item, because a stored copy is a second source of truth
 * that disagrees with the first the moment a receipt is posted, corrected or
 * priced late. The newest priced `goods_receipt_lines` row *is* the last price,
 * and deriving it live is what makes it impossible for the supplier page and
 * the purchases ledger to tell a manager two different numbers.
 *
 * ## Two questions, two reads
 *
 * - {@see perSupplierItem()} — "what did I last pay **them** for this?", the
 *   supplier page's column.
 * - {@see perItem()} — "what did I last pay **anybody** for this, and who?",
 *   the stock screen's column. It names the supplier because a price without
 *   the vendor beside it is not actionable.
 *
 * ## One query per page, never per row
 *
 * Both take a batch of stock item ids and answer every one of them in a single
 * `DISTINCT ON` statement. A supplier with sixty supplied items costs one
 * query, not sixty — which is the N+1 §3.4 names explicitly and the reason the
 * indexes migration exists.
 *
 * ## Deterministic, and unpriced lines are skipped entirely
 *
 * The ordering is `received_at DESC, created_at DESC, id DESC`. Two receipts
 * posted in the same second are ordinary at a loading bay, so the tie-breaks
 * are not decoration: without them PostgreSQL is free to pick either row, and
 * a screen refreshed twice would show two different prices for the same
 * history. `id` is the final arbiter because UUIDv7 keys sort by mint time.
 *
 * `WHERE unit_price_amount IS NOT NULL` is applied before the DISTINCT ON, so
 * an unpriced delivery does not become a "last price of nothing" that hides the
 * real one behind it. An item received only on unpriced receipts has **no** last
 * price, and the caller renders that as *never bought here* rather than as a
 * blank amount — the two are different facts and §3.4 keeps them apart.
 *
 * Currencies are never converted and amounts are never summed. Each row carries
 * its own `cost_currency_code`, because there is no exchange rate in this
 * system and "6.90" without "USD per kg" is not a price.
 */
final readonly class LastPurchasePriceQuery
{
    /**
     * The newest priced line for each of `$stockItemIds` bought from one
     * supplier, keyed by stock item id.
     *
     * Scoped to one supplier rather than taking arbitrary (supplier, item)
     * pairs, because that is the shape the surface asking has: the supplier
     * page holds one supplier and its whole supplied-item set. Slice 4's order
     * builder wants the pair form — the last price from *each* candidate
     * supplier of one shortage — and that is a second method over the same
     * statement rather than a widening of this one.
     *
     * @param  list<string>  $stockItemIds
     * @return array<string, array{
     *     stock_item_id: string,
     *     goods_receipt_id: string,
     *     document_ref: string|null,
     *     received_at: string|null,
     *     quantity: numeric-string,
     *     unit_id: string|null,
     *     unit_code: string|null,
     *     unit_price_amount: numeric-string,
     *     cost_currency_code: string|null
     * }>
     */
    public function perSupplierItem(string $organisationId, string $supplierId, array $stockItemIds): array
    {
        if ($stockItemIds === []) {
            return [];
        }

        $rows = $this->newestPricedLines($organisationId, $stockItemIds)
            ->where('receipt.supplier_id', $supplierId)
            ->get();

        $prices = [];

        foreach ($rows as $row) {
            $price = $this->price((array) $row);
            $prices[$price['stock_item_id']] = $price;
        }

        return $prices;
    }

    /**
     * The newest priced line for each of `$stockItemIds` across **every**
     * supplier, keyed by stock item id, with the supplier that sold it.
     *
     * The supplier is left-joined rather than required: a direct market-run
     * receipt carries no supplier, and the price it recorded is still the last
     * price of that item. The caller renders the missing name rather than
     * dropping the row, because "bought, source not recorded" is a truer answer
     * than silence.
     *
     * @param  list<string>  $stockItemIds
     * @return array<string, array{
     *     stock_item_id: string,
     *     goods_receipt_id: string,
     *     document_ref: string|null,
     *     received_at: string|null,
     *     quantity: numeric-string,
     *     unit_id: string|null,
     *     unit_code: string|null,
     *     unit_price_amount: numeric-string,
     *     cost_currency_code: string|null,
     *     supplier: array{id: string, code: string, name_en: string}|null
     * }>
     */
    public function perItem(string $organisationId, array $stockItemIds): array
    {
        if ($stockItemIds === []) {
            return [];
        }

        $rows = $this->newestPricedLines($organisationId, $stockItemIds)
            ->leftJoin('suppliers as supplier', 'supplier.id', '=', 'receipt.supplier_id')
            ->addSelect([
                'supplier.id as supplier_id',
                'supplier.code as supplier_code',
                'supplier.name_en as supplier_name_en',
            ])
            ->get();

        $prices = [];

        foreach ($rows as $row) {
            $columns = (array) $row;
            $price = $this->price($columns);

            $prices[$price['stock_item_id']] = $price + [
                'supplier' => $columns['supplier_id'] === null ? null : [
                    'id' => (string) $columns['supplier_id'],
                    'code' => (string) $columns['supplier_code'],
                    'name_en' => (string) $columns['supplier_name_en'],
                ],
            ];
        }

        return $prices;
    }

    /**
     * One priced line per stock item, newest first — the shared statement both
     * reads narrow further.
     *
     * `DISTINCT ON (line.stock_item_id)` keeps the first row of each group under
     * the `ORDER BY`, which is why the ordering has to lead with the same
     * column: PostgreSQL requires the distinct expression to be the leading
     * sort key, and the tie-breaks after it are what make "first" mean one
     * specific row rather than whichever the planner reached first.
     *
     * `measurement_units` is left-joined for the unit the price was quoted per.
     * A line may carry no `unit_id` — the stock item's own unit is then implied
     * — so a plain join would silently drop exactly the oldest receipts.
     *
     * The query builder rather than Eloquent: the result is a projection across
     * four tables, not a `GoodsReceiptLine`, and hydrating models to read nine
     * columns off them would be a cost with nothing behind it. Tenancy is the
     * explicit `receipt.organisation_id` predicate — `goods_receipt_lines`
     * carries no organisation column of its own and never has.
     *
     * @param  list<string>  $stockItemIds
     */
    private function newestPricedLines(string $organisationId, array $stockItemIds): QueryBuilder
    {
        return DB::table('goods_receipt_lines as line')
            ->join('goods_receipts as receipt', 'receipt.id', '=', 'line.goods_receipt_id')
            ->leftJoin('measurement_units as unit', 'unit.id', '=', 'line.unit_id')
            ->selectRaw('distinct on (line.stock_item_id) line.stock_item_id')
            ->addSelect([
                'line.goods_receipt_id',
                'line.quantity',
                'line.unit_id',
                'line.unit_price_amount',
                'line.cost_currency_code',
                'unit.code as unit_code',
                'receipt.received_at',
                'receipt.document_ref',
            ])
            ->where('receipt.organisation_id', $organisationId)
            ->whereIn('line.stock_item_id', $stockItemIds)
            // An unpriced delivery is quantity history, never a price. Excluded
            // here rather than filtered after, so it cannot mask the real one.
            ->whereNotNull('line.unit_price_amount')
            ->orderBy('line.stock_item_id')
            ->orderByDesc('receipt.received_at')
            ->orderByDesc('line.created_at')
            ->orderByDesc('line.id');
    }

    /**
     * One selected row as the wire shape, read by column name.
     *
     * The row arrives as a `stdClass` from the query builder and is cast to an
     * array here rather than read as properties: the projection is assembled
     * from four tables and has no model behind it, so column names are data
     * rather than a declared shape.
     *
     * `received_at` is re-parsed rather than passed through — the driver hands
     * back the database's own rendering, and every timestamp this API serves is
     * ISO 8601.
     *
     * @param  array<string, mixed>  $row
     * @return array{
     *     stock_item_id: string,
     *     goods_receipt_id: string,
     *     document_ref: string|null,
     *     received_at: string|null,
     *     quantity: numeric-string,
     *     unit_id: string|null,
     *     unit_code: string|null,
     *     unit_price_amount: numeric-string,
     *     cost_currency_code: string|null
     * }
     */
    private function price(array $row): array
    {
        /** @var numeric-string $quantity */
        $quantity = (string) $row['quantity'];
        /** @var numeric-string $amount */
        $amount = (string) $row['unit_price_amount'];

        return [
            'stock_item_id' => (string) $row['stock_item_id'],
            'goods_receipt_id' => (string) $row['goods_receipt_id'],
            'document_ref' => $this->text($row['document_ref']),
            'received_at' => $row['received_at'] === null
                ? null
                : CarbonImmutable::parse((string) $row['received_at'])->toIso8601String(),
            'quantity' => $quantity,
            'unit_id' => $this->text($row['unit_id']),
            'unit_code' => $this->text($row['unit_code']),
            'unit_price_amount' => $amount,
            'cost_currency_code' => $this->text($row['cost_currency_code']),
        ];
    }

    private function text(mixed $value): ?string
    {
        return $value === null ? null : (string) $value;
    }
}
