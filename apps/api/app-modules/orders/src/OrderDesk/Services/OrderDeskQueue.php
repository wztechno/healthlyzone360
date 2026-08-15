<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Services;

use Carbon\CarbonImmutable;
use DateTimeZone;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\OrderDesk\Enums\OrderDeskWindow;
use Healthy360\Organisations\Models\OrganisationBranch;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * The open book in the order it has to be worked, and the SQL that decides
 * that order.
 *
 * ## Why this is not `OrderQuery`
 *
 * `OrderQuery::forSeller()` hands back a builder for a kitchen's *whole* book
 * and lets the caller sort it. This asks a narrower question with a harder
 * answer: of the orders nobody has finished with, which one is due first? That
 * is not a column. It is a three-table expression — the day the customer asked
 * for, the clock face of the delivery window they chose, read in the timezone
 * of the branch that cooks it — and the whole point of putting it here is that
 * it is written **once**, in SQL, where the database can sort on it.
 *
 * ## The due instant, and its three NULL levels
 *
 * ```
 * COALESCE(
 *   ((requested_delivery_date + COALESCE(dw.starts_at, TIME '23:59:59'))
 *      ::timestamp AT TIME ZONE COALESCE(b.timezone, 'UTC')),
 *   placed_at
 * )
 * ```
 *
 * Read outwards. **No window, or a window nobody has given hours to** — both
 * legitimate states, the second one explicitly so (`delivery_windows` allows a
 * named slot with no times) — fall to `23:59:59`, the end of the requested day.
 * Late in the day rather than early, because an order due "some time on
 * Thursday" must not sort ahead of one due at nine on Thursday morning: the
 * kitchen has until midnight for the first and until nine for the second.
 *
 * **No branch** falls to UTC. A branchless order has no local clock to be read
 * in, and UTC is the only zone that is not a guess about which one it would
 * have been.
 *
 * **No requested date at all** falls to `placed_at` — the instant the customer
 * asked. An order with no named day is not unscheduled, it is as-soon-as
 * possible, and ordering it by when it arrived is the only ordering that is
 * fair to the person who has been waiting longest.
 *
 * The `::timestamp` cast is explicit rather than incidental. `date + time`
 * already yields a timestamp *without* a zone in PostgreSQL, and `AT TIME ZONE`
 * then reads that wall clock **in** the named zone and returns a real instant.
 * Getting that direction backwards is the classic hour-out bug, and it only
 * shows up twice a year — which is why the suite pins a pair of orders either
 * side of a British Summer Time transition.
 *
 * ## Bounded, and honest about it
 *
 * **No cursor.** `CursorPage` re-sorts every query it constrains
 * (`CursorPage::constrain()` calls `reorder()`) and codes its cursor over
 * `(created_at, id)`; a queue whose entire value is a computed sort cannot be
 * walked with it. So the queue is capped instead — two hundred rows, with
 * `truncated` telling the screen the truth when more matched. Two hundred open
 * orders is already a kitchen in trouble, and a desk that silently showed the
 * first page of a much longer list would be hiding exactly the trouble it
 * exists to surface.
 */
final class OrderDeskQueue
{
    /**
     * The most rows one request will ever return. Not a page size — there is no
     * second page — so the number has to be big enough to be the whole day's
     * work for a kitchen that is coping, and small enough that a kitchen that
     * is not still gets an answer.
     */
    public const int MAX_ROWS = 200;

