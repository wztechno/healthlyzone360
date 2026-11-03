<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Counting the till at the end of a shift.
 *
 * A row is one shift, in one currency: everything since the kitchen last closed
 * that currency, so a shift needs no table or button to open it. The float and
 * the count are typed at the close.
 *
 * The figures are stated rather than left to arithmetic, with CHECKs holding them
 * together, so a report reads what the manager signed even after an order behind
 * it changes. `business_date` is the kitchen's local day the shift opened on, so
 * an evening running past midnight stays on the day it started.
 *
 * A short close needs a reason and a sign-off. The app takes no pay decision from
 * it: the row and its sign-off are the whole of what happens.
 *
 * `(organisation_id, currency_code, opened_at)` is unique because the second of two
 * presses reads the same `opened_at` and must not write a second shift.
 *
 * Isolation strategy: `org-rls`, as `cash_settlements`.
 */
return new class extends Migration
{
    private const string TABLE = 'daily_closes';

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
            $table->string('currency_code', 3);

            $table->date('business_date')->comment('the local day the shift opened on');
            $table->timestampTz('opened_at')->comment('the previous close, or the start of the local day for the first');
            $table->timestampTz('closed_at');

            $table->bigInteger('opening_float_minor');
            $table->bigInteger('counter_cash_minor')->comment('cash taken at the counter in the shift');
            $table->bigInteger('handed_in_minor')->comment('cash drivers and couriers handed in during the shift');
            $table->bigInteger('cash_refunds_minor')->comment('cash paid back in the shift');
            $table->bigInteger('expected_minor')->comment('float, plus counter cash, plus hand-ins, less refunds');
            $table->bigInteger('counted_minor');
            $table->bigInteger('variance_minor')->comment('counted less expected; negative is short');
            $table->string('variance_reason', 300)->nullable();

            $table->foreignUuid('recorded_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('signed_off_by')->nullable()->comment('the manager who accepted a short close')->constrained('users')->restrictOnDelete();
            $table->timestampTz('signed_off_at')->nullable();

            $table->timestamps();

            $table->unique(['organisation_id', 'currency_code', 'opened_at']);
            $table->index(['organisation_id', 'closed_at']);
            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        DB::statement('ALTER TABLE daily_closes ADD CONSTRAINT daily_closes_amounts_check CHECK (opening_float_minor >= 0 AND counted_minor >= 0 AND expected_minor = opening_float_minor + counter_cash_minor + handed_in_minor - cash_refunds_minor AND variance_minor = counted_minor - expected_minor)');
        DB::statement('ALTER TABLE daily_closes ADD CONSTRAINT daily_closes_short_reason_check CHECK (variance_minor >= 0 OR variance_reason IS NOT NULL)');

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
