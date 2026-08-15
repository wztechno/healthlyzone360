<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Services;

use App\Models\User;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationCapability;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\DB;

/**
 * Bringing a kitchen into existence.
 *
 * ## Five writes, one transaction, and none of them optional
 *
 * A kitchen that is only an `organisations` row is a kitchen whose workspace
 * refuses on the first screen. `org.context` resolves a *branch* for the
 * kitchen area's `requiresBranch` gate; `kitchen_production` is the capability
 * the workspace reads to know what it is; a `b2c_web` sales channel is what a
 * published meal has to be made available *on* before a price can resolve or a
 * marketplace listing can appear; and a `pos` one is where a walk-in is sold.
 * So all five land together, or none do.
 *
 * The alternative — create the organisation, let the operator add a branch and
 * a channel afterwards — was rejected because it makes the console's success
 * message a lie for the twenty minutes before somebody notices. A new kitchen
 * works immediately; it simply has nothing in it yet.
 *
 * ## The fifth write: a kitchen that can take a web order but not a counter one is half-provisioned
 *
 * The Order Desk sells through a **dedicated `desk` channel** (owner decision,
 * 2026-08-15), kind `pos`, order source `desk`. Nothing about a walk-in is
 * exceptional — a kitchen with a till is the most ordinary thing there is — so
 * the counter is provisioned with the shop rather than added afterwards by
 * somebody who has read the manual. Left out, the desk's placement path refuses
 * with `desk channel missing` and the console's "your kitchen is ready" is true
 * of one half of the business.
 *
 * It is a separate row from the web shop, not a reuse of it, because a counter
 * assortment is not a web assortment: a kitchen may want the catering trays
 * across the counter and not on the site. The cost of that choice is that items
 * and tariffs have to be assigned to *both* channels; the drift that follows is
 * recorded where it bites, in
 * `2026_08_15_003004_open_a_desk_channel_for_every_kitchen`.
 *
 * **Nothing is backfilled here, and there is nothing to backfill.** A kitchen
 * created a moment ago has no catalogue items and no price lists, so the desk
 * opens empty and stays a mirror of an empty web shop. The two data migrations
 * that duplicate `channel_catalogue_items` and `channel_price_lists` exist for
 * the kitchens that were provisioned *before* the desk did — they are a
 * one-time correction of history, not part of this path.
 *
 * ## `sales_channels` is per-organisation, and this reuses it
 *
 * `SalesChannel` has a NOT NULL `organisation_id` and the migration says in as
 * many words that there is no platform channel library and there should not
 * be. So this writes exactly the row `DemoTenantSeeder` writes for Verdant —
 * code `web-shop`, kind `b2c_web`, order source `web` — through the same
 * columns. The wholesale channel is deliberately *not* created: a kitchen that
 * has never traded with a company does not need a B2B channel sitting inactive
 * in its list, and `SalesChannelService` exists for when it does. That argument
 * does not reach the desk: a counter is not a commercial arrangement with
 * somebody, it is how the kitchen sells to whoever walks in.
 *
 * ## `active`, not `pending`
 *
 * A kitchen created by the platform has already been decided about — the
 * decision *is* the console click — so there is nothing for `pending` to mean.
 * The status that would be earned by a self-service signup queue belongs to
 * that queue, if it ever exists.
 *
 * ## `withoutTenancy()` on the scoped writes
 *
 * Branches, capabilities and channels are organisation-scoped, and the actor
 * is the platform operator sitting in a different organisation's context. The
 * scope would refuse every one of them, correctly, which is exactly why the
 * bypass is stated here at each of the five call sites rather than by widening
 * anything.
 */
