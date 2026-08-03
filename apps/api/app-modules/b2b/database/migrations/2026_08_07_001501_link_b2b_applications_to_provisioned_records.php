<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The provisioning seam B1 declared and deliberately left open.
 *
 * An approved application eventually becomes two real records — a corporate
 * customer organisation and the B2B customer account that trades against it —
 * and until now nothing wrote down which. The link matters for a reason that
 * outlives the happy path: when somebody asks a year later *why* this
 * organisation exists and on what evidence it was admitted, the answer has to
 * be a foreign key rather than a name match on a legal name that has since
 * changed.
 *
 * Both are `nullOnDelete` rather than cascading. Deleting a provisioned
 * organisation must not take the application that justified it with it — the
 * application is the evidence, and evidence outlives what it produced.
 *
 * The uniques are partial, which is what makes provisioning idempotent at the
 * database rather than only in the service: one application provisions exactly
 * one organisation, and a replayed `POST …/provision` cannot produce a second.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('b2b_applications', function (Blueprint $table): void {
            $table->foreignUuid('provisioned_organisation_id')->nullable()->after('duplicate_of_application_id')
                ->comment('the corporate customer this approved application produced')
                ->constrained('organisations')->nullOnDelete();

            $table->foreignUuid('customer_account_id')->nullable()->after('provisioned_organisation_id')
                ->comment('the b2b customer account opened against that organisation')
                ->constrained('customer_accounts')->nullOnDelete();
        });

        // Provisioning is once-only, and the database says so rather than
        // trusting the service to remember.
        DB::statement('CREATE UNIQUE INDEX b2b_applications_provisioned_organisation_unique ON b2b_applications (provisioned_organisation_id) WHERE provisioned_organisation_id IS NOT NULL');
        DB::statement('CREATE UNIQUE INDEX b2b_applications_customer_account_unique ON b2b_applications (customer_account_id) WHERE customer_account_id IS NOT NULL');

        // The two are provisioned together, in one transaction, or not at all.
        // A half-provisioned application — an organisation with no trading
        // account, or an account with nothing to trade for — is not a state
        // anybody should have to interpret.
        DB::statement('ALTER TABLE b2b_applications ADD CONSTRAINT b2b_applications_provisioning_check CHECK ((provisioned_organisation_id IS NULL) = (customer_account_id IS NULL))');

        // Only an approved application can have produced anything.
        DB::statement("ALTER TABLE b2b_applications ADD CONSTRAINT b2b_applications_provisioned_status_check CHECK (provisioned_organisation_id IS NULL OR status = 'approved')");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE b2b_applications DROP CONSTRAINT IF EXISTS b2b_applications_provisioned_status_check');
        DB::statement('ALTER TABLE b2b_applications DROP CONSTRAINT IF EXISTS b2b_applications_provisioning_check');
        DB::statement('DROP INDEX IF EXISTS b2b_applications_customer_account_unique');
        DB::statement('DROP INDEX IF EXISTS b2b_applications_provisioned_organisation_unique');

        Schema::table('b2b_applications', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('customer_account_id');
            $table->dropConstrainedForeignId('provisioned_organisation_id');
        });
    }
};
