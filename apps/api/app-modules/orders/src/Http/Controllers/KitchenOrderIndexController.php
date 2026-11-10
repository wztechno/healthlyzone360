<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\OrderDesk\Services\OrderDeskQueue;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderAmendability;
use Healthy360\Orders\Services\OrderDeliveryRuns;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Orders\Services\OrderQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\OffsetPage;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * GET /api/v1/catalogue/orders — one kitchen's book, newest first.
 *
 * **The seller filter is not a filter.** `orders` carries no PostgreSQL policy
 * and no global Eloquent scope, because the row belongs to a customer who is a
 * member of nothing and an ambient organisation scope would hide an order from
 * the person who placed it. `OrderQuery::forSeller()` is therefore the isolation
 * boundary rather than a convenience, and the organisation comes from
 * `TenantContext` — validated by `org.context` against an active membership —
 * never from a query parameter, which would be a client asserting whose book it
 * is reading.
 *
 * **Three filters, because this list grows without limit.** Unlike a person's
 * own history, a kitchen's book accumulates for as long as the kitchen trades,
 * and the three questions staff actually ask it are "what is still open", "what
 * is going out on Thursday" and "where is order H360-…". `branch_id` is the
 * fourth: a two-branch kitchen wants one production site's day.
 *
 * `requested_delivery_date` matches on the day the food is wanted, **not** on
 * the day the order was taken. Those diverge by design — an order placed on
 * Monday for Friday is Friday's work — and a list keyed on the placement date
 * would show a kitchen the wrong day's production every time.
 *
 * `query` searches the **order number only**, and case-insensitively. Not the
 * customer's name, not the address: a staff-facing search across confidential
 * columns is how a directory of everybody a kitchen has ever delivered to gets
 * built one query at a time. The number is what is printed on the receipt in
 * the caller's hand.
 *
 * Served through the **kitchen** shape, which does carry `lock_version` — this
 * is the audience that writes, and a screen that could not read the validator
 * could not send the `If-Match` the lifecycle actions demand.
 *
 * **Each row also carries what the desk queue's row carries** — the payment
 * position, the delivery run and, for a caller allowed to read it, the
 * customer's name and number — read for the whole page in one statement each,
 * through the queue's own helpers, so the two lists cannot disagree. Read-only:
 * nothing here moves an order.
 *
 * `from` and `to` narrow to the orders whose day falls in the span, the day
 * being the requested delivery date or, for an order with none, the day it was
 * placed — the rule the order-desk calendar counts by, so a day's list and the
 * calendar's count for it agree. `delivery_window_code[]` narrows to named
 * slots (a sitting has two names), `fulfilment_type` to one way of leaving.
 */
final class KitchenOrderIndexController
{
    /** The same disclosure the desk queue makes, behind the same code. */
    private const string CONTACT_PERMISSION = 'order.view_customer_contact_organisation';

    /** The calendar's day for an order — see `CalendarComposition`. */
    private const string ORDER_DAY = 'COALESCE(requested_delivery_date, placed_at::date)';

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderQuery $orders,
        private readonly OrderPresenter $presenter,
        private readonly OrderDeliveryRuns $runs,
        private readonly OrderAmendability $amendability,
        private readonly OrderDeskQueue $queue,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $query = $this->orders->forSeller($this->locator->sellerId());

        $this->applyStatus($request, $query);
        $this->applyRequestedDate($request, $query);
        $this->applyBranch($request, $query);
        $this->applySearch($request, $query);
        $this->applyCustomer($request, $query);
        $this->applyDaySpan($request, $query);
        $this->applyWindowCodes($request, $query);
        $this->applyFulfilmentType($request, $query);

        $page = $this->page($request, $query);
        $lines = $this->linesFor($page['items']->modelKeys());
        $runs = $this->runs->forOrders(array_map('strval', $page['items']->modelKeys()));
        $amendable = $this->amendability->reasons($page['items'], $lines);
        $this->presenter->preloadPlanDays(array_values(array_map('strval', $page['items']->modelKeys())));
        $this->presenter->preloadRemakes(array_values(array_map('strval', $page['items']->modelKeys())));

