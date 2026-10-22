<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Orders\OrderDesk\Presenters\KitchenCustomerPresenter;
use Healthy360\Orders\OrderDesk\Services\DeskCustomerDirectory;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/catalogue/customers — the kitchen's customer book.
 *
 * A read-only reference list: every account the browse rule in
 * `DeskCustomerDirectory` admits (ordered here, written down by this kitchen's
 * staff, or a corporate buyer holding a programme here), most recent first,
 * capped at `BROWSE_LIMIT` with the true total beside it so the screen can say
 * "search to narrow" instead of pretending the list is complete.
 *
 * Behind `order.view_customer_contact_organisation`, like the desk search. No
 * minimum query length: the list is the point of the page.
 */
final class KitchenCustomerIndexController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly DeskCustomerDirectory $directory,
        private readonly KitchenCustomerPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'query' => ['nullable', 'string', 'max:60'],
            'type' => ['nullable', Rule::enum(CustomerAccountType::class)],
        ]);

        $organisationId = $this->locator->sellerId();

        $type = isset($validated['type']) ? CustomerAccountType::from((string) $validated['type']) : null;

        $book = $this->directory->browse($organisationId, $validated['query'] ?? null, $type);

        $contacts = $this->directory->contactPointsFor($book['rows']);

        $rows = [];

        foreach ($book['rows'] as $account) {
            $rows[] = $this->presenter->row($account, $contacts[(string) $account->getKey()] ?? []);
        }

        return ApiResponse::data($rows, [
            'count' => count($rows),
            'total' => $book['total'],
            'truncated' => $book['total'] > count($rows),
        ]);
    }
}
