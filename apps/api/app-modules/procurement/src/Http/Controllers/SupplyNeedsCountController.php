<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Inventory\Http\Controllers\OrderDeskRequirementsController;
use Healthy360\Procurement\Services\OrderProposalService;
use Healthy360\Procurement\Services\SupplyNeedsQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/v1/catalogue/procurement/supply-needs/count — how many shelves at one
 * branch need ordering (§6).
 *
 * The hub's badge, and the landing page's two metrics. Three numbers rather than
 * one because the screen shows two of them separately — *out of stock* and
 * *running low* read very differently to somebody deciding whether to open the
 * builder — and asking twice for a number the same query already has would be a
 * second round trip to say the same thing.
 *
 * **The predicate is not written here.** {@see SupplyNeedsQuery} owns it, and
 * {@see OrderProposalService} lists the very
 * same rows through the very same builder. A badge that disagrees with the list
 * it opens is the failure this arrangement exists to make impossible; a test
 * pins the equality, but the reason it holds is that there is one predicate.
 *
 * ## `branch_id` is required, and it is a query parameter
 *
 * Required for the reason {@see OrderDeskRequirementsController}
 * gives about its own: stock is a quantity on a shelf at a site, and there is no
 * honest organisation-wide answer. Summing three branches' shortages would tell
 * a manager the kitchen needs twelve things when the kitchen they are standing
 * in needs four.
 *
 * A query parameter rather than the `X-Branch-Id` header the low-stock count
 * reads, because this is the branch being *asked about* rather than the branch
 * the caller is working in. A manager holding an organisation-wide membership
 * has no header branch at all and must still be able to prepare an order for a
 * site; making the branch part of the question is what lets them.
 *
 * Requires `inventory.order_supplies_organisation`. Not the plain view code:
 * the number is the front door of the order book, and §5 puts the whole book
 * behind the ordering permission. The existing low-stock KPI keeps its own
 * endpoint and its own view-code gate — that one is a stock warning, this one is
 * a purchasing prompt.
 */
final class SupplyNeedsCountController
{
    public function __construct(private readonly SupplyNeedsQuery $needs) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => [
                'required',
                'uuid',
                Rule::exists('organisation_branches', 'id')->where('organisation_id', $context->organisationId()),
            ],
        ]);

        $counts = $this->needs->counts((string) $validated['branch_id']);

        return ApiResponse::data($counts, ['branch_id' => (string) $validated['branch_id']]);
    }
}
