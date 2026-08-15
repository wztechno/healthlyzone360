<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `audit_logs.subject_id` widens from `uuid` to `varchar(64)`.
 *
 * The foundation assumed every auditable subject has a UUIDv7 surrogate key,
 * which was true of everything it audited. K1.1 introduces the first subject
 * that does not: an allergen class is keyed on its canonical `code`, the
 * justified primary-key exception recorded in `create_allergens_table`.
 *
 * The alternatives were both worse. Leaving the column a `uuid` and passing
 * NULL falls back to the actor's identifier, so the trail would say a person
 * changed themselves; inventing a surrogate key for allergen classes would
 * undo the exception that exists precisely so a regulatory identity stays
 * readable wherever it appears.
 *
 * The column is a free-form subject reference, not a foreign key — it always
 * was, because it points at whatever `subject_type` names — so widening it
 * loses no integrity guarantee. `varchar(64)` still comfortably holds a UUID
 * (36) and an allergen code (≤ 20), and the
 * `(subject_type, subject_id)` index is unaffected.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE audit_logs ALTER COLUMN subject_id TYPE varchar(64) USING subject_id::text');
    }

    public function down(): void
    {
        // Rolling back the K1 group drops the phase's data, including any
        // audit row whose subject is a code; those rows cannot be cast back
        // to a uuid, so they go with the column.
        DB::statement("DELETE FROM audit_logs WHERE subject_id IS NOT NULL AND subject_id !~ '^[0-9a-fA-F-]{36}$'");
        DB::statement('ALTER TABLE audit_logs ALTER COLUMN subject_id TYPE uuid USING subject_id::uuid');
    }
};
