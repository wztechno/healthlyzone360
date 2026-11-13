<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Cash coming back from the road, from an own driver or a courier company.
 *
 * One table for both, because a hand-in has the same shape either way: what was
 * due, what was kept as a fee, what was handed over, and what is short. A row
 * here is also the shift: there is no shift table, so a driver's shift is
 * whatever they had not yet handed in. `delivery_jobs.cash_settlement_id` says
 * which runs a hand-in covered, and a filled column is why a run cannot be settled
 * twice. A receipt is not marked, because a receipt is never edited.
 *
 * `short_minor` is stated rather than left to arithmetic, with a CHECK holding it
 * to the other three, so a report reads the figure the manager signed. A short
 * hand-in needs a reason, and the app takes no pay decision from it: the row and
 * its sign-off are the whole of what happens.
 *
 * Isolation strategy: `org-rls`, as `kitchen_service_settings`.
 */
return new class extends Migration
{
    private const string TABLE = 'cash_settlements';

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

            $table->string('kind', 16)->comment('driver | courier');
            $table->foreignUuid('driver_user_id')->nullable()->comment('set for a driver hand-in')->constrained('users')->restrictOnDelete();
            $table->string('courier_name', 120)->nullable()->comment('set for a courier batch');

            $table->string('currency_code', 3);
            $table->bigInteger('expected_minor')->comment('the cash these runs brought in');
            $table->bigInteger('fee_minor')->default(0)->comment('kept by the courier');
            $table->bigInteger('handed_in_minor');
            $table->bigInteger('short_minor')->comment('expected, less the fee, less what was handed in');
            $table->string('short_reason', 300)->nullable();

            $table->foreignUuid('recorded_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('recorded_at');
            $table->foreignUuid('signed_off_by')->nullable()->comment('the manager who accepted a short hand-in')->constrained('users')->restrictOnDelete();
            $table->timestampTz('signed_off_at')->nullable();

            $table->timestamps();

            $table->index(['organisation_id', 'recorded_at']);
            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE cash_settlements ADD CONSTRAINT cash_settlements_kind_check CHECK ((kind = 'driver' AND driver_user_id IS NOT NULL AND courier_name IS NULL) OR (kind = 'courier' AND courier_name IS NOT NULL AND driver_user_id IS NULL))");
        DB::statement('ALTER TABLE cash_settlements ADD CONSTRAINT cash_settlements_amounts_check CHECK (fee_minor >= 0 AND handed_in_minor >= 0 AND short_minor >= 0 AND short_minor = expected_minor - fee_minor - handed_in_minor)');
        DB::statement('ALTER TABLE cash_settlements ADD CONSTRAINT cash_settlements_short_reason_check CHECK (short_minor = 0 OR short_reason IS NOT NULL)');

        Schema::table('delivery_jobs', function (Blueprint $table): void {
            $table->foreignUuid('cash_settlement_id')->nullable()->comment('the hand-in that covered this run')->constrained('cash_settlements')->restrictOnDelete();
        });

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
        Schema::table('delivery_jobs', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('cash_settlement_id');
        });

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