final readonly class KitchenProvisioning
{
    public const string KITCHEN_CAPABILITY = 'kitchen_production';

    public const string DEFAULT_CHANNEL_CODE = 'web-shop';

    /**
     * The counter. Read by the Order Desk's channel locator, by the backfill
     * migration that opened one for every kitchen provisioned before this
     * constant existed, and by `DemoTenantSeeder`.
     */
    public const string DESK_CHANNEL_CODE = 'desk';

    public function __construct(private AuditRecorder $audit) {}

    /**
     * @param  array{
     *     name_en: string,
     *     name_ar: string,
     *     slug: string,
     *     country_code: string,
     *     default_currency_code: string,
     *     default_language_code: string,
     *     timezone: string,
     *     branch_name: string,
     *     city: string|null
     * }  $payload
     *
     * @throws ApiException
     */
    public function create(array $payload, User $actor): Organisation
    {
        $type = OrganisationType::query()
            ->where('code', KitchenOrganisationLocator::KITCHEN_TYPE)
            ->first();

        if (! $type instanceof OrganisationType) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'The kitchen organisation type is not seeded on this installation.',
            );
        }

        $slug = mb_strtolower(trim($payload['slug']));

        if (Organisation::query()->where('slug', $slug)->exists()) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'That slug is already taken.',
                ['fields' => ['slug' => ['That slug is already taken.']]],
            );
        }

        $kitchen = DB::transaction(function () use ($payload, $slug, $type, $actor): Organisation {
            $kitchen = new Organisation;
            // `organisations` carries a single `name`, not the bilingual pair
            // most catalogue tables do. The console still collects both,
            // because the operator typing it knows both and asking later is
            // worse — the Arabic goes where the platform already keeps Arabic
            // organisation naming, which is the branch and the channel.
            $kitchen->organisation_type_id = (string) $type->getKey();
            $kitchen->name = trim($payload['name_en']);
            $kitchen->slug = $slug;
            $kitchen->country_code = mb_strtoupper($payload['country_code']);
            $kitchen->default_currency_code = mb_strtoupper($payload['default_currency_code']);
            $kitchen->default_language_code = mb_strtolower($payload['default_language_code']);
            $kitchen->status = OrganisationStatus::Active;
            $kitchen->created_by = (string) $actor->getKey();
            $kitchen->save();

            OrganisationBranch::withoutTenancy()->create([
                'organisation_id' => (string) $kitchen->getKey(),
                'name' => trim($payload['branch_name']),
                'country_code' => $kitchen->country_code,
                'city' => $payload['city'] === null || trim($payload['city']) === '' ? null : trim($payload['city']),
                'timezone' => trim($payload['timezone']),
                'status' => BranchStatus::Active,
                'created_by' => (string) $actor->getKey(),
            ]);

            OrganisationCapability::withoutTenancy()->updateOrCreate(
                ['organisation_id' => (string) $kitchen->getKey(), 'capability' => self::KITCHEN_CAPABILITY],
                ['is_enabled' => true, 'created_by' => (string) $actor->getKey()],
            );

            SalesChannel::withoutTenancy()->updateOrCreate(
                ['organisation_id' => (string) $kitchen->getKey(), 'code' => self::DEFAULT_CHANNEL_CODE],
                [
                    'channel_kind' => SalesChannelKind::B2cWeb,
                    'name_en' => trim($payload['name_en']).' web shop',
                    'name_ar' => trim($payload['name_ar']),
                    'order_source' => 'web',
                    'status' => SalesChannelStatus::Active,
                    'created_by' => (string) $actor->getKey(),
                    'updated_by' => (string) $actor->getKey(),
                ],
            );

            // The counter. `order_source` is `desk` rather than `pos`: the
            // column records how an order arriving here labels itself, and
            // `pos` was the deleted module's word for a till that bypassed
            // pricing, stock and the order book entirely. A desk sale is an
            // ordinary order that a member of staff placed, and calling it
            // something else keeps the two apart in every report that groups by
            // this column. `DemoTenantSeeder`'s separate `counter` channel
            // keeps `pos` for exactly that reason — it is a different row about
            // a different thing.
            SalesChannel::withoutTenancy()->updateOrCreate(
                ['organisation_id' => (string) $kitchen->getKey(), 'code' => self::DESK_CHANNEL_CODE],
                [
                    'channel_kind' => SalesChannelKind::Pos,
                    'name_en' => trim($payload['name_en']).' order desk',
                    'name_ar' => 'مكتب طلبات '.trim($payload['name_ar']),
                    'order_source' => 'desk',
                    'status' => SalesChannelStatus::Active,
                    'created_by' => (string) $actor->getKey(),
                    'updated_by' => (string) $actor->getKey(),
                ],
            );

            return $kitchen;
        });

        $this->audit->record(
            'platform.kitchen_created',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'organisation',
            subjectId: (string) $kitchen->getKey(),
            metadata: [
                'slug' => $kitchen->slug,
                'name' => $kitchen->name,
                'country' => $kitchen->country_code,
                'currency' => $kitchen->default_currency_code,
                'language' => $kitchen->default_language_code,
            ],
        );

        return $kitchen;
    }
}
