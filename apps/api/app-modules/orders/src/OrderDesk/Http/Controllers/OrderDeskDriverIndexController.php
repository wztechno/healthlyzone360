<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/order-desk/drivers — the people this kitchen can send
 * out with its food.
 *
 * The picker behind `POST /delivery/jobs/{job}/assign`. That endpoint takes a
 * `driver_user_id` and refuses anybody who is not an **active** member of the
 * organisation; this is where a dispatcher legitimately obtains one, and the two
 * apply the same predicate to the same table on purpose — a list that offered
 * somebody the assign endpoint would then refuse is a dialog that fails on the
 * submit button.
 *
 * ## Every active member is listed, and that is not an oversight
 *
 * **There is no driver role, by design.** The platform has eight template roles
 * and none of them is `driver`, and the delivery module's own routing comment
 * states the reason: *a driver is staff of the kitchen whose jobs these are*.
 * The driver surface narrows by `driver_user_id` rather than by a permission
 * code, because holding the run is what makes it yours. Inventing a role here
 * would mean a kitchen could not hand tonight's late delivery to the chef who
 * offered to drop it off on the way home — which is how small kitchens actually
 * work, and the platform has no business having an opinion about it.
 *
 * So the endpoint answers a question of *fact* — who works here, right now —
 * and the **picker** is where a kitchen's operating judgement lives. A dispatcher
 * looking at a list of colleagues knows which of them drives; the server does
 * not, has never been told, and would have to be told in a schema change to
 * pretend otherwise.
 *
 * `active`, not merely present. An invitation nobody accepted, a suspension and
 * an ended employment are all rows in `organisation_memberships`, and none of
 * them is somebody a kitchen can send out with its food.
 *
 * ## Why the endpoint exists at all
 *
 * Names are the reason. `organisation_memberships` carries a `user_id` and
 * nothing a human reads; `users` carries an email and, deliberately, no name at
 * all — person data lives on `user_profiles`. The invitations surface serves
 * addresses rather than names, so a dispatcher offered that list would be
 * picking a driver out of a column of email addresses. Two fields, joined once,
 * is the whole of what a picker needs.
 *
 * ## `order.manage_organisation`
 *
 * The same code the assign endpoint carries, and the audience is the same
 * person: the dispatcher deciding who takes the run. Sending a driver is the
 * authority to commit the kitchen's operational capacity, and a separate code
 * for *reading the list of candidates* would be an authority nobody could
 * usefully hold on its own — it would mean a person who may assign a job but may
 * not see who to assign it to.
 *
 * A hundred rows, alphabetically, with no cursor. A kitchen with more than a
 * hundred active members has an organisation chart rather than a rota, and a
 * picker is not the surface for browsing one.
 */
final class OrderDeskDriverIndexController
{
    /**
     * The most rows one request returns. Not a page size — there is no second
     * page — so it has to be larger than any kitchen's actual staff list and
     * small enough that a misconfigured organisation cannot hand a dropdown ten
     * thousand options.
     */
    private const int MAX_ROWS = 100;

    /**
     * No parameters at all. A driver is not a branch's — the delivery job knows
     * which branch it came from and the person taking it works for the kitchen,
     * not for a building — so the `branch_id` every other desk endpoint accepts
     * would be a filter that narrowed nothing while inviting a client to believe
     * it had.
     */
    public function __invoke(): JsonResponse
    {
        $rows = $this->drivers();

        return ApiResponse::data($rows, [
            'count' => count($rows),
            'limit' => self::MAX_ROWS,
        ]);
    }

    /**
     * This organisation's active members, named and ordered.
     *
     * **The organisation predicate is the model's global scope**, not a `where`
     * written here, and that is the stronger version: `OrganisationMembership`
     * is `OrganisationScoped`, so there is no query on it that can forget the
     * filter, because forgetting requires the explicit `withoutTenancy()`
     * bypass. It is the same reasoning `DeliveryJobAssignController` gives for
     * resolving a job through the scope rather than through a hand-written
     * predicate — and the scope qualifies its column, so the join below cannot
     * make it ambiguous.
     *
     * The join **cannot fan out**: `user_profiles.user_id` is unique, so one
     * membership meets at most one profile. That is what makes it safe to count
     * the result as a list of people rather than of rows — a join that could
     * duplicate would put the same colleague in a picker twice and the cap would
     * then be counting something other than staff.
     *
     * It is a `LEFT` join and the name may be null. A user row can exist before
     * its profile does, and a member with no profile is still a member —
     * refusing to list them would leave a dispatcher unable to assign a job to
     * somebody who is demonstrably on the payroll. `KitchenOverviewQuery` makes
     * the same call for the same reason: a nullable name, never a fabricated
     * one.
     *
     * Ordering happens in SQL rather than in PHP because the cap is applied in
     * SQL: sorting a hundred rows after the database has chosen which hundred
     * would be alphabetising an arbitrary subset. Nameless members sort **last**
     * — named colleagues first, incomplete records at the bottom — and the user
     * identifier is the tie-break, so two people of the same name do not swap
     * places between two identical requests.
     *
     * `user_profiles` is read as a table rather than through
     * `Identity\Models\UserProfile`. The module registry does give Orders an
     * edge to Identity, opened by the desk's customer-creation path, so the
     * model would be legal — but this is a two-column join inside an ordering
     * expression, which is `OrderDeskQueue::contactsFor()`'s situation exactly,
     * and a model buys nothing here.
     *
     * @return list<array{user_id: string, display_name: string|null}>
     */
    private function drivers(): array
    {
        // The name a person is picked by, assembled in SQL so the sort and the
        // value agree. `NULLIF` turns "no profile at all", and the empty string
        // a blank pair of names would produce, into one null the ordering can
        // put last and the wire can carry honestly.
        $name = "nullif(trim(coalesce(user_profiles.given_name, '') || ' ' || coalesce(user_profiles.family_name, '')), '')";

        $rows = OrganisationMembership::query()
            ->select('organisation_memberships.user_id')
            ->selectRaw($name.' as display_name')
            ->leftJoin('user_profiles', 'user_profiles.user_id', '=', 'organisation_memberships.user_id')
            ->where('organisation_memberships.status', MembershipStatus::Active->value)
            ->orderByRaw('lower('.$name.') asc nulls last')
            ->orderBy('organisation_memberships.user_id')
            ->limit(self::MAX_ROWS)
            ->get();

        $drivers = [];

        foreach ($rows as $row) {
            $displayName = $row->getAttribute('display_name');

            $drivers[] = [
                'user_id' => (string) $row->getAttribute('user_id'),
                'display_name' => is_string($displayName) ? $displayName : null,
            ];
        }

        return $drivers;
    }
}
