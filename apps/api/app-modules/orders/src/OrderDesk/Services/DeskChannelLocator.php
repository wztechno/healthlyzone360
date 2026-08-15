<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Services;

use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * Which channel the desk sells through, for one kitchen.
 *
 * Every desk surface has to answer this before it can do anything at all: a
 * quote prices *through* a channel, a placement is denominated by one, and
 * `LineProbe` refuses an article no channel has been given. The web shop is not
 * the answer — the owner's 2026-08-15 decision was a **dedicated `desk`
 * channel** so a kitchen may put the catering trays across the counter without
 * putting them on the website — so the lookup is a real one and it belongs in
 * one place rather than at both call sites.
 *
 * ## The code is duplicated here on purpose
 *
 * `KitchenProvisioning::DESK_CHANNEL_CODE` holds the same string, and this
 * class deliberately does not import it. Orders reading a constant out of
 * platform-administration would be a dependency pointing the wrong way — that
 * module provisions tenants and knows what an order desk is; this one takes
 * orders and must not know that a provisioning console exists. Two `'desk'`
 * literals thirty characters long is a cheaper price than an edge in the module
 * graph, and the drift they could suffer is a channel nobody can sell through,
 * which is exactly the failure the refusal below is written to explain. The
 * provisioning constant's own docblock names this class so the pair stays
 * findable from either end.
 *
 * ## Missing is a conflict, not a not-found
 *
 * **`409 resource.conflict`, and the message is written for the operator.** A
 * kitchen with no desk channel is not a bad request — the agent asked a
 * perfectly reasonable question — and it is not a missing *resource* either,
 * because the thing the caller named (their own organisation) is right there.
 * What is wrong is the state of the world behind it, which is the 409's whole
 * job on this platform.
 *
 * It is a state a real kitchen reaches, which is why the sentence names the fix
 * rather than the fault. Organisations provisioned before the desk existed were
 * backfilled by a data migration; organisations that never had a **web shop**
 * were not, because the backfill duplicated the web shop's assortment and there
 * was nothing to duplicate. So a kitchen created by a seeder, an importer or a
 * fixture can legitimately arrive here with nothing to sell through.
 *
 * **An `inactive` channel refuses too, and separately.** `LineProbe` would
 * catch it — `channel_not_trading` lands on every line — but as a per-line
 * refusal on a quote, which reads as "none of these articles is available" when
 * the truth is "the counter is switched off". One sentence about the counter
 * beats twelve about the food.
 */
final class DeskChannelLocator
{
    /**
     * The counter's channel code, one organisation at a time.
     *
     * A local constant rather than an import — see the class docblock. The same
     * string is written by `KitchenProvisioning`, by
     * `2026_08_15_003004_open_a_desk_channel_for_every_kitchen` and by
     * `DemoTenantSeeder`.
     */
    private const string DESK_CHANNEL_CODE = 'desk';

    /**
     * The kitchen's desk channel, or a sentence explaining why it has none.
     *
     * `withoutTenancy()` with an explicit `organisation_id`, which is the
     * construction every cross-cutting read on this table uses: the ambient
     * scope is fine for a kitchen screen and is not what this is — the caller
     * may be a queued job, a console command or a request whose tenant context
     * is the same organisation anyway, and stating the filter is what makes all
     * three identical.
     *
     * @throws ApiException
     */
    public function forOrganisation(string $organisationId): SalesChannel
    {
        $channel = SalesChannel::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('code', self::DESK_CHANNEL_CODE)
            ->first();

        if (! $channel instanceof SalesChannel) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This kitchen has no order desk channel, so nothing can be sold across the counter yet. Open a sales channel coded "desk" and give it the articles and price lists the counter should offer.',
                ['sales_channel_code' => self::DESK_CHANNEL_CODE],
            );
        }

        if ($channel->status !== SalesChannelStatus::Active) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This kitchen\'s order desk channel is not trading. Reactivate it before selling across the counter.',
                [
                    'sales_channel_code' => self::DESK_CHANNEL_CODE,
                    'sales_channel_id' => (string) $channel->getKey(),
                    'status' => $channel->status->value,
                ],
            );
        }

        return $channel;
    }
}
