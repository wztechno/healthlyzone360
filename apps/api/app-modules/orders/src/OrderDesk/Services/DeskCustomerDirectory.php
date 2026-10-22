<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Services;

use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Exceptions\InvalidContactValue;
use Healthy360\Identity\Services\ContactValueNormaliser;
use Healthy360\Organisations\Enums\MembershipStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * Which customers a kitchen may look up, and the two ways somebody becomes one
 * of them.
 *
 * ## The scoping rule, stated once and implemented once
 *
 * An account is returned to this organisation when **either**:
 *
 *  * **(a)** it holds at least one order with this organisation, or
 *  * **(b)** its `origin` is `staff` **and** its `created_by` is a user holding
 *    an **active** membership of this organisation.
 *
 * Nothing else. Not "is a consumer account", not "has an address in a served
 * area" — an account nobody at this kitchen has either cooked for or written
 * down is not this kitchen's business, and the search is the door every desk
 * identifier comes through.
 *
 * **This rule is the whole control, and the database is not helping.** A
 * `customer_accounts` row carries no `organisation_id` unless it is a corporate
 * buyer — the same person orders from four kitchens with one account — so there
 * is no column to filter on and no policy that could do this for us. Worse: the
 * row-level-security policy's ownerless arm (2026_08_07_001506) admits *every*
 * staff-provisioned account to *every* kitchen session, because such a row has
 * no user and no organisation, exactly like a guest. The migration that made
 * those rows possible (2026_08_16_003006) says so in its docblock rather than
 * implying otherwise. What stands between one kitchen and another kitchen's
 * cold callers is this method, the permission code in front of it, and the fact
 * that an account identifier is otherwise unobtainable.
 *
 * ## Arm (b), and what it costs a member of staff who works two kitchens
 *
 * A person on the payroll of two kitchens holds an active membership of both.
 * If they provision a caller for kitchen A, that caller is visible to kitchen B
 * as well, because the rule asks whether the *creator* is a member here — not
 * which kitchen they were sitting in at the time. Nothing in the schema records
 * the second fact: `customer_accounts.created_by` is a user, there is no
 * "provisioned for organisation" column, and inventing one would be a fourth
 * ownership concept on a table that already carries three.
 *
 * The alternative was to drop arm (b) entirely and scope by orders alone —
 * which breaks the workflow it exists for, because a caller who has just been
 * written down has no order yet and would vanish from the search between the
 * two taps that create them and sell to them. The consequence is accepted,
 * bounded (it needs a shared employee, and it exposes a name and a number), and
 * written down here rather than discovered later.
 *
 * ## Matching
 *
 * Name matching is a case-insensitive substring, with the LIKE metacharacters
 * escaped so a query of `100%` searches for `100%`.
 *
 * Phone matching goes through **`ContactValueNormaliser`** — the same class
 * `ContactPointRegistry` writes through — because `contact_points` stores
 * `value_normalised` and nothing else. A raw `+961 70 123 456` compared against
 * the stored `+96170123456` matches nothing at all, and would look exactly like
 * "we have no such customer".
 *
 * The normaliser refuses anything not already in E.164, and that refusal is
 * **not** an error here: a query of `Ali` is a name, and a query of `70123456`
 * is a local number the platform will not guess a country code for (see
 * `ContactValueNormaliser`). Either way the phone arm is simply not applied and
 * the name arm answers. An agent who wants to find somebody by number types the
 * number the way it is stored, which is the way the customer gave it.
 *
 * Both ownership arms of `contact_points` are searched — the number may hang
 * off the account (a guest, or a caller the desk provisioned) or off the
 * account's user (a registered customer) — for the reason
 * `OrderDeskQueue::contactsFor()` gives at length: resolving one of the two
 * would answer for half the customer base and read as "no phone" rather than as
 * a bug.
 */
final class DeskCustomerDirectory
{
    /**
     * The shortest query the search will answer. Two characters matches a
     * meaningful fraction of any kitchen's customer list, which is a directory
     * dump wearing a search box.
     */
    public const int MIN_QUERY_LENGTH = 3;

    /**
     * The most rows one search returns. There is no cursor and no second page:
     * a desk agent has somebody on the telephone, and the answer to "twenty
     * matches" is a longer query rather than a longer list.
     */
    public const int MAX_ROWS = 20;

    /**
     * The most rows the customer book returns, with the true total beside them.
     *
     * ponytail: a hard cap rather than paging; add a cursor when a kitchen's
     * book routinely outgrows it and "search to narrow" stops being an answer.
     */
    public const int BROWSE_LIMIT = 200;

