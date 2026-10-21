<?php

declare(strict_types=1);

namespace App\Services;

use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Who an organisation's operational notices go to: its active members whose
 * roles carry a given permission — the people who can act on what the notice
 * is about. A kitchen's quotation mail goes to whoever may price quotations,
 * its stock mail to whoever may read the stock.
 *
 * Read under that organisation's tenant context, because membership and role
 * rows sit behind its row-level policies and the caller (a request from the
 * buyer's side, or the scheduler) is in some other context or none.
 */
final readonly class NoticeRecipients
{
    public function __construct(private DatabaseTenantContext $tenantContext) {}

    /**
     * @return list<array{email: string, locale: string}>
     */
    public function holding(string $organisationId, string $permissionCode): array
    {
        /** @var list<object{email: string, locale: string|null}> $rows */
        $rows = $this->tenantContext->during(null, $organisationId, null, static fn (): array => DB::table('organisation_memberships as m')
            ->join('users as u', 'u.id', '=', 'm.user_id')
            ->join('membership_roles as mr', 'mr.membership_id', '=', 'm.id')
            ->join('role_permissions as rp', 'rp.role_id', '=', 'mr.role_id')
            ->join('permissions as p', 'p.id', '=', 'rp.permission_id')
            ->leftJoin('user_profiles as up', 'up.user_id', '=', 'u.id')
            ->where('m.organisation_id', $organisationId)
            ->where('m.status', 'active')
            ->where('p.code', $permissionCode)
            ->whereNotNull('u.email')
            ->select(['u.email', 'up.preferred_language_code as locale'])
            ->distinct()
            ->get()
            ->all());

        return array_values(array_map(static fn (object $row): array => [
            'email' => (string) $row->email,
            'locale' => $row->locale === 'ar' ? 'ar' : 'en',
        ], $rows));
    }
}
