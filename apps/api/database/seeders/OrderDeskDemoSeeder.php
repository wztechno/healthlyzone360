<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Identity\Services\ContactValueHasher;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * A working evening for the HealthZone360 order desk, so its five screens have something to show.
 *
 * Open orders around *now* (late, due soon, later tonight), a week of delivery-slot orders for the
 * calendar, delivery runs in every state, part and full payments, and a few finished counter sales
 * whose receipts fill today's cash report.
 *
 * ## Written straight to the tables, and only in local development
 *
 * Every row here would normally arrive through the desk's own placement path (quote → place →
 * receipt). This seeder skips that path on purpose — the kitchen has no desk price list to quote
 * against yet — so the figures are illustrative rather than priced. That is why it is guarded to
 * `local` and never part of `DatabaseSeeder`'s default run.
 *
 * ## Relative to now, and safe to re-run
 *
 * Every row carries an order number starting `HZ-DESK-`, and a run first deletes the rows a previous
 * run wrote under that prefix. Re-running therefore moves the evening to the current clock instead
 * of piling up stale orders:
 *
 *     php artisan db:seed --class=OrderDeskDemoSeeder
 */
class OrderDeskDemoSeeder extends Seeder
{
    private const string ORGANISATION_SLUG = 'healthzone360-kitchen';

    private const string PREFIX = 'HZ-DESK-';

    private const string CURRENCY = 'USD';

    /** @var list<array{code: string, en: string, ar: string, starts: string, ends: string}> */
    private const array WINDOWS = [
        ['code' => 'morning', 'en' => 'Morning', 'ar' => 'صباحًا', 'starts' => '08:00', 'ends' => '11:00'],
        ['code' => 'midday', 'en' => 'Midday', 'ar' => 'ظهرًا', 'starts' => '12:00', 'ends' => '15:00'],
        ['code' => 'evening', 'en' => 'Evening', 'ar' => 'مساءً', 'starts' => '18:00', 'ends' => '21:00'],
    ];

    /** @var list<array{name: string, phone: string}> */
    private const array CUSTOMERS = [
        ['name' => 'Nadia Haddad', 'phone' => '+9613118204'],
        ['name' => 'Rami Aoun', 'phone' => '+96171340992'],
        ['name' => 'Layla Mansour', 'phone' => '+9613447019'],
        ['name' => 'Georges Khoury', 'phone' => '+96176220118'],
        ['name' => 'Hiba Saad', 'phone' => '+9613902441'],
        ['name' => 'Karim Bitar', 'phone' => '+96181556703'],
    ];

    private int $sequence = 0;

    public function run(): void
    {
        if (! App::environment('local')) {
            $this->command?->warn('OrderDeskDemoSeeder skipped: demo orders are seeded in local development only.');

            return;
        }

        $organisation = Organisation::query()->where('slug', self::ORGANISATION_SLUG)->first();
        if ($organisation === null) {
            $this->command?->warn('OrderDeskDemoSeeder skipped: run HealthZoneKitchenSeeder first.');

            return;
        }

        $organisationId = (string) $organisation->getKey();

        app(DatabaseTenantContext::class)->during(null, $organisationId, null, function () use ($organisationId): void {
            DB::transaction(fn () => $this->seed($organisationId));
        });
    }