    public function __construct(private readonly ContactValueNormaliser $normaliser) {}

    /**
     * The customers of this kitchen matching this query.
     *
     * Each row carries `has_orders_with_org` as a selected boolean rather than
     * a per-row query — it is arm (a) of the scoping rule restated as a fact the
     * screen needs ("is this a regular, or somebody we wrote down last week"),
     * and computing it twice per row would be twenty round trips for a list of
     * twenty.
     *
     * @return list<CustomerAccount>
     */
    public function search(string $organisationId, string $query): array
    {
        $accounts = [];

        $rows = CustomerAccount::query()
            ->select('customer_accounts.*')
            ->selectRaw(
                'EXISTS (SELECT 1 FROM orders o WHERE o.customer_account_id = customer_accounts.id AND o.organisation_id = ?) as has_orders_with_org',
                [$organisationId],
            )
            ->where(fn (Builder $match): Builder => $this->applyMatch($match, $query))
            ->where(fn (Builder $scope): Builder => $this->applyScope($scope, $organisationId))
            // Alphabetical by the name a person reads down a telephone, with the
            // identifier as a tie-break so two customers of the same name do not
            // swap places between two identical searches.
            ->orderByRaw('lower(customer_accounts.display_name) asc')
            ->orderBy('customer_accounts.id')
            ->limit(self::MAX_ROWS)
            ->get();

        foreach ($rows as $row) {
            $accounts[] = $row;
        }

        return $accounts;
    }

    /**
     * Whether this kitchen may act on this account at all — the same rule the
     * search applies, asked about one row.
     *
     * Used by the endpoints that take an account **identifier** rather than
     * producing one. The search is the only door an identifier legitimately
     * comes through, and an endpoint that trusted the identifier alone would let
     * an operator who obtained one elsewhere attach a delivery address to a
     * stranger's account — which is a street somebody lives on, written into
     * somebody else's record.
     */
    public function isInScope(string $organisationId, CustomerAccount $account): bool
    {
        return CustomerAccount::query()
            ->whereKey($account->getKey())
            ->where(fn (Builder $scope): Builder => $this->applyScope($scope, $organisationId))
            ->exists();
    }

    /**
     * Whether this kitchen's customer **book** may show this account — the
     * browse rule, which is the desk rule plus arm (c), asked about one row.
     *
     * Not a substitute for `isInScope()`. The desk's write endpoints ask that
     * one, and must keep asking it: a corporate programme admits the buyer's
     * account to the kitchen's reference page, not to the desk's power to change
     * that buyer's telephone number or add a street to their address book.
     */
    public function isBrowsable(string $organisationId, CustomerAccount $account): bool
    {
        return CustomerAccount::query()
            ->whereKey($account->getKey())
            ->where(fn (Builder $scope): Builder => $this->applyBrowseScope($scope, $organisationId))
            ->exists();
    }

    /**
     * The kitchen's customer book: every account the browse rule admits,
     * optionally narrowed by a query and an account type.
     *
     * Unlike `search()` there is no minimum query length — this is the page
     * whose purpose *is* the list, behind the same contact permission the queue
     * and the search sit behind. Each row carries this kitchen's own order count
     * and last order time as selected columns, never another kitchen's.
     *
     * Most recent customer first: `last_ordered_at` descending with the never-
     * ordered at the bottom, then newest account, then the identifier so equal
     * rows hold their places between two identical requests.
     *
     * @return array{rows: list<CustomerAccount>, total: int}
     */
    public function browse(string $organisationId, ?string $query, ?CustomerAccountType $type, int $limit = self::BROWSE_LIMIT): array
    {
        $scoped = CustomerAccount::query()
            ->when(
                $query !== null && trim($query) !== '',
                fn (Builder $matched): Builder => $matched->where(fn (Builder $match): Builder => $this->applyMatch($match, (string) $query)),
            )
            ->when($type !== null, fn (Builder $typed): Builder => $typed->where('customer_accounts.account_type', $type?->value))
            ->where(fn (Builder $scope): Builder => $this->applyBrowseScope($scope, $organisationId));

        $total = (clone $scoped)->count();

        $accounts = [];

        $rows = $scoped
            ->select('customer_accounts.*')
            ->selectRaw(
                '(SELECT count(*) FROM orders o WHERE o.customer_account_id = customer_accounts.id AND o.organisation_id = ?) as order_count',
                [$organisationId],
            )
            ->selectRaw(
                '(SELECT max(o.placed_at) FROM orders o WHERE o.customer_account_id = customer_accounts.id AND o.organisation_id = ?) as last_ordered_at',
                [$organisationId],
            )
            ->orderByRaw('last_ordered_at desc nulls last')
            ->orderByDesc('customer_accounts.created_at')
            ->orderBy('customer_accounts.id')
            ->limit($limit)
            ->get();

        foreach ($rows as $row) {
            $accounts[] = $row;
        }

        return ['rows' => $accounts, 'total' => $total];
    }

