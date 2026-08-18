<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Services\OrderProposalService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/v1/catalogue/procurement/order-proposal — what one branch should
 * order, and who from (§6).
 *
 * The builder screen's whole read: the shortage queue in the order it should be
 * worked, the quantity the system is willing to suggest for each row, and the
 * suppliers each could be bought from. {@see OrderProposalService} argues every
 * rule; this class validates the two inputs and hands them over.
 *
 * ## Nothing is created
 *
 * A GET, and it stays a GET through slice 4. Reading a proposal twice must be
 * free of consequence — the builder re-reads it whenever the person adds an item
 * or presses Refresh — and a screen that minted a draft order by being opened
 * would leave a kitchen's order book full of things nobody decided to buy.
 * Creating the drafts is slice 4's transactional batch write.
 *
 * ## `stock_item_ids` is the **Add another item** list
 *
 * Optional, repeated as `stock_item_ids[]=…`, and every id is checked against
 * this organisation's shelves so a hand-typed identifier from another kitchen is
 * a `422` naming the field rather than a row that quietly fails to appear.
 * Capped at a hundred: the cap is about what a person can plausibly be ordering
 * by hand in one sitting, and a request past it is a client bug worth being told
 * about rather than a page worth rendering.
 *
 * The requested rows come back through the server rather than being assembled on
 * the client, which is the point of sending the ids at all: one place decides
 * what a proposal row looks like, and the row for a shelf somebody typed in is
 * the same shape as the row for a shelf that ran out.
 *
 * Requires `inventory.order_supplies_organisation` — the read is the order book
 * (§5), and no part of this response is cost-bearing.
 */
final class OrderProposalController
{
    /**
     * The most shelves one person may add by hand to a single proposal.
     */
    private const int MAX_REQUESTED_ITEMS = 100;

    public function __construct(private readonly OrderProposalService $proposals) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $organisationId = $context->organisationId();

        $validated = $request->validate([
            'branch_id' => [
                'required',
                'uuid',
                Rule::exists('organisation_branches', 'id')->where('organisation_id', $organisationId),
            ],
            'stock_item_ids' => ['nullable', 'array', 'max:'.self::MAX_REQUESTED_ITEMS],
            'stock_item_ids.*' => [
                'uuid',
                Rule::exists('stock_items', 'id')->where('organisation_id', $organisationId),
            ],
        ]);

        /** @var list<string> $requested */
        $requested = array_values(array_map(strval(...), $validated['stock_item_ids'] ?? []));

        $proposal = $this->proposals->propose((string) $validated['branch_id'], $requested);

        return ApiResponse::data(
            ['items' => $proposal['items']],
            $proposal['meta'] + ['max_requested_items' => self::MAX_REQUESTED_ITEMS],
        );
    }
}