    private function seed(string $organisationId): void
    {
        $branch = OrganisationBranch::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->orderBy('created_at')
            ->firstOrFail();
        $branchId = (string) $branch->getKey();

        $owner = User::query()->where('email', 'owner@healthzone360.test')->firstOrFail();
        $staff = User::query()->where('email', 'staff@healthzone360.test')->firstOrFail();

        $channelId = (string) DB::table('sales_channels')
            ->where('organisation_id', $organisationId)
            ->where('code', 'web-shop')
            ->value('id');

        $this->forget($organisationId);
        $this->windows($organisationId, (string) $owner->getKey());
        $customers = $this->customers($organisationId, (string) $owner->getKey());
        $menu = $this->menu($organisationId);

        $now = CarbonImmutable::now();
        $today = $now->setTimezone($branch->timezone ?? 'UTC')->toDateString();

        $base = [
            'organisation_id' => $organisationId,
            'branch_id' => $branchId,
            'sales_channel_id' => $channelId,
            'created_by' => (string) $owner->getKey(),
        ];

        /*
         * The open queue. A dateless order is due when it was placed, which is what lets these sit
         * a few minutes either side of now; the evening-slot ones are due at the slot's start.
         */
        $open = [
            ['type' => 'delivery', 'status' => 'placed', 'placed' => $now->subMinutes(38), 'customer' => 0, 'job' => ['pending', 'awaiting_assignment', false], 'paid' => 0],
            ['type' => 'delivery', 'status' => 'confirmed', 'placed' => $now->subMinutes(17), 'customer' => 1, 'job' => ['in_transit', 'en_route', true], 'paid' => 1.0, 'method' => 'wish'],
            ['type' => 'pickup', 'status' => 'confirmed', 'placed' => $now->addMinutes(12), 'customer' => 2, 'paid' => 0, 'method' => 'cash_at_counter'],
            ['type' => 'delivery', 'status' => 'placed', 'placed' => $now->addMinutes(20), 'customer' => 3, 'paid' => 0],
            ['type' => 'delivery', 'status' => 'confirmed', 'placed' => $now->addMinutes(55), 'customer' => 4, 'job' => ['assigned', 'picked_up', true], 'paid' => 0.3],
            ['type' => 'delivery', 'status' => 'confirmed', 'placed' => $now->addMinutes(85), 'customer' => 5, 'paid' => 1.0, 'method' => 'wish'],
            ['type' => 'pickup', 'status' => 'placed', 'placed' => $now->addMinutes(110), 'customer' => 0, 'paid' => 0, 'method' => 'cash_at_counter'],
            ['type' => 'delivery', 'status' => 'placed', 'date' => $today, 'window' => 'evening', 'placed' => $now->subHours(3), 'customer' => 2, 'job' => ['pending', 'awaiting_assignment', false], 'paid' => 0],
            ['type' => 'delivery', 'status' => 'confirmed', 'date' => $now->subDay()->toDateString(), 'window' => 'evening', 'placed' => $now->subDay()->subHours(4), 'customer' => 3, 'job' => ['assigned', 'awaiting_assignment', true], 'paid' => 0],
        ];

        foreach ($open as $spec) {
            $this->order($base, $spec, $customers, $menu, $staff, $owner);
        }

        /* The week ahead, for the calendar and the "Next 7 days" window. */
        for ($day = 1; $day <= 6; $day++) {
            $date = $now->addDays($day)->toDateString();
            foreach (self::WINDOWS as $index => $window) {
                $count = ($day + $index) % 3 + ($window['code'] === 'midday' ? 2 : 1);
                for ($n = 0; $n < $count; $n++) {
                    $this->order($base, [
                        'type' => $n % 3 === 2 ? 'pickup' : 'delivery',
                        'status' => $n % 2 === 0 ? 'confirmed' : 'placed',
                        'date' => $date,
                        'window' => $window['code'],
                        'placed' => $now->subHours($day + $n),
                        'customer' => ($day + $n) % count(self::CUSTOMERS),
                        'paid' => 0,
                    ], $customers, $menu, $staff, $owner);
                }
            }
        }

        /* Finished counter sales: already fulfilled and settled, so they only show in the cash report. */
        $counter = [
            ['method' => 'cash_at_counter', 'by' => $staff],
            ['method' => 'cash_at_counter', 'by' => $staff],
            ['method' => 'wish', 'by' => $staff],
            ['method' => 'cash_at_counter', 'by' => $owner],
            ['method' => 'wish', 'by' => $owner],
        ];

        foreach ($counter as $index => $sale) {
            $this->order($base, [
                'type' => 'counter',
                'status' => 'fulfilled',
                'placed' => $now->subMinutes(30 + $index * 45),
                'customer' => null,
                'paid' => 1.0,
                'method' => $sale['method'],
                'receiptBy' => $sale['by'],
            ], $customers, $menu, $staff, $owner);
        }
    }