    /**
     * Every live contact point of these accounts, on both ownership arms, keyed
     * by account — primary first, then phone before email, then oldest.
     *
     * Both arms for the reason the class docblock gives: a guest's or a desk
     * caller's number hangs off the account, a registered customer's off their
     * user. Retired rows are history, not a way to reach anybody, and are left
     * out.
     *
     * @param  list<CustomerAccount>  $accounts
     * @return array<string, list<array{channel: string, value: string, label: string|null, is_primary: bool, verified: bool}>>
     */
    public function contactPointsFor(array $accounts): array
    {
        if ($accounts === []) {
            return [];
        }

        $accountIds = [];
        $accountsByUser = [];

        foreach ($accounts as $account) {
            $id = (string) $account->getKey();
            $accountIds[] = $id;

            if ($account->user_id !== null) {
                $accountsByUser[(string) $account->user_id][] = $id;
            }
        }

        $rows = DB::table('contact_points')
            ->select(['customer_account_id', 'user_id', 'channel', 'value_normalised', 'label', 'is_primary', 'verified_at'])
            ->whereNull('retired_at')
            ->where(function (QueryBuilder $owner) use ($accountIds, $accountsByUser): void {
                $owner->whereIn('customer_account_id', $accountIds);

                if ($accountsByUser !== []) {
                    $owner->orWhereIn('user_id', array_keys($accountsByUser));
                }
            })
            ->orderByDesc('is_primary')
            ->orderByRaw("CASE channel WHEN 'phone' THEN 0 ELSE 1 END")
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        $contacts = [];

        foreach ($rows as $row) {
            $contact = [
                'channel' => (string) $row->channel,
                'value' => (string) $row->value_normalised,
                'label' => $row->label === null ? null : (string) $row->label,
                'is_primary' => (bool) $row->is_primary,
                'verified' => $row->verified_at !== null,
            ];

            $owners = $row->customer_account_id !== null
                ? [(string) $row->customer_account_id]
                : $accountsByUser[(string) $row->user_id] ?? [];

            foreach ($owners as $accountId) {
                $contacts[$accountId][] = $contact;
            }
        }

        return $contacts;
    }

    /**
     * Accounts already holding this exact normalised number, on either ownership
     * arm and within this kitchen's scope.
     *
     * Deliberately scoped like the search rather than asked of the whole
     * platform: "somebody somewhere has this number" is a fact about strangers,
     * and answering it would turn a duplicate warning into an oracle over every
     * telephone number on the platform.
     *
     * @return list<CustomerAccount>
     */
    public function holdersOfNormalisedPhone(string $organisationId, string $normalisedPhone): array
    {
        $accounts = [];

        $rows = CustomerAccount::query()
            ->select('customer_accounts.*')
            ->selectRaw(
                'EXISTS (SELECT 1 FROM orders o WHERE o.customer_account_id = customer_accounts.id AND o.organisation_id = ?) as has_orders_with_org',
                [$organisationId],
            )
            ->where(fn (Builder $phone): Builder => $this->applyPhone($phone, $normalisedPhone))
            ->where(fn (Builder $scope): Builder => $this->applyScope($scope, $organisationId))
            ->orderBy('customer_accounts.created_at')
            ->orderBy('customer_accounts.id')
            ->limit(self::MAX_ROWS)
            ->get();

        foreach ($rows as $row) {
            $accounts[] = $row;
        }

        return $accounts;
    }

    /**
     * The E.164 form of a value, or null when it is not one.
     *
     * Null is the ordinary answer rather than the exceptional one — most search
     * queries are names — so the refusal is swallowed here and surfaced as "no
     * phone arm" rather than as a 422. The write path is the opposite and asks
     * the normaliser directly, because a customer being written down without a
     * usable number is a mistake worth refusing.
     */
    public function normalisedPhone(string $value): ?string
    {
        try {
            return $this->normaliser->normalise(ContactChannel::Phone, $value);
        } catch (InvalidContactValue) {
            return null;
        }
    }

