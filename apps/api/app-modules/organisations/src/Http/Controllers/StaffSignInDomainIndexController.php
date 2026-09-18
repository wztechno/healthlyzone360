<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Http\Controllers;

use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/auth/staff-domains — the organisations whose staff sign in with
 * a name rather than an address.
 *
 * ## What this is for
 *
 * A kitchen hand does not have a work email address, so their login is composed
 * from a local part they type and a domain their kitchen owns. The sign-in
 * screen needs the list of domains to render the picker, and it needs it
 * **before** anybody has signed in — which is the entire reason this endpoint is
 * anonymous and lives here rather than in the access console.
 *
 * ## Why an anonymous list of tenants is acceptable here, and is not next door
 *
 * The invitation endpoints go to deliberate lengths not to confirm that a given
 * organisation exists: a 404 rather than a 403 on a mismatched path, one
 * indistinguishable answer for every way a token can fail. The difference is
 * worth stating rather than leaving as an apparent inconsistency.
 *
 * Nothing here is a secret in the first place. An organisation's **name** is
 * already on the public marketplace, and a staff **domain** is the right-hand
 * side of every staff address that organisation has ever issued — it appears in
 * every "from" line and on every business card. The list discloses nothing that
 * was not already disclosed, and withholding it would only mean the sign-in
 * screen could not be built.
 *
 * It is narrow in the two ways that matter. Only organisations that have **set**
 * a domain appear, so listing is opt-in by an act somebody took deliberately;
 * and only `active` ones, because a suspended or closed tenant's staff cannot
 * sign in and offering the option would be an invitation to a refusal.
 *
 * Name and domain, and nothing else. No identifier, no slug, no status, no
 * counts — the picker needs a label and a suffix, and anything further would be
 * answering questions about a tenant to anybody who asked.
 *
 * Ordered by name so the list is stable between requests; a picker whose
 * options move is a picker people mis-click.
 */
final class StaffSignInDomainIndexController
{
    public function __invoke(): JsonResponse
    {
        // `Organisation` carries no organisation scope of its own — it *is*
        // the organisation — so the ordinary query is already unscoped, which
        // is what an anonymous caller needs.
        $domains = Organisation::query()
            ->whereNotNull('staff_email_domain')
            ->where('status', OrganisationStatus::Active)
            ->orderBy('name')
            ->get(['name', 'staff_email_domain'])
            ->map(static fn (Organisation $organisation): array => [
                'organisation_name' => (string) $organisation->name,
                'domain' => (string) $organisation->staff_email_domain,
            ])
            ->all();

        return ApiResponse::data(['domains' => $domains]);
    }
}
