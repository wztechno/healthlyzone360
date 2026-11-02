<?php

declare(strict_types=1);

namespace App\Services;

use Closure;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Database\Query\Builder;
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
    /**
     * The owner role and the copies of it the role split left behind:
     * `organisation_owner_standard`, then `organisation_owner_standard_2` and on
     * (2026_10_26_000001_give_every_organisation_its_own_roles).
     */
    private const string OWNER_ROLE_CODES = '^organisation_owner(_standard(_[0-9]+)?)?$';

    public function __construct(private DatabaseTenantContext $tenantContext) {}

    /**
     * @return list<array{email: string, locale: string}>
     */
    public function holding(string $organisationId, string $permissionCode): array
    {
        return array_map(static fn (array $recipient): array => [
            'email' => $recipient['email'],
            'locale' => $recipient['locale'],
        ], $this->usersHolding($organisationId, $permissionCode));
    }

    /**
     * @return list<array{user_id: string, email: string, locale: string}>
     */
    public function usersHolding(string $organisationId, string $permissionCode): array
    {
        return $this->members($organisationId, static fn (Builder $query): Builder => $query
            ->join('role_permissions as rp', 'rp.role_id', '=', 'mr.role_id')
            ->join('permissions as p', 'p.id', '=', 'rp.permission_id')
            ->where('p.code', $permissionCode));
    }

    /**
     * @return list<array{user_id: string, email: string, locale: string}>
     */
    public function owners(string $organisationId): array
    {
        return $this->members($organisationId, static fn (Builder $query): Builder => $query
            ->join('roles as r', 'r.id', '=', 'mr.role_id')
            ->whereRaw('r.code ~ ?', [self::OWNER_ROLE_CODES]));
    }

    /**
     * @param  Closure(Builder): Builder  $havingRole  narrows the active members by their roles (`mr`)
     * @return list<array{user_id: string, email: string, locale: string}>
     */
    private function members(string $organisationId, Closure $havingRole): array
    {
        /** @var list<object{user_id: string, email: string, locale: string|null}> $rows */
        $rows = $this->tenantContext->during(null, $organisationId, null, static fn (): array => $havingRole(DB::table('organisation_memberships as m')
            ->join('users as u', 'u.id', '=', 'm.user_id')
            ->join('membership_roles as mr', 'mr.membership_id', '=', 'm.id'))
            ->leftJoin('user_profiles as up', 'up.user_id', '=', 'u.id')
            ->where('m.organisation_id', $organisationId)
            ->where('m.status', 'active')
            // The same two conditions `PermissionChecker` reads, so nobody is told
            // about something a role they no longer hold would let them act on.
            ->where(static fn (Builder $query): Builder => $query->whereNull('mr.starts_at')->orWhere('mr.starts_at', '<=', now()))
            ->where(static fn (Builder $query): Builder => $query->whereNull('mr.expires_at')->orWhere('mr.expires_at', '>', now()))
            ->whereNotNull('u.email')
            ->select(['u.id as user_id', 'u.email', 'up.preferred_language_code as locale'])
            ->distinct()
            ->get()
            ->all());

        return array_values(array_map(static fn (object $row): array => [
            'user_id' => (string) $row->user_id,
            'email' => (string) $row->email,
            'locale' => $row->locale === 'ar' ? 'ar' : 'en',
        ], $rows));
    }
}
