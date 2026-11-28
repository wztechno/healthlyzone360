<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Contracts\PlanDayListing;
use Healthy360\Orders\OrderDesk\Services\OrderDeskQueue;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/v1/catalogue/order-desk/plan-meals — one day's plan meals that are
 * not orders yet, by subscriber, with the dishes each has picked.
 *
 * **The calendar's "+3 plan meals", opened.** A plan day is an order that has
 * not been made: the generator turns it into one a day ahead. Until then the
 * calendar could only count it; this lists it the way the day panel lists the
 * day's orders — who, which plan, and what they chose for each sitting — so a
 * kitchen reads a planned day the same way it reads an ordered one. A day the
 * generator has already turned into an order is absent: its order is on the
 * book, and listing it here as well would cook it twice.
 *
 * **Read-only, and behind both of the calendar's codes**, for the calendar's
 * reason: it unions the order desk with a subscriber's standing arrangement.
 * The customer's name and number ride only with
 * `order.view_customer_contact_organisation`, as on the order book's rows.
 *
 * One day per request. The day panel shows one day; a window would be the
 * calendar, which already exists and already caps itself.
 */
final class OrderDeskPlanMealsController
{
    private const string CONTACT_PERMISSION = 'order.view_customer_contact_organisation';

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly PlanDayListing $planDays,
        private readonly OrderDeskQueue $queue,
    ) {}

    /**
     * @throws ValidationException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'date' => ['required', 'date_format:Y-m-d'],
            'branch_id' => ['nullable', 'uuid'],
        ]);

        $date = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['date'])->startOfDay();
        $branchId = isset($validated['branch_id']) ? (string) $validated['branch_id'] : null;

        $rows = $this->planDays->forDay($this->locator->sellerId(), $date, $branchId);

        $includeContact = Gate::allows(self::CONTACT_PERMISSION);
        $contacts = $includeContact
            ? $this->queue->contactsFor(array_column($rows, 'customer_account_id'))
            : [];

        $data = array_map(static function (array $row) use ($includeContact, $contacts): array {
            $item = [
                'subscription_id' => $row['subscription_id'],
                'basis' => $row['basis'],
                'plan' => ['name_en' => $row['plan_name_en'], 'name_ar' => $row['plan_name_ar']],
                'meals_per_day' => $row['meals_per_day'],
                'snacks_per_day' => $row['snacks_per_day'],
                'meals' => array_map(static fn (array $meal): array => [
                    'slot' => $meal['slot'],
                    'sequence' => $meal['sequence'],
                    'catalogue_item_id' => $meal['catalogue_item_id'],
                    'name_en' => $meal['name_en'],
                    'name_ar' => $meal['name_ar'],
                ], $row['meals']),
            ];

            if ($includeContact) {
                $contact = $contacts[$row['customer_account_id']] ?? ['display_name' => null, 'phone' => null];
                $item['customer'] = [
                    'display_name' => $contact['display_name'],
                    'phone' => $contact['phone'],
                ];
            }

            return $item;
        }, $rows);

        return ApiResponse::data($data, ['date' => $date->toDateString(), 'count' => count($data)]);
    }
}
