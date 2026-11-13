<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What each dish on sale earns, per channel, as of the last overnight run.
 *
 * A read model, not a ledger: one row per dish and channel, rewritten by
 * `RefreshDishMargins`. Costing a recipe walks its lines and their prices, which is
 * fine for one sheet and too slow for a whole menu on a page load. The row is also
 * the memory the alert needs: the cost it last saw, to tell a cost that moved from a
 * target that moved, and `below_target_since`, so a dish that stays low alerts once.
 *
 * `margin_percent` is null with a `withheld_reason` whenever the figure would be a
 * guess. See `DishMargins`.
 *
 * Isolation strategy: `org-rls`, as `kitchen_service_settings`.
 */
return new class extends Migration
{
    private const string TABLE = 'dish_margins';

    /**
     * The schema owner is absent on purpose: it bypasses RLS by ownership.
     *
     * @var list<string>
     */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    private const string ORGANISATION_MATCH = "organisation_id::text = current_setting('app.organisation_id', true)";

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->cascadeOnDelete();
            $table->string('channel', 8)->comment('b2c | b2b');

            $table->decimal('price_amount', 18, 6)->nullable();
            $table->decimal('cost_amount', 18, 6)->nullable();
            $table->string('currency_code', 3)->nullable();
            $table->decimal('margin_percent', 10, 2)->nullable();
            $table->string('withheld_reason', 32)->nullable()->comment('why there is no margin; null when there is one');

            $table->timestampTz('below_target_since')->nullable();
            $table->timestampTz('computed_at');
            $table->timestamps();

            $table->unique(['catalogue_item_id', 'channel']);
            $table->index(['organisation_id', 'margin_percent']);
        });

        DB::statement("ALTER TABLE dish_margins ADD CONSTRAINT dish_margins_channel_check CHECK (channel IN ('b2c', 'b2b'))");
        DB::statement('ALTER TABLE dish_margins ADD CONSTRAINT dish_margins_margin_or_reason_check CHECK ((margin_percent IS NULL) <> (withheld_reason IS NULL))');

        DB::statement('ALTER TABLE '.self::TABLE.' ENABLE ROW LEVEL SECURITY');

        $roles = $this->roles();

        if ($roles === null) {
            return;
        }

        DB::statement(
            'CREATE POLICY rls_organisation_scope ON '.self::TABLE.' FOR ALL TO '.$roles.'
             USING ('.self::ORGANISATION_MATCH.')
             WITH CHECK ('.self::ORGANISATION_MATCH.')'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists(self::TABLE);
    }

    /**
     * The runtime roles that actually exist, as a quoted grantee list.
     */
    private function roles(): ?string
    {
        /** @var list<string> $existing */
        $existing = DB::connection()
            ->table('pg_roles')
            ->whereIn('rolname', self::RUNTIME_ROLES)
            ->orderBy('rolname')
            ->pluck('rolname')
            ->all();

        if ($existing === []) {
            return null;
        }

        return implode(', ', array_map(static fn (string $role): string => '"'.$role.'"', $existing));
    }
};
