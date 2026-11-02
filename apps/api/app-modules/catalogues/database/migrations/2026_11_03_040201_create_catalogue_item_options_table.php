<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What a customer may change about a dish: something left out, or a sauce or side
 * picked from a group. Both are free, so there is no amount column, and that is
 * the owner's rule rather than a gap: the only priced choice is the portion, which
 * is a pack with its own price-list row.
 *
 * Isolation: `org-rls` for writes. Reads stay open, as they do for
 * `branch_closures`: a menu is public, and a basket reads this with no
 * organisation declared to the database.
 */
return new class extends Migration
{
    private const string TABLE = 'catalogue_item_options';

    /** @var list<string> */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    private const string ORGANISATION_MATCH = "organisation_id::text = current_setting('app.organisation_id', true)";

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->cascadeOnDelete();
            $table->string('kind', 16)->comment('remove | choice');
            $table->string('group_en', 80)->nullable()->comment('a choice group, such as Sauce; null on a removal');
            $table->string('group_ar', 80)->nullable();
            $table->string('name_en', 120);
            $table->string('name_ar', 120);
            $table->integer('display_order')->default(0);
            $table->timestamps();
            $table->index(['catalogue_item_id', 'display_order']);
        });

        DB::statement("ALTER TABLE catalogue_item_options ADD CONSTRAINT catalogue_item_options_kind_check CHECK (kind IN ('remove', 'choice'))");
        DB::statement("ALTER TABLE catalogue_item_options ADD CONSTRAINT catalogue_item_options_group_check CHECK ((kind = 'choice') = (group_en IS NOT NULL))");
        DB::statement('ALTER TABLE '.self::TABLE.' ENABLE ROW LEVEL SECURITY');

        $existing = DB::table('pg_roles')->whereIn('rolname', self::RUNTIME_ROLES)->orderBy('rolname')->pluck('rolname')->all();

        if ($existing === []) {
            return;
        }

        $roles = implode(', ', array_map(static fn (string $role): string => '"'.$role.'"', $existing));

        DB::statement('CREATE POLICY rls_catalogue_item_option_read ON '.self::TABLE.' FOR SELECT TO '.$roles.' USING (true)');
        DB::statement('CREATE POLICY rls_catalogue_item_option_insert ON '.self::TABLE.' FOR INSERT TO '.$roles.' WITH CHECK ('.self::ORGANISATION_MATCH.')');
        DB::statement('CREATE POLICY rls_catalogue_item_option_update ON '.self::TABLE.' FOR UPDATE TO '.$roles.' USING ('.self::ORGANISATION_MATCH.') WITH CHECK ('.self::ORGANISATION_MATCH.')');
        DB::statement('CREATE POLICY rls_catalogue_item_option_delete ON '.self::TABLE.' FOR DELETE TO '.$roles.' USING ('.self::ORGANISATION_MATCH.')');
    }

    public function down(): void
    {
        Schema::dropIfExists(self::TABLE);
    }
};