    /**
     * The due-order expression, in one place because it is used twice — once
     * selected so the wire carries it, once sorted on — and two copies that
     * drifted would produce a list ordered by a value it does not show.
     *
     * It interpolates nothing. Every caller-supplied value in this class
     * travels as a binding.
     */
    private const string DUE_AT = "COALESCE(
        ((orders.requested_delivery_date + COALESCE(dw.starts_at, TIME '23:59:59'))::timestamp AT TIME ZONE COALESCE(b.timezone, 'UTC')),
        orders.placed_at
    )";

    /**
     * The statuses a desk queue is *for*. Fulfilled and cancelled orders are
     * finished with; a queue that carried them would be the order book, which
     * already exists at `GET /catalogue/orders` and is paginated for the job.
     *
     * @return list<OrderStatus>
     */
    public static function openStatuses(): array
    {
        return [OrderStatus::Placed, OrderStatus::Confirmed];
    }

    /**
     * One kitchen's open queue, in due order.
     *
     * The organisation is the isolation boundary for this table — `orders`
     * carries no PostgreSQL policy and no global scope, deliberately — so it is
     * applied here rather than left to a caller who might forget, exactly as
     * `OrderQuery::forSeller()` does.
     *
     * @param  list<OrderStatus>|null  $statuses
     * @return array{
     *     orders: list<Order>,
     *     due_at: array<string, string>,
     *     truncated: bool,
     *     today: string,
     *     timezone: string
     * }
     */
    public function forSeller(
        string $organisationId,
        OrderDeskWindow $window = OrderDeskWindow::Today,
        ?string $branchId = null,
        ?array $statuses = null,
        ?string $deliveryWindowCode = null,
        ?string $orderNumberQuery = null,
    ): array {
        $timezone = $this->timezoneFor($organisationId, $branchId);
        $today = CarbonImmutable::now($timezone)->toDateString();

        $query = $this->base($organisationId, $statuses ?? self::openStatuses());

        $this->applyWindow($query, $window, $today);
        $this->applyBranch($query, $branchId);
        $this->applyDeliveryWindowCode($query, $deliveryWindowCode);
        $this->applyOrderNumber($query, $orderNumberQuery);

        // One row past the cap, and only one: it is the cheapest possible
        // answer to "is there more", and it cannot disagree with the page the
        // way a separate COUNT under concurrent writes would.
        $rows = $query->limit(self::MAX_ROWS + 1)->get();

        $truncated = $rows->count() > self::MAX_ROWS;

        $orders = [];
        $dueAt = [];

        foreach ($rows->take(self::MAX_ROWS) as $order) {
            $orders[] = $order;
            $dueAt[(string) $order->getKey()] = $this->instant($order);
        }

        return [
            'orders' => $orders,
            'due_at' => $dueAt,
            'truncated' => $truncated,
            'today' => $today,
            'timezone' => $timezone,
        ];
    }

    /**
     * The name and callable number behind each of the given accounts.
     *
     * **Called only when the caller holds
     * `order.view_customer_contact_organisation`.** The permission decision
     * belongs to the controller; what belongs here is that an unpermitted
     * request never runs these two statements at all, so the confidential
     * columns are not read, not held in memory and not one careless presenter
     * change away from the wire.
     *
     * **A contact point hangs off an identity or off an account, never both**
     * (`contact_points_owner_check`): a registered person's number belongs to
     * their user record and survives every account they hold, while a guest —
     * and, from C2 onwards, a customer the desk provisioned for a cold caller —
     * has no user, so the number hangs off the account. Resolving only one of
     * those two would return a number for one half of the customer base and
     * `null` for the other, which is the sort of half-working that reads as
     * "this customer has no phone" rather than as a bug. Account-owned wins
     * where both exist: it is the number arranged *for this relationship*.
     *
     * `contact_points` is read as a table rather than through
     * `Identity\Models\ContactPoint`, and that is deliberate. The module
     * registry gives Orders an edge to Customers and none to Identity; two
     * columns of a read-only lookup is not the argument for opening one, and a
     * later slice that needs more than a number should open it as a **port**
     * rather than inherit an import nobody decided on.
     *
     * Verified is preferred and **not required**. A courier ringing about
     * tonight's delivery needs the number the customer gave, not a number the
     * platform has proved; refusing to show an unverified one would leave the
     * desk phoning nobody while a perfectly good number sat in the row.
     *
     * @param  list<string>  $accountIds
     * @return array<string, array{display_name: string|null, phone: string|null}>
     */
    public function contactsFor(array $accountIds): array
    {
        $accountIds = array_values(array_unique(array_filter($accountIds, static fn (string $id): bool => $id !== '')));

        if ($accountIds === []) {
            return [];
        }

        $accounts = CustomerAccount::query()
            ->whereKey($accountIds)
            ->get(['id', 'user_id', 'display_name']);

        $userIds = array_values(array_unique(array_filter(
            $accounts->pluck('user_id')->all(),
            static fn (?string $userId): bool => $userId !== null && $userId !== '',
        )));

        $byAccount = [];
        $byUser = [];

        $phones = DB::table('contact_points')
            ->select(['customer_account_id', 'user_id', 'value_normalised'])
            ->where('channel', 'phone')
            ->whereNull('retired_at')
            ->where(function (QueryBuilder $owner) use ($accountIds, $userIds): void {
                $owner->whereIn('customer_account_id', $accountIds);

                if ($userIds !== []) {
                    $owner->orWhereIn('user_id', $userIds);
                }
            })
            // Primary first, then proven, then oldest — the last of the three
            // so that a tie resolves to the number the customer has had
            // longest rather than to whichever row the planner happened to
            // emit first.
            ->orderByDesc('is_primary')
            ->orderByRaw('(verified_at is not null) desc')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        foreach ($phones as $phone) {
            $value = (string) $phone->value_normalised;

            if ($phone->customer_account_id !== null) {
                $byAccount[(string) $phone->customer_account_id] ??= $value;

                continue;
            }

            if ($phone->user_id !== null) {
                $byUser[(string) $phone->user_id] ??= $value;
            }
        }

        $contacts = [];

        foreach ($accounts as $account) {
            $id = (string) $account->getKey();
            $userId = $account->user_id;

            $contacts[$id] = [
                'display_name' => $account->display_name,
                'phone' => $byAccount[$id] ?? ($userId === null ? null : ($byUser[$userId] ?? null)),
            ];
        }

        return $contacts;
    }

    /**
     * The joined, scoped, sorted base set.
     *
     * `orders.*` is selected explicitly rather than left bare. Both joins bring
     * an `id`, an `organisation_id` and a pair of timestamps with them, and an
     * unqualified `select *` would hydrate an `Order` whose primary key is a
     * delivery window's.
     *
     * The window join is on **organisation and code together**, because
     * `delivery_windows` is unique on that pair and a code alone is one
     * kitchen's vocabulary matching another kitchen's row.
     *
     * @param  list<OrderStatus>  $statuses
     * @return Builder<Order>
     */
    private function base(string $organisationId, array $statuses): Builder
    {
        return Order::query()
            ->select('orders.*')
            ->selectRaw(self::DUE_AT.' as due_at')
            ->leftJoin('delivery_windows as dw', function (JoinClause $join): void {
                $join->on('dw.organisation_id', '=', 'orders.organisation_id')
                    ->on('dw.code', '=', 'orders.delivery_window_code');
            })
            ->leftJoin('organisation_branches as b', 'b.id', '=', 'orders.branch_id')
            ->where('orders.organisation_id', $organisationId)
            ->whereIn('orders.status', array_map(
                static fn (OrderStatus $status): string => $status->value,
                $statuses === [] ? self::openStatuses() : $statuses,
            ))
            ->orderByRaw(self::DUE_AT.' asc')
            // Two tie-breaks, and the second is what makes the order total. Two
            // orders for the same slot on the same day share a due instant
            // exactly; without a deterministic tail the same request could
            // return them in either order and a screen polling every fifteen
            // seconds would shuffle rows under somebody's finger.
            ->orderBy('orders.placed_at')
            ->orderBy('orders.id');
    }

    /**
     * @param  Builder<Order>  $query
     */
    private function applyWindow(Builder $query, OrderDeskWindow $window, string $today): void
    {
        match ($window) {
            // A dateless order is not unscheduled, it is *now* — see the enum.
            OrderDeskWindow::Today => $query->where(function (Builder $day) use ($today): void {
                $day->where('orders.requested_delivery_date', $today)
                    ->orWhereNull('orders.requested_delivery_date');
            }),
            OrderDeskWindow::Overdue => $query->where('orders.requested_delivery_date', '<', $today),
            OrderDeskWindow::Next7 => $query->whereBetween('orders.requested_delivery_date', [
                $today,
                CarbonImmutable::parse($today)->addDays($window->forwardDays())->toDateString(),
            ]),
        };
    }

    /**
     * @param  Builder<Order>  $query
     */
    private function applyBranch(Builder $query, ?string $branchId): void
    {
        if ($branchId === null || $branchId === '') {
            return;
        }

        $query->where('orders.branch_id', $branchId);
    }

    /**
     * @param  Builder<Order>  $query
     */
    private function applyDeliveryWindowCode(Builder $query, ?string $code): void
    {
        if ($code === null || $code === '') {
            return;
        }

        $query->where('orders.delivery_window_code', $code);
    }

    /**
     * The **order number only**, and case-insensitively, on
     * `KitchenOrderIndexController`'s argument verbatim: a staff-facing search
     * across confidential columns is how a directory of everybody a kitchen has
     * ever delivered to gets built one query at a time. The number is what is
     * printed on the receipt in the caller's hand — and on a desk, in the
     * caller's *voice*, which is the whole reason the filter is here.
     *
     * That the row beside it may carry a name changes nothing. Reading a name
     * the kitchen already has an order for is a disclosure with a purpose;
     * matching on one turns the queue into a lookup by person.
     *
     * @param  Builder<Order>  $query
     */
    private function applyOrderNumber(Builder $query, ?string $term): void
    {
        if ($term === null || trim($term) === '') {
            return;
        }

        $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($term))).'%';

        $query->whereRaw('lower(orders.order_number) like ?', [$needle]);
    }

    /**
     * Which clock "today" is read on.
     *
     * A branch is a place, and a place has a working day. Asking a Beirut
     * kitchen for today's queue at 01:00 local time must not answer with
     * yesterday's because the server keeps UTC. With no branch named there is
     * no place to ask, so UTC it is — the same fallback the due expression
     * makes for a branchless order, kept identical on purpose.
     *
     * An unrecognised zone degrades to UTC rather than throwing. The column is
     * a free string validated only for length at the point it is written, and a
     * queue that 500s because somebody typed a zone wrong is worse than a queue
     * whose day boundary is an hour off.
     */
    private function timezoneFor(string $organisationId, ?string $branchId): string
    {
        if ($branchId === null || $branchId === '') {
            return 'UTC';
        }

        $branch = OrganisationBranch::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereKey($branchId)
            ->first(['timezone']);

        $timezone = $branch?->timezone;

        if ($timezone === null || $timezone === '' || ! in_array($timezone, DateTimeZone::listIdentifiers(), true)) {
            return 'UTC';
        }

        return $timezone;
    }

    /**
     * The selected `due_at`, normalised to an ISO-8601 UTC instant.
     *
     * PostgreSQL hands back a `timestamptz` rendered in the session zone; the
     * wire carries one representation of an instant and it is not the
     * database's session setting. `placed_at` is the fallback for the same
     * reason the SQL uses it — the expression cannot be null, so neither can
     * this.
     */
    private function instant(Order $order): string
    {
        $raw = $order->getAttribute('due_at');

        if (! is_string($raw) || $raw === '') {
            return $order->placed_at->utc()->toIso8601String();
        }

        return CarbonImmutable::parse($raw)->utc()->toIso8601String();
    }
}
