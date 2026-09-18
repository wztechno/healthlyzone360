<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `no_net_content` joins the closed vocabulary of reasons a sale could not be
 * deducted (PROD1).
 *
 * An item that sells from finished stock has to say how much of the shelf one
 * sold unit takes. Where the shelf counts in pieces the answer is obvious and the
 * consume path supplies it; where the shelf counts in kilograms or litres it is
 * not, and the honest answer is to refuse rather than to deduct `1` — which would
 * take a kilogram of lasagne for one portion of it, silently, and leave the shelf
 * wrong by three orders of magnitude.
 *
 * A reason of its own rather than folding it into `no_stock_unit`: those need
 * different fixes. `no_stock_unit` is a derivation fault nobody can act on from
 * the catalogue; this one is a field on the item that somebody can go and fill in,
 * and the exceptions queue is where they would find out.
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
    ];

    public function up(): void
    {
        $this->replaceWith(self::REASONS);
    }

    public function down(): void
    {
        $this->replaceWith(array_values(array_filter(
            self::REASONS,
            static fn (string $reason): bool => $reason !== 'no_net_content',
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
