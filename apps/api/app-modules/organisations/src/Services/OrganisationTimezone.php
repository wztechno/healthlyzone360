<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Services;

use DateTimeZone;
use Healthy360\Orders\OrderDesk\Services\OrderDeskQueue;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;

/**
 * Which clock an organisation-wide period is read in.
 *
 * Three sources, in order, and every one of them is validated before it is
 * returned — a scheduled job that threw because somebody typed `GMT+3` into a
 * settings form would stop publishing prices for every tenant, not just that one.
 *
 * 1. `organisations.timezone`, when an operator has stated one.
 * 2. The organisation's **oldest active branch**, which is the branch a
 *    single-site kitchen has and the head office a multi-site one opened first.
 *    Deterministic by `created_at`, then `id`, so two branches in two timezones
 *    cannot make the answer depend on row order.
 * 3. `config('app.timezone')`, falling back to UTC.
 *
 * The resolution is deliberately *not* cached across requests: it is read once
 * per organisation per scheduled run, and a stale timezone would silently
 * misplace a week boundary — the one failure this class exists to prevent.
 *
 * Copied from {@see OrderDeskQueue::timezoneFor()},
 * which does the same validation for the branch-local case. The duplication is
 * the house pattern for this kind of guard; what differs is the source, not the
 * check.
 */
final class OrganisationTimezone
{
    public function forOrganisation(Organisation $organisation): string
    {
        $stated = $this->valid($organisation->timezone);

        if ($stated !== null) {
            return $stated;
        }

        return $this->fromBranches((string) $organisation->getKey());
    }

    /**
     * The same answer from an identifier, for callers holding one rather than a
     * hydrated row — the scheduled publisher iterates identifiers.
     */
    public function forOrganisationId(string $organisationId): string
    {
        /** @var Organisation|null $organisation */
        $organisation = Organisation::query()->whereKey($organisationId)->first(['id', 'timezone']);

        if (! $organisation instanceof Organisation) {
            return $this->applicationTimezone();
        }

        return $this->forOrganisation($organisation);
    }

    private function fromBranches(string $organisationId): string
    {
        /** @var list<string> $timezones */
        $timezones = OrganisationBranch::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', BranchStatus::Active->value)
            ->orderBy('created_at')
            ->orderBy('id')
            ->pluck('timezone')
            ->all();

        foreach ($timezones as $timezone) {
            $valid = $this->valid($timezone);

            if ($valid !== null) {
                return $valid;
            }
        }

        return $this->applicationTimezone();
    }

    /**
     * The identifier when it is one PostgreSQL and PHP will both accept, null
     * otherwise. An unknown zone is not an error here: it is a reason to fall
     * through to the next source.
     */
    private function valid(?string $timezone): ?string
    {
        if ($timezone === null || $timezone === '') {
            return null;
        }

        return in_array($timezone, DateTimeZone::listIdentifiers(), true) ? $timezone : null;
    }

    private function applicationTimezone(): string
    {
        $configured = config('app.timezone');

        return is_string($configured) ? ($this->valid($configured) ?? 'UTC') : 'UTC';
    }
}
