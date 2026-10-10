<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A role becomes a record somebody edits, so it has to say who changed it and
 * refuse to be changed twice at once.
 *
 * Until AA1 a `roles` row was written by a seeder and read by the permission
 * checker. Nothing edited one, so nothing needed to know when an edit
 * collided or who made it. The access console changes both facts at the same
 * moment, and the columns below are what that costs.
 *
 * **`lock_version`, because two administrators on one role is the ordinary
 * case rather than the edge case.** One of them removing
 * `order.manage_organisation` while the other adds
 * `inventory.view_costs_organisation` is a coin flip that last-write-wins
 * settles silently, and the losing write is a permission somebody believes
 * they revoked. `organisations` and `organisation_memberships` already carry
 * the column for weaker reasons than this one; a role is the record where
 * last-write-wins is least defensible, because what it loses is an
 * authorisation decision.
 *
 * **`updated_by`, because `created_by` answers the wrong question.** An access
 * review asks who last changed what this role may reach, and a console that
 * can only say who first created it is a console that cannot answer the one
 * question it exists for. Nullable and `nullOnDelete` like its sibling: a
 * closed account must not take a role's history with it.
 *
 * **Descriptions bilingual and nullable.** `name_en`/`name_ar` set the
 * precedent and the argument is theirs: a role list an Arabic-reading
 * administrator cannot read is a role list that gets ignored. Nullable
 * because a description is prose — a kitchen that names a role
 * "Evening counter" has already said enough.
 *
 * ## Row-level security: a decision, recorded
 *
 * **`roles` needs no change, and its existing policies are exactly right.**
 * `rls_role_select` admits `organisation_id IS NULL OR` an organisation match,
 * so platform templates stay visible in every tenant context and can be read
 * and copied. `insert`, `update` and `delete` require the match, which `NULL`
 * never satisfies — so a tenant *physically cannot* edit a platform template,
 * whatever the application layer says. That is the belt to
 * `RolePolicy::additionalConditions`' braces, and it is why the console offers
 * Copy on a template rather than Edit.
 *
 * **`role_permissions` and `membership_roles` were left outside the policy set
 * here, and this migration is where that was recorded rather than omitted.**
 * AA1 makes `role_permissions` tenant-*writable* for the first time — until now
 * only seeders wrote it — which is precisely the review trigger ADR-0007 asks
 * for. Two reasons were given. The first was that isolation is already real
 * without a policy: every read and write path resolves its `role_id` through a
 * `roles` row the policy above has admitted. That was true and remains true —
 * it is an argument that a policy is *redundant*, not that it is wrong. The
 * second was load-bearing: the suite connects as the schema owner and bypasses
 * RLS by ownership, so a policy added here would have been a policy nothing
 * could prove correct.
 *
 * **`2026_09_16_000004` answers the second reason and adds the policy.**
 * `Healthy360\Tenancy\Tests\Fixtures\RuntimeRole` runs a closure under
 * `SET ROLE healthy360_test`, which is how `tenancy/tests/RlsTest.php` proves
 * the six original tables; `RolePermissionRlsTest` uses it here, including a
 * parity assertion that `PermissionChecker::calculatedPermissions()` returns
 * the same codes under the runtime role as under the owner — the one failure a
 * policy on this table could cause and nothing else would report.
 * `membership_roles` is still outside the set, deliberately, and that
 * migration's docblock says why.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('roles', function (Blueprint $table): void {
            $table->text('description_en')->nullable()->after('name_ar');
            $table->text('description_ar')->nullable()->after('description_en');
            $table->foreignUuid('updated_by')->nullable()->after('created_by')->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0)->after('updated_by');
        });
    }

    public function down(): void
    {
        Schema::table('roles', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('updated_by');
            $table->dropColumn(['description_en', 'description_ar', 'lock_version']);
        });
    }
};
