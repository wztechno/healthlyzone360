<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `quality_hold` joins the reasons a sale could not be deducted. A shelf set
 * aside by a quality hold is not empty and is not spoken for by a batch, and it
 * has a third answer: release the hold, or throw the food away.
 */
return new class extends Migration
{
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
        'quality_hold',
    ];

    public function up(): void
    {
        $this->replaceWith(self::REASONS);
    }

    public function down(): void
    {
        $this->replaceWith(array_values(array_filter(
            self::REASONS,
            static fn (string $reason): bool => $reason !== 'quality_hold',
        )));
    }

    /**
     * @param  list<string>  $reasons
     */
    private function replaceWith(array $reasons): void
    {
        $list = implode(', ', array_map(static fn (string $reason): string => "'{$reason}'", $reasons));

        DB::statement('ALTER TABLE order_consumption_exceptions DROP CONSTRAINT IF EXISTS order_consumption_exceptions_reason_check');
        DB::statement("ALTER TABLE order_consumption_exceptions ADD CONSTRAINT order_consumption_exceptions_reason_check CHECK (reason_code IN ({$list}))");
    }
};
