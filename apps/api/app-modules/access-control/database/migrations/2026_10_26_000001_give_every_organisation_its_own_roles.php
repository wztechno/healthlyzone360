<?php

declare(strict_types=1);

use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Every organisation gets its own copy of each platform template role, and
 * everybody who held a template now holds their organisation's copy.
 *
 * The templates (`organisation_id NULL`) were one row per code shared by every
 * kitchen, so none of them could be edited. After this nothing assigns them;
 * `OrganisationRoles::provision()` stamps copies for organisations created
 * later.
 *
 * ## A kitchen that already shadows a template code
 *
 * A kitchen may have defined its own role with a template's code
 * (`AccessAdministrationQuery::shadowsTemplate`). Its holders of the *template*
 * must keep exactly the permissions they have today, so they are not folded
 * onto the kitchen's custom role: the template is copied under a free code,
 * `<code>_standard`, named "… (standard)", and they move onto that. Because
 * every target is a brand-new row, no membership already holds it and
 * `unique(membership_id, role_id)` cannot collide; `starts_at`, `expires_at`
 * and `created_by` ride along on the updated rows. A shadowed template nobody
 * holds is not copied — the kitchen already has a role of that code.
 *
 * Raw queries, run as the migration owner (RLS is enabled, not forced), so the
 * migration keeps meaning what it says when the models move on.
 */
return new class extends Migration
{
    public function up(): void
    {
        $templates = DB::table('roles')->whereNull('organisation_id')->orderBy('code')->get();

        if ($templates->isEmpty()) {
            return;
        }

        $grants = DB::table('role_permissions')
            ->whereIn('role_id', $templates->pluck('id'))
            ->get(['role_id', 'permission_id'])
            ->groupBy('role_id');

        $identifiers = app(IdentifierService::class);

        foreach (DB::table('organisations')->orderBy('id')->pluck('id') as $organisationId) {
            DB::transaction(function () use ($organisationId, $templates, $grants, $identifiers): void {
                $owned = DB::table('roles')->where('organisation_id', $organisationId)->pluck('code')->flip()->all();

                foreach ($templates as $template) {
                    $holders = DB::table('membership_roles')
                        ->join('organisation_memberships', 'organisation_memberships.id', '=', 'membership_roles.membership_id')
                        ->where('organisation_memberships.organisation_id', $organisationId)
                        ->where('membership_roles.role_id', $template->id)
                        ->pluck('membership_roles.id');

                    $shadowed = isset($owned[$template->code]);

                    if ($shadowed && $holders->isEmpty()) {
                        continue;
                    }

                    $code = $template->code;
                    $suffix = '';

                    if ($shadowed) {
                        $code = $this->freeCode($template->code.'_standard', $owned);
                        $suffix = ' (standard)';
                    }

                    $copyId = $identifiers->generate();
                    $now = now();

                    DB::table('roles')->insert([
                        'id' => $copyId,
                        'organisation_id' => $organisationId,
                        'code' => $code,
                        'name_en' => $template->name_en.$suffix,
                        'name_ar' => $template->name_ar.($shadowed ? ' (قياسي)' : ''),
                        'description_en' => $template->description_en,
                        'description_ar' => $template->description_ar,
                        'is_system' => false,
                        'lock_version' => 0,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);

                    $owned[$code] = true;

                    $rows = ($grants[$template->id] ?? collect())->map(fn (object $grant): array => [
                        'id' => $identifiers->generate(),
                        'organisation_id' => $organisationId,
                        'role_id' => $copyId,
                        'permission_id' => $grant->permission_id,
                        'created_at' => $now,
                    ])->all();

                    if ($rows !== []) {
                        DB::table('role_permissions')->insert($rows);
                    }

                    if ($holders->isNotEmpty()) {
                        DB::table('membership_roles')
                            ->whereIn('id', $holders)
                            ->update(['role_id' => $copyId, 'updated_at' => $now]);
                    }
                }
            });
        }

        $stranded = DB::table('membership_roles')
            ->join('roles', 'roles.id', '=', 'membership_roles.role_id')
            ->whereNull('roles.organisation_id')
            ->count();

        if ($stranded > 0) {
            throw new RuntimeException("{$stranded} role assignment(s) still point at a platform template.");
        }

        app(PermissionCache::class)->bumpVersion(null);
    }

    /**
     * Not reversed. The copies are kitchen data from the moment they exist —
     * renamed, re-granted, assigned — and folding them back onto shared rows
     * would discard those edits without anyone deciding to.
     */
    public function down(): void {}

    /**
     * @param  array<string, mixed>  $owned
     */
    private function freeCode(string $base, array $owned): string
    {
        $code = $base;

        for ($n = 2; isset($owned[$code]); $n++) {
            $code = $base.'_'.$n;
        }

        return $code;
    }
};