    /**
     * @param  Builder<CustomerAccount>  $query
     * @return Builder<CustomerAccount>
     */
    private function applyMatch(Builder $query, string $term): Builder
    {
        $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($term))).'%';

        $query->whereRaw('lower(customer_accounts.display_name) like ?', [$needle]);

        $normalised = $this->normalisedPhone($term);

        if ($normalised !== null) {
            $query->orWhere(fn (Builder $phone): Builder => $this->applyPhone($phone, $normalised));
        }

        return $query;
    }

    /**
     * Both ownership arms of `contact_points`, as one predicate.
     *
     * Read as a table rather than through `Identity\Models\ContactPoint` for the
     * reason `OrderDeskQueue::contactsFor()` states: this is a correlated
     * existence test over two columns, and a model would buy nothing here except
     * a global scope nobody wants inside a policy-shaped subquery.
     *
     * @param  Builder<CustomerAccount>  $query
     * @return Builder<CustomerAccount>
     */
    private function applyPhone(Builder $query, string $normalised): Builder
    {
        return $query->whereExists(function (QueryBuilder $contact) use ($normalised): void {
            $contact->select(DB::raw('1'))
                ->from('contact_points')
                ->where('contact_points.channel', ContactChannel::Phone->value)
                ->whereNull('contact_points.retired_at')
                ->where('contact_points.value_normalised', $normalised)
                ->where(function (QueryBuilder $owner): void {
                    $owner->whereColumn('contact_points.customer_account_id', 'customer_accounts.id')
                        ->orWhere(function (QueryBuilder $viaUser): void {
                            $viaUser->whereNotNull('customer_accounts.user_id')
                                ->whereColumn('contact_points.user_id', 'customer_accounts.user_id');
                        });
                });
        });
    }

    /**
     * The scoping rule itself: (a) or (b), and nothing else.
     *
     * @param  Builder<CustomerAccount>  $query
     * @return Builder<CustomerAccount>
     */
    private function applyScope(Builder $query, string $organisationId): Builder
    {
        return $query
            // (a) This kitchen has cooked for them.
            ->whereExists(function (QueryBuilder $order) use ($organisationId): void {
                $order->select(DB::raw('1'))
                    ->from('orders')
                    ->whereColumn('orders.customer_account_id', 'customer_accounts.id')
                    ->where('orders.organisation_id', $organisationId);
            })
            // (b) Somebody who works here wrote them down.
            ->orWhere(function (Builder $provisioned) use ($organisationId): void {
                $provisioned
                    ->where('customer_accounts.origin', CustomerAccountOrigin::Staff->value)
                    ->whereNotNull('customer_accounts.created_by')
                    ->whereExists(function (QueryBuilder $membership) use ($organisationId): void {
                        $membership->select(DB::raw('1'))
                            ->from('organisation_memberships')
                            ->whereColumn('organisation_memberships.user_id', 'customer_accounts.created_by')
                            ->where('organisation_memberships.organisation_id', $organisationId)
                            // `active`, not merely present. An invitation nobody
                            // accepted, a suspension and an ended employment are
                            // all rows in this table, and a former employee's
                            // customers are not the kitchen's to read on the
                            // strength of a membership that no longer works.
                            ->where('organisation_memberships.status', MembershipStatus::Active->value);
                    });
            });
    }

    /**
     * The browse rule: (a) or (b), **or (c)** — the account's buying
     * organisation holds a corporate programme with this kitchen.
     *
     * Read-only by construction. Only `browse()` and `isBrowsable()` use it; the
     * desk search and the desk's writes stay on `applyScope()`, so a programme
     * client who has never ordered is in the kitchen's book without becoming
     * somebody the desk may rewrite. The read side of `customer_accounts`' row
     * policy carries the matching sixth arm (2026_10_22_000101); its write side
     * does not.
     *
     * @param  Builder<CustomerAccount>  $query
     * @return Builder<CustomerAccount>
     */
    private function applyBrowseScope(Builder $query, string $organisationId): Builder
    {
        return $query
            ->where(fn (Builder $desk): Builder => $this->applyScope($desk, $organisationId))
            ->orWhere(function (Builder $programme) use ($organisationId): void {
                $programme
                    ->whereNotNull('customer_accounts.organisation_id')
                    ->whereExists(function (QueryBuilder $held) use ($organisationId): void {
                        $held->select(DB::raw('1'))
                            ->from('corporate_programmes')
                            ->whereColumn('corporate_programmes.organisation_id', 'customer_accounts.organisation_id')
                            ->where('corporate_programmes.kitchen_organisation_id', $organisationId);
                    });
            });
    }
}