    /** Removes what a previous run wrote, children first. */
    private function forget(string $organisationId): void
    {
        $orderIds = DB::table('orders')
            ->where('organisation_id', $organisationId)
            ->where('order_number', 'like', self::PREFIX.'%')
            ->pluck('id');

        DB::table('order_payment_receipts')->whereIn('order_id', $orderIds)->delete();
        DB::table('delivery_jobs')->whereIn('order_id', $orderIds)->delete();
        DB::table('order_lines')->whereIn('order_id', $orderIds)->delete();
        DB::table('orders')->whereIn('id', $orderIds)->delete();
    }

    /** The kitchen's three delivery slots, added only where it has none by that code. */
    private function windows(string $organisationId, string $ownerId): void
    {
        foreach (self::WINDOWS as $order => $window) {
            $exists = DB::table('delivery_windows')
                ->where('organisation_id', $organisationId)
                ->where('code', $window['code'])
                ->exists();

            if ($exists) {
                continue;
            }

            DB::table('delivery_windows')->insert([
                'id' => (string) Str::uuid7(),
                'organisation_id' => $organisationId,
                'code' => $window['code'],
                'name_en' => $window['en'],
                'name_ar' => $window['ar'],
                'starts_at' => $window['starts'],
                'ends_at' => $window['ends'],
                'display_order' => $order,
                'is_active' => true,
                'created_by' => $ownerId,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * Desk-provisioned customers with a telephone each, reused across runs by account number.
     *
     * @return list<string>
     */
    private function customers(string $organisationId, string $ownerId): array
    {
        $hasher = app(ContactValueHasher::class);
        $ids = [];

        foreach (self::CUSTOMERS as $index => $customer) {
            $number = sprintf('%sC%02d', self::PREFIX, $index + 1);
            $id = DB::table('customer_accounts')->where('account_number', $number)->value('id');

            if ($id === null) {
                $id = (string) Str::uuid7();
                DB::table('customer_accounts')->insert([
                    'id' => $id,
                    'account_number' => $number,
                    'account_type' => 'b2c',
                    'organisation_id' => $organisationId,
                    'status' => 'active',
                    'origin' => 'staff',
                    'display_name' => $customer['name'],
                    'preferred_language_code' => 'en',
                    'country_code' => 'LB',
                    'activated_at' => now(),
                    'created_by' => $ownerId,
                    'lock_version' => 0,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                DB::table('contact_points')->insert([
                    'id' => (string) Str::uuid7(),
                    'customer_account_id' => $id,
                    'channel' => 'phone',
                    'value_normalised' => $customer['phone'],
                    'value_hash' => $hasher->hash($customer['phone']),
                    'is_login_identity' => false,
                    'is_primary' => true,
                    'source' => 'staff',
                    'created_by' => $ownerId,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            $ids[] = (string) $id;
        }

        return $ids;
    }

    /**
     * Published meals and products to put on the lines, with an illustrative price each.
     *
     * @return list<array{id: string, en: string, ar: string, price: int}>
     */
    private function menu(string $organisationId): array
    {
        return array_values(DB::table('catalogue_items')
            ->where('organisation_id', $organisationId)
            ->where('status', 'published')
            ->whereIn('item_type', ['meal', 'product'])
            ->orderBy('name_en')
            ->limit(12)
            ->get(['id', 'name_en', 'name_ar'])
            ->values()
            ->map(fn (object $item, int $index): array => [
                'id' => (string) $item->id,
                'en' => (string) $item->name_en,
                'ar' => (string) $item->name_ar,
                'price' => 450 + ($index * 175) % 1100,
            ])
            ->all());
    }

    /**
     * One order, its lines, its run and its receipts.
     *
     * @param  array<string, string>  $base
     * @param  array<string, mixed>  $spec
     * @param  list<string>  $customers
     * @param  list<array{id: string, en: string, ar: string, price: int}>  $menu
     */
    private function order(array $base, array $spec, array $customers, array $menu, User $driver, User $owner): void
    {
        $this->sequence++;
        $orderId = (string) Str::uuid7();
        $type = (string) $spec['type'];
        $status = (string) $spec['status'];
        /** @var CarbonImmutable $placed */
        $placed = $spec['placed'];
        $method = (string) ($spec['method'] ?? ($type === 'delivery' ? 'cash_on_delivery' : 'cash_at_counter'));

        $lines = [];
        $subtotal = 0;
        $lineCount = 1 + $this->sequence % 3;
        for ($i = 0; $i < $lineCount; $i++) {
            $item = $menu[($this->sequence * 3 + $i) % count($menu)];
            $quantity = 1 + ($this->sequence + $i) % 2;
            $total = $item['price'] * $quantity;
            $subtotal += $total;
            $lines[] = [
                'id' => (string) Str::uuid7(),
                'order_id' => $orderId,
                'catalogue_item_id' => $item['id'],
                'name_en' => $item['en'],
                'name_ar' => $item['ar'],
                'quantity' => $quantity,
                'unit_price_minor' => $item['price'],
                'line_total_minor' => $total,
                'currency_code' => self::CURRENCY,
                'created_at' => $placed,
                'updated_at' => $placed,
            ];
        }

        $fee = $type === 'delivery' ? 300 : null;
        $grand = $subtotal + ($fee ?? 0);
        $customerId = $spec['customer'] === null ? null : $customers[(int) $spec['customer']];
        $isDelivery = $type === 'delivery';

        DB::table('orders')->insert([
            ...$base,
            'id' => $orderId,
            'order_number' => sprintf('%s%04d', self::PREFIX, $this->sequence),
            'customer_account_id' => $customerId,
            'status' => $status,
            'currency_code' => self::CURRENCY,
            'subtotal_minor' => $subtotal,
            'delivery_fee_minor' => $fee,
            'total_minor' => $grand,
            'delivery_label' => $isDelivery ? 'Home' : null,
            'delivery_line_one' => $isDelivery ? 'Rue Sursock 12' : null,
            'delivery_area_name_en' => $isDelivery ? 'Achrafieh' : null,
            'delivery_area_name_ar' => $isDelivery ? 'الأشرفية' : null,
            'delivery_building' => $isDelivery ? 'Building Nasr' : null,
            'delivery_floor' => $isDelivery ? '3' : null,
            'delivery_window_code' => $spec['window'] ?? null,
            'requested_delivery_date' => $spec['date'] ?? null,
            'payment_method' => $method,
            'fulfilment_type' => $type,
            'placed_at' => $placed,
            'confirmed_at' => $status === 'placed' ? null : $placed,
            'fulfilled_at' => $status === 'fulfilled' ? $placed : null,
            'placed_on_behalf_by' => $base['created_by'],
            'lock_version' => 0,
            'created_at' => $placed,
            'updated_at' => $placed,
        ]);

        DB::table('order_lines')->insert($lines);

        if (isset($spec['job'])) {
            [$jobStatus, $tracking, $assigned] = $spec['job'];
            DB::table('delivery_jobs')->insert([
                'id' => (string) Str::uuid7(),
                'organisation_id' => $base['organisation_id'],
                'order_id' => $orderId,
                'branch_id' => $base['branch_id'],
                'driver_user_id' => $assigned ? (string) $driver->getKey() : null,
                'status' => $jobStatus,
                'tracking_status' => $tracking,
                'assigned_at' => $assigned ? $placed : null,
                'lock_version' => 0,
                'created_at' => $placed,
                'updated_at' => $placed,
            ]);
        }

        $paid = (float) $spec['paid'];
        if ($paid > 0) {
            /** @var User $by */
            $by = $spec['receiptBy'] ?? $owner;
            $receiptAt = $placed->isFuture() ? CarbonImmutable::now() : $placed;
            DB::table('order_payment_receipts')->insert([
                'id' => (string) Str::uuid7(),
                'organisation_id' => $base['organisation_id'],
                'order_id' => $orderId,
                'method' => $method,
                'amount_minor' => (int) round($grand * $paid),
                'currency_code' => self::CURRENCY,
                'reference' => $method === 'wish' ? sprintf('WSH-%05d', 40000 + $this->sequence) : null,
                'confirmed_by' => (string) $by->getKey(),
                'confirmed_at' => $receiptAt,
                'created_at' => $receiptAt,
                'updated_at' => $receiptAt,
            ]);
        }
    }
}