        $orderIds = array_values(array_map('strval', $page['items']->modelKeys()));
        $received = $this->queue->receivedByOrder($orderIds);
        $deliveryJobs = $this->queue->deliveryJobsByOrder($orderIds);
        $includeContact = Gate::allows(self::CONTACT_PERMISSION);
        $contacts = $includeContact ? $this->queue->contactsForOrders(array_values($page['items']->all())) : [];

        return ApiResponse::data(
            $page['items']->map(function (Order $order) use ($lines, $runs, $amendable, $received, $deliveryJobs, $includeContact, $contacts): array {
                $id = (string) $order->getKey();
                $row = $this->presenter->kitchen(
                    $order,
                    $lines[$id] ?? [],
                    $runs[$id] ?? null,
                    ($amendable[$id] ?? null) === null,
                );

                // Absent from the aggregate means nothing has been paid: a zero.
                $row['payment'] = $this->presenter->paymentSummary($order, $received[$id] ?? 0);
                // Absent from this one means there is no run: a real null.
                $row['delivery_job'] = $deliveryJobs[$id] ?? null;

                if ($includeContact) {
                    $row['customer'] = [
                        'display_name' => $contacts[$id]['display_name'] ?? null,
                        'phone' => $contacts[$id]['phone'] ?? null,
                    ];
                }

                return $row;
            })->all(),
            $page['meta'],
        );
    }

    /**
     * One page of the book. Cursor-walked by default; `?page=` asks for a
     * numbered page instead, with the totals a numbered pager draws — the
     * `OffsetPage` exception the admin lists use. Both walk newest first.
     *
     * @param  Builder<Order>  $query
     * @return array{items: EloquentCollection<int, Order>, meta: array<string, mixed>}
     *
     * @throws ApiException
     */
    private function page(Request $request, Builder $query): array
    {
        $numbered = OffsetPage::page($request);

        if ($numbered !== null) {
            $perPage = OffsetPage::perPage($request);
            $total = (clone $query)->count();
            OffsetPage::assertWithinRange($numbered, $perPage, $total);
            OffsetPage::constrain($query, $numbered, $perPage, newestFirst: true);

            // The zone's name is on every row (HA-21): one statement for the page.
            $items = $query->with('deliveryZone')->get();

            return ['items' => $items, 'meta' => OffsetPage::meta($items, $numbered, $perPage, $total)];
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request), newestFirst: true);

        // The zone's name is on every row (HA-21): one statement for the page, not one per row.
        return CursorPage::page($query->with('deliveryZone')->get(), $limit);
    }

    /**
     * The orders whose day falls between `from` and `to`, inclusive. Either end
     * alone is a half-open span.
     *
     * @param  Builder<Order>  $query
     *
     * @throws ApiException
     */
    private function applyDaySpan(Request $request, Builder $query): void
    {
        $from = $this->day($request, 'from');
        $to = $this->day($request, 'to');

        if ($from !== null && $to !== null && $to < $from) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The last day cannot be before the first.',
                ['parameter' => 'to'],
            );
        }

        if ($from !== null) {
            $query->whereRaw(self::ORDER_DAY.' >= ?', [$from]);
        }

        if ($to !== null) {
            $query->whereRaw(self::ORDER_DAY.' <= ?', [$to]);
        }
    }

    /**
     * @throws ApiException
     */
    private function day(Request $request, string $parameter): ?string
    {
        $day = $request->query($parameter);

        if ($day === null || $day === '') {
            return null;
        }

        if (! is_string($day) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $day) !== 1) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'A day is written YYYY-MM-DD.',
                ['parameter' => $parameter],
            );
        }

        return $day;
    }

    /**
     * One or more named slots. A sitting goes by two codes in some kitchens
     * (`midday` and `lunch`), so a slot filter is a set.
     *
     * @param  Builder<Order>  $query
     *
     * @throws ApiException
     */
    private function applyWindowCodes(Request $request, Builder $query): void
    {
        $codes = $request->query('delivery_window_code');

        if ($codes === null || $codes === '' || $codes === []) {
            return;
        }

        $codes = is_array($codes) ? $codes : [$codes];

        foreach ($codes as $code) {
            if (! is_string($code) || $code === '' || mb_strlen($code) > 40) {
                throw new ApiException(
                    ErrorCode::RequestInvalid,
                    'A slot is named by its code, at most 40 characters.',
                    ['parameter' => 'delivery_window_code'],
                );
            }
        }

        $query->whereIn('delivery_window_code', array_values(array_unique($codes)));
    }

    /**
     * @param  Builder<Order>  $query
     *
     * @throws ApiException
     */
    private function applyFulfilmentType(Request $request, Builder $query): void
    {
        $type = $request->query('fulfilment_type');

        if ($type === null || $type === '') {
            return;
        }

        if (! is_string($type) || FulfilmentType::tryFrom($type) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The fulfilment type must be one of: '.implode(', ', FulfilmentType::codes()).'.',
                ['parameter' => 'fulfilment_type'],
            );
        }

        $query->where('fulfilment_type', $type);
    }

    /**
     * Unlike the catalogue lists, an omitted `status` hides nothing. A retired
     * article is a row nobody should price by accident; a cancelled order is
     * part of the book, and a default that quietly dropped it would make every
     * total a kitchen reconciles against wrong.
     *
     * @param  Builder<Order>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, Builder $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            return;
        }

        if (! is_string($status) || OrderStatus::tryFrom($status) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The status filter must be one of: placed, confirmed, fulfilled, cancelled.',
                ['parameter' => 'status'],
            );
        }

        $query->where('status', $status);
    }

    /**
     * @param  Builder<Order>  $query
     *
     * @throws ApiException
     */
    private function applyRequestedDate(Request $request, Builder $query): void
    {
        $date = $request->query('requested_delivery_date');

        if ($date === null || $date === '') {
            return;
        }

        // The exact shape, not merely something a date parser would accept:
        // "tomorrow" resolves happily and is a different day depending on when
        // the request lands, which is not a filter a kitchen can plan against.
        if (! is_string($date) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'A requested delivery date is written YYYY-MM-DD.',
                ['parameter' => 'requested_delivery_date'],
            );
        }

        $query->whereDate('requested_delivery_date', $date);
    }

    /**
     * The branch comes from the query string here rather than from
     * `X-Branch-Id`, and deliberately: this is an organisation-wide book that
     * may be *narrowed* to one production site, not a branch-scoped endpoint.
     * A kitchen manager holding an organisation-wide membership selects no
     * branch at all, and an endpoint that read the header would show them
     * nothing until they picked one.
     *
     * @param  Builder<Order>  $query
     */
    private function applyBranch(Request $request, Builder $query): void
    {
        $branch = $request->query('branch_id');

        if (! is_string($branch) || $branch === '') {
            return;
        }

        $query->where('branch_id', $branch);
    }

    /**
     * @param  Builder<Order>  $query
     */
    private function applySearch(Request $request, Builder $query): void
    {
        $term = $request->query('query');

        if (! is_string($term) || trim($term) === '') {
            return;
        }

        $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($term))).'%';

        $query->whereRaw('lower(order_number) like ?', [$needle]);
    }

    /**
     * One customer's orders, for their record in the kitchen's book.
     *
     * @param  Builder<Order>  $query
     *
     * @throws ApiException
     */
    private function applyCustomer(Request $request, Builder $query): void
    {
        $customer = $request->query('customer_account_id');

        if ($customer === null || $customer === '') {
            return;
        }

        if (! is_string($customer) || ! Str::isUuid($customer)) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The customer filter must be a customer account id.',
                ['parameter' => 'customer_account_id'],
            );
        }

        $query->where('customer_account_id', $customer);
    }

    /**
     * Every line of a whole page, in one statement, grouped by order.
     *
     * @param  array<int, int|string>  $orderIds
     * @return array<string, list<OrderLine>>
     */
    private function linesFor(array $orderIds): array
    {
        if ($orderIds === []) {
            return [];
        }

        $grouped = [];

        $rows = OrderLine::query()
            ->whereIn('order_id', $orderIds)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        foreach ($rows as $row) {
            $grouped[$row->order_id][] = $row;
        }

        return $grouped;
    }
}
