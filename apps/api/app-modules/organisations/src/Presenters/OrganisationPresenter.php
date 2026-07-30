<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Presenters;

use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationCapability;

/**
 * The wire shape of an organisation and its branch, shared by /api/v1/me and
 * /api/v1/organisations/current so the two can never drift. Mirrors the
 * Organisation schema in openapi/healthy360.v1.yaml.
 */
final class OrganisationPresenter
{
    /**
     * @return array{
     *     id: string,
     *     slug: string,
     *     name: string,
     *     type: string|null,
     *     status: string,
     *     country_code: string,
     *     default_currency_code: string,
     *     default_language_code: string,
     *     capabilities: list<string>
     * }
     */
    public function organisation(Organisation $organisation): array
    {
        return [
            'id' => (string) $organisation->getKey(),
            'slug' => $organisation->slug,
            'name' => $organisation->name,
            'type' => $organisation->type?->code,
            'status' => $organisation->status->value,
            'country_code' => $organisation->country_code,
            'default_currency_code' => $organisation->default_currency_code,
            'default_language_code' => $organisation->default_language_code,
            'capabilities' => $this->capabilities($organisation),
        ];
    }

    /**
     * @return array{id: string, name: string, city: string|null, timezone: string, status: string}
     */
    public function branch(OrganisationBranch $branch): array
    {
        return [
            'id' => (string) $branch->getKey(),
            'name' => $branch->name,
            'city' => $branch->city,
            'timezone' => $branch->timezone,
            'status' => $branch->status->value,
        ];
    }

    /**
     * Enabled capability codes. Read without tenancy because the caller may
     * be hydrating organisations it is a member of without having selected
     * one of them as the active context.
     *
     * @return list<string>
     */
    private function capabilities(Organisation $organisation): array
    {
        /** @var list<string> */
        return OrganisationCapability::withoutTenancy()
            ->where('organisation_id', $organisation->getKey())
            ->where('is_enabled', true)
            ->orderBy('capability')
            ->pluck('capability')
            ->all();
    }
}
