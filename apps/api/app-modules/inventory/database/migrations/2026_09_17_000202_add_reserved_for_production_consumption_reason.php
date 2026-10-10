<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `reserved_for_production` joins the closed vocabulary of reasons a sale could
 * not be deducted (PROD1).
 *
 * It is a different fact from `insufficient_stock` and needs a different fix. An
 * `insufficient_stock` shelf is empty: buy more, or take the item off sale. A
 * `reserved_for_production` shelf is not empty — the flour is right there — but
 * Thursday's batch has claimed it, so taking it now would quietly leave the batch
 * short. The person who reads that exception goes and talks to the kitchen about
 * the batch, or releases it, neither of which "not enough stock" would have
 * prompted.
 *
 * Folding the two together would also make the exceptions queue lie about a
 * kitchen's supply: a week of sales blocked by over-eager reservations would read
 * as a week of stockouts.
 */
return new class extends Migration
{
    private const string CONSTRAINT = 'order_consumption_exceptions_reason_check';

    /**
     * @var list<string>
     */
    private const array REASONS = [
        'no_branch',
        'no_catalogue_item',
        'no_recipe_version',
        'no_yield_piece_count',
        'unquantified_recipe_line',
        'no_ingredient_link',
        'no_stock_item',
        'no_stock_unit',
        'unit_conversion_unsupported',
        'no_ingredient_cost',
        'insufficient_stock',
        'no_net_content',
        'reserved_for_production',
    ];

    public function up(): void
    {
        $this->replaceWith(self::REASONS);
    }

    public function down(): void
    {
        $this->replaceWith(array_values(array_filter(
            self::REASONS,
            static fn (string $reason): bool => $reason !== 'reserved_for_production',
        )));
    }

    /**
     * @param  list<string>  $reasons
     */
    private function replaceWith(array $reasons): void
    {
        $list = implode(', ', array_map(static fn (string $reason): string => "'".$reason."'", $reasons));

        DB::statement('ALTER TABLE order_consumption_exceptions DROP CONSTRAINT IF EXISTS '.self::CONSTRAINT);
        DB::statement('ALTER TABLE order_consumption_exceptions ADD CONSTRAINT '.self::CONSTRAINT.' CHECK (reason_code IN ('.$list.'))');
    }
};
