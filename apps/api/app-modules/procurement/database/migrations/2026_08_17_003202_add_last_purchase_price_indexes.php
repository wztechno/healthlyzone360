<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The indexes the last-purchase-price reads need (§3.4).
 *
 * All four are missing today, and none of them is an oversight anybody could
 * have seen from the schema: **PostgreSQL does not index a foreign key**. It
 * indexes a primary key and a unique constraint and nothing else, so
 * `goods_receipt_lines.goods_receipt_id` — declared as a constrained foreign
 * key since the first procurement migration — has never had an index behind it.
 * Until now nothing cared: the ledger walks the lines table by its own cursor
 * and the monthly report scans a month whole. The last-price query is the first
 * read that arrives *at* a receipt line already knowing which receipt or which
 * item it wants, and on a kitchen with two years of deliveries that is the
 * difference between a lookup and a sequential scan per supplied item.
 *
 * Each one serves a named read:
 *
 * - `goods_receipt_lines (goods_receipt_id)` — the join back from a receipt to
 *   its lines, which every receipt read and both last-price queries make. Also
 *   what makes deleting a receipt cheap rather than a scan.
 * - `goods_receipt_lines (stock_item_id)` — the item-level query's entry point:
 *   "every line that ever received this shelf", before the DISTINCT ON picks
 *   the newest.
 * - `goods_receipts (organisation_id, supplier_id, received_at DESC)
 *   WHERE supplier_id IS NOT NULL` — the supplier page's read, newest first per
 *   supplier. Partial because a direct market-run receipt has no supplier and
 *   can never answer "what did I last pay *them*"; excluding those rows keeps
 *   the index to the receipts the question is actually about.
 * - `goods_receipts (organisation_id, received_at DESC)` — the item-level
 *   query's ordering across every supplier, and the ledger's own date filter.
 *
 * `received_at DESC` matches the query's `ORDER BY … DESC` rather than relying
 * on a backwards index scan: PostgreSQL can walk either direction, but the
 * DISTINCT ON reads the leading edge of each group and a matching direction is
 * what lets it stop there.
 *
 * Raw statements rather than `Blueprint::index()` because the two on
 * `goods_receipts` need a sort direction and a WHERE clause, neither of which
 * the fluent builder expresses. The two plain ones are written the same way for
 * one voice in one migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE INDEX goods_receipt_lines_receipt_index ON goods_receipt_lines (goods_receipt_id)');
        DB::statement('CREATE INDEX goods_receipt_lines_stock_item_index ON goods_receipt_lines (stock_item_id)');
        DB::statement('CREATE INDEX goods_receipts_supplier_received_index ON goods_receipts (organisation_id, supplier_id, received_at DESC) WHERE supplier_id IS NOT NULL');
        DB::statement('CREATE INDEX goods_receipts_received_index ON goods_receipts (organisation_id, received_at DESC)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS goods_receipts_received_index');
        DB::statement('DROP INDEX IF EXISTS goods_receipts_supplier_received_index');
        DB::statement('DROP INDEX IF EXISTS goods_receipt_lines_stock_item_index');
        DB::statement('DROP INDEX IF EXISTS goods_receipt_lines_receipt_index');
    }
};
