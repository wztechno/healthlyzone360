<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\PlanMenuEntry;
use Healthy360\Catalogues\Services\PlanMenuService;
use Healthy360\Inventory\Contracts\SubscriptionMealDemand;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use RuntimeException;

/**
 * What one branch must buy to cook a window, and the part of that window nobody
 * could work out (C5).
 *
 * ## Where this lives, and why it could not live beside the rest of the desk
 *
 * The forecast is an order-desk surface and it is implemented in **Inventory**,
 * because the half of it nobody can move is here: {@see MealExplosion},
 * `stock_items`, `stock_levels` and `par_level`. The alternative — hosting it in
 * `Orders\OrderDesk` beside the queue and the calendar, and reaching in here for
 * the explosion — is not merely worse, it is unavailable: the registry edge runs
 * Inventory → Orders, so Orders → Inventory would close the cycle the
 * architecture test rejects. Two of the three demand populations were already
 * reachable from here (`order_lines` over that same Orders edge,
 * `plan_menu_entries` over Catalogues); the third arrives through
 * {@see SubscriptionMealDemand}, this module's first outward port.
 *
 * ## Three populations, one explosion
 *
 * A window's demand comes from three places, and they are counted separately
 * because they are three different kinds of promise:
 *
 *  1. **Real order lines** on every non-cancelled order whose requested delivery
 *     date falls in the window — meals and resold products alike. Somebody
 *     agreed to this and the kitchen wrote it down.
 *  2. **Meal choices** standing against subscription days that are *not yet*
 *     orders. A customer (or the kitchen's own default) has said what fills the
 *     slot; generation has not turned it into a line yet.
 *  3. **Plan-menu days**: for those same subscription days, every slot the
 *     plan's menu names that no choice row has claimed. This is what generation
 *     will write when it reaches the day, computed a fortnight early.
 *
 * They can never double-count, because population 2 and 3 only ever see days no
 * order exists for — the port refuses to answer for a generated day, and says
 * why — and within them a slot with a choice is population 2's and a slot
 * without is population 3's.
 *
 * **The quantities are summed per meal before anything is exploded, and that is
 * exactness rather than economy.** Explosion is linear in the quantity — every
 * step multiplies by it once, at the end — so exploding six of a dish gives the
 * same figure as summing four and two and exploding six, while exploding four
 * and two separately would round twice and disagree with itself. One explosion
 * per meal is therefore both the cheaper and the more accurate arrangement, and
 * a kitchen selling the same dish sixty times in a window pays for one recipe
 * read rather than sixty.
 *
 * ## Demand is the organisation's; availability is one branch's
 *
 * `branchId` is **required**, and it narrows exactly one thing: the shelf the
 * requirement is compared against. It does *not* narrow the demand, and the
 * asymmetry is deliberate rather than an oversight.
 *
 * A `stock_item` is an organisation-level row — {@see MealExplosion::resolveStockItem()}
 * says so, and uses the branch only to break a tie between two shelves for one
 * ingredient — while a `stock_level` is per-branch. So "how much flour does this
 * window need" is genuinely an organisation-level question and "how much flour
 * is on the shelf" is genuinely a branch-level one, and this service answers
 * each at its own grain. Narrowing the demand as well would also have required a
 * policy for the orders and subscription days that carry **no** branch at all
 * (both columns are nullable, and an organisation-wide delivery zone produces
 * exactly that) — either dropping them, which under-states a buy list and stops
 * a kitchen cooking, or spreading them, which over-states every branch's. One
 * statable rule beats two special cases.
 *
 * The consequence to know: in a multi-site organisation this answers "everything
 * this kitchen owes, measured against *this* site's shelf", which over-states
 * what that site alone must buy. For the single-site kitchens the platform sells
 * to it is exact, and it is never short.
 *
 * ## Comparisons run at four places (H3)
 *
 * Requirements are computed at six — the explosion's scale, and the scale the
 * movement ledger stores — while `stock_levels.quantity` is `decimal(14,4)`.
 * Comparing the two at six would manufacture shortfalls of 5e-5 on rows that
 * balance exactly, so every comparison and every emitted buy quantity runs at
 * four. `required` is still published at six, because truncating a computed
 * figure to make it match the column it is being compared against would be
 * publishing a rounder number than the one the arithmetic produced.
 *
 * ## Holes are never folded into numbers
 *
 * A meal with no published recipe, a menu that was never written, a recipe line
 * measured in a unit that will not convert into the shelf's — none of these
 * produce a quantity, and none of them produce a zero either. They produce an
 * entry in `not_computable`, because "buy nothing for that" and "we could not
 * work out what to buy for that" are opposite statements and a buy list that
 * confused them would send somebody home with the wrong van.
 *
 * `insufficient_stock` is deliberately **not** a reason here: on this surface it
 * is the output, spelled `short`. `no_catalogue_item` is unreachable —
 * `order_lines.catalogue_item_id` is `restrictOnDelete`, and the other two
 * populations read the item from the row that names it. `no_ingredient_cost`
 * belongs to the costing side, which a forecast never enters. `no_branch` cannot
 * arise because the branch is a required parameter.
 *
 * ## Tenancy (H5)
 *
 * Every read is `withoutTenancy()` with the organisation stated explicitly.
 * Nothing here depends on ambient request context, so the same service answers a
 * controller and a nightly job identically — which is the point, since the
 * obvious next use of a buy list is a job that mails one.
 */
final readonly class RequirementForecast
{
    /**
     * The scale requirements are computed and published at — the explosion's own
     * and the stock ledger's.
     */
    private const int SCALE = 6;

    /**
     * The scale every comparison and every buy quantity runs at, because that is
     * what `stock_levels.quantity` and `par_level` store (H3).
     */
    private const int COMPARISON_SCALE = 4;

    /**
     * A demand item that is neither a meal nor a product contributes one of
     * these to every date it appears on. Today only the withdrawn-dish case
     * reaches it.
     */
    private const string DISH_WITHDRAWN = 'menu_dish_withdrawn';

    /**
     * The explosion's vocabulary translated into the forecast's.
     *
     * Only `no_recipe_version` is actually renamed, and it is renamed because
     * the two surfaces are answering different questions: an exception queue
     * says a *version* was missing at the moment of a deduction, while a buy
     * list is telling a buyer that a dish on next Tuesday's menu has no recipe
     * to buy for. The rest travel unchanged so that a manager comparing the
     * forecast against the consumption exceptions is reading one vocabulary.
     *
     * A code not listed here travels under its own name rather than being
     * dropped: a silent hole is the one outcome this class exists to prevent,
     * and the wire schema publishes `reasons` as an open map for that reason.
     *
     * @var array<string, string>
     */
    private const array REASON_MAP = [
        'no_recipe_version' => 'meal_has_no_recipe',
    ];

    public function __construct(
        private MealExplosion $explosion,
        private SubscriptionMealDemand $demand,
        private PlanMenuService $menus,
    ) {}

    /**
     * One branch's buy list for one window.
     *
     * @param  string  $branchId  the shelf to compare against — required, because there is no honest organisation-wide "available"
     */
    public function forOrganisation(
        string $organisationId,
        CarbonImmutable $from,
        CarbonImmutable $to,
        string $branchId,
    ): RequirementForecastResult {
        $start = $from->startOfDay();
        $end = $to->startOfDay();

        if ($end->lessThan($start)) {
            return new RequirementForecastResult;
        }

        /** @var array<string, array{quantity: numeric-string, dates: array<string, true>}> $demanded */
        $demanded = [];

        /** @var array<string, array<string, true>> $holes date → reason → present */
        $holes = [];

        $this->tallyOrderLines($organisationId, $start, $end, $demanded);

        // The branch is deliberately **not** passed: demand is the
        // organisation's book and only availability is one shelf's — see the
        // class docblock. The port keeps the parameter because it mirrors
        // `SubscriptionOutlook`, whose caller does narrow.
        $subscriptions = $this->demand->forWindow($organisationId, $start, $end, null);

        $this->tallyChoices($subscriptions['choices'], $demanded);
        $this->tallyPlanMenus($organisationId, $subscriptions['days'], $subscriptions['choices'], $demanded, $holes);

        $required = $this->explodeDemand($organisationId, $branchId, $demanded, $holes);

        return new RequirementForecastResult(
            $this->compareAgainstShelf($organisationId, $branchId, $required),
            count($holes),
            $this->countReasons($holes),
        );
    }

    /**
     * Population 1 — every line of every non-cancelled order the window carries.
     *
     * Which orders count is the calendar's rule, for the calendar's reason: a
     * *fulfilled* order still consumed its ingredients that day, and a buy list
     * that dropped it would empty the past out as the week was worked. Cancelled
     * orders count nowhere; consumption reverses their deduction, so counting
     * them would be buying for food nobody cooks.
     *
     * Orders with no requested delivery date are excluded — they have no day in
     * the window to be demand *for*, and treating one as "today" (which is the
     * queue's rule, because a queue is a list of work in hand) would move it
     * every midnight.
     *
     * The organisation is applied to `orders`, not to `order_lines`: the line
     * table carries no organisation column and the order is the isolation
     * boundary for both, exactly as `CalendarComposition` and
     * `OrderQuery::forSeller()` treat it.
     *
     * @param  array<string, array{quantity: numeric-string, dates: array<string, true>}>  $demanded
     */
    private function tallyOrderLines(
        string $organisationId,
        CarbonImmutable $start,
        CarbonImmutable $end,
        array &$demanded,
    ): void {
        $rows = OrderLine::query()
            ->join('orders', 'orders.id', '=', 'order_lines.order_id')
            ->where('orders.organisation_id', $organisationId)
            ->where('orders.status', '!=', OrderStatus::Cancelled->value)
            ->whereNotNull('orders.requested_delivery_date')
            ->whereBetween('orders.requested_delivery_date', [$start->toDateString(), $end->toDateString()])
            ->orderBy('order_lines.id')
            ->get([
                'order_lines.catalogue_item_id',
                'order_lines.quantity',
                'orders.requested_delivery_date',
            ]);

        foreach ($rows as $row) {
            $date = $row->getAttribute('requested_delivery_date');

            $this->addDemand(
                $demanded,
                (string) $row->catalogue_item_id,
                (string) $row->quantity,
                $date instanceof CarbonImmutable ? $date->toDateString() : (string) $date,
            );
        }
    }

    /**
     * Population 2 — the meal choices standing against days that are not orders
     * yet.
     *
     * One choice row is one portion. `subscription_meal_choices` has no quantity
     * column by design: a slot holds a dish, and a customer wanting two of
     * something takes two sequences of it.
     *
     * @param  list<array{subscription_id: string, delivery_date: string, slot: string, sequence: int, catalogue_item_id: string}>  $choices
     * @param  array<string, array{quantity: numeric-string, dates: array<string, true>}>  $demanded
     */
    private function tallyChoices(array $choices, array &$demanded): void
    {
        foreach ($choices as $choice) {
            $this->addDemand($demanded, $choice['catalogue_item_id'], '1', $choice['delivery_date']);
        }
    }

    /**
     * Population 3 — what the plan's menu will put in the slots nobody has
     * chosen for.
     *
     * This is `GenerationService::fillFromPlanMenu()` read rather than written,
     * and it mirrors that method rule for rule because any divergence would show
     * up as a kitchen buying for a dish it then does not cook:
     *
     *  * the cycle day comes from the same double-modulus helper against the
     *    plan's own anchor;
     *  * a plan with no `menu_cycle_days` fills nothing — and here contributes
     *    `plan_has_no_menu` for a day nobody has chosen for either, because such
     *    a day is one the kitchen genuinely cannot plan a purchase for. A day
     *    with choices on a menu-less plan is fully answered by population 2 and
     *    raises nothing;
     *  * **a withdrawn dish fills nothing.** Generation refuses to pack a dish
     *    the kitchen has taken off sale, so forecasting it would buy ingredients
     *    for food that will never leave the building. It is a hole rather than a
     *    silence, because the slot will be filled by *something* the forecast
     *    cannot name.
     *
     * The plan's menu is read once per plan however many days it serves — three
     * reads for a plan appearing on sixty days rather than a hundred and eighty.
     *
     * @param  list<array{subscription_id: string, plan_catalogue_item_id: string, delivery_date: string, basis: string}>  $days
     * @param  list<array{subscription_id: string, delivery_date: string, slot: string, sequence: int, catalogue_item_id: string}>  $choices
     * @param  array<string, array{quantity: numeric-string, dates: array<string, true>}>  $demanded
     * @param  array<string, array<string, true>>  $holes
     */
    private function tallyPlanMenus(
        string $organisationId,
        array $days,
        array $choices,
        array &$demanded,
        array &$holes,
    ): void {
        if ($days === []) {
            return;
        }

        /** @var array<string, true> $claimed */
        $claimed = [];

        foreach ($choices as $choice) {
            $claimed[$choice['subscription_id'].'|'.$choice['delivery_date'].'|'.$choice['slot'].'|'.$choice['sequence']] = true;
        }

        /** @var array<string, true> $chosenDays */
        $chosenDays = [];

        foreach ($choices as $choice) {
            $chosenDays[$choice['subscription_id'].'|'.$choice['delivery_date']] = true;
        }

        /** @var array<string, array{cycle_days: int|null, anchor_date: string|null, entries: list<PlanMenuEntry>, meals: array<string, CatalogueItem>}|null> $plans */
        $plans = [];

        foreach ($days as $day) {
            $planId = $day['plan_catalogue_item_id'];

            if (! array_key_exists($planId, $plans)) {
                $plans[$planId] = $this->readMenu($organisationId, $planId);
            }

            $menu = $plans[$planId];
            $cycleDays = $menu === null ? null : $menu['cycle_days'];
            $anchorDate = $menu === null ? null : $menu['anchor_date'];

            if ($menu === null || $cycleDays === null || $anchorDate === null) {
                if (! array_key_exists($day['subscription_id'].'|'.$day['delivery_date'], $chosenDays)) {
                    $this->addHole($holes, $day['delivery_date'], 'plan_has_no_menu');
                }

                continue;
            }

            $cycleDay = PlanMenuEntry::cycleDayFor(
                CarbonImmutable::parse($day['delivery_date']),
                CarbonImmutable::parse($anchorDate),
                $cycleDays,
            );

            foreach ($menu['entries'] as $entry) {
                if ($entry->cycle_day !== $cycleDay) {
                    continue;
                }

                $coordinate = $day['subscription_id'].'|'.$day['delivery_date'].'|'.$entry->slot.'|'.$entry->sequence;

                if (array_key_exists($coordinate, $claimed)) {
                    // Population 2 already counted this slot. A customer's own
                    // choice beats the menu's default here for the same reason
                    // it does at generation: the row that exists is the one the
                    // kitchen will read back.
                    continue;
                }

                $meal = $menu['meals'][$entry->meal_catalogue_item_id] ?? null;

                if (! $meal instanceof CatalogueItem || ! $meal->status->isConsumerVisible()) {
                    $this->addHole($holes, $day['delivery_date'], self::DISH_WITHDRAWN);

                    continue;
                }

                $this->addDemand($demanded, (string) $meal->getKey(), '1', $day['delivery_date']);
            }
        }
    }

    /**
     * One plan's menu, read once and kept.
     *
     * Returns null when the plan itself cannot be read as this organisation's —
     * a state the schema forbids (`subscriptions.catalogue_item_id` is a
     * constrained foreign key) and which is therefore handled as a menu-less
     * plan rather than as a crash.
     *
     * @return array{cycle_days: int|null, anchor_date: string|null, entries: list<PlanMenuEntry>, meals: array<string, CatalogueItem>}|null
     */
    private function readMenu(string $organisationId, string $planId): ?array
    {
        $plan = CatalogueItem::withoutTenancy()
            ->where('id', $planId)
            ->where('organisation_id', $organisationId)
            ->first();

        if (! $plan instanceof CatalogueItem) {
            return null;
        }

        $cycle = $this->menus->cycleFor($plan);
        $entries = $this->menus->entriesFor($plan);

        return [
            'cycle_days' => $cycle['cycle_days'],
            'anchor_date' => $cycle['anchor_date'],
            'entries' => $entries,
            'meals' => $this->menus->mealsFor($entries),
        ];
    }

    /**
     * Turn every demanded article into per-stock-item quantities.
     *
     * One explosion per meal, whatever the window demanded of it — the linearity
     * argument in the class docblock. A failure is attributed to **every date
     * that meal was demanded on**, because that is what it means: the days are
     * the ones a buyer cannot plan, and the meal is merely why.
     *
     * The three item types branch exactly as `OrderConsumptionService::resolveLine()`
     * branches, so the forecast and the deduction agree about what a subscription
     * plan line is: nothing. The plan-day line carries no food; the meal lines
     * generated beside it carry all of it.
     *
     * @param  array<string, array{quantity: numeric-string, dates: array<string, true>}>  $demanded
     * @param  array<string, array<string, true>>  $holes
     * @return array<string, array{ingredient_id: string, quantity: numeric-string}>
     */
    private function explodeDemand(
        string $organisationId,
        string $branchId,
        array $demanded,
        array &$holes,
    ): array {
        if ($demanded === []) {
            return [];
        }

        /** @var array<string, CatalogueItem> $items */
        $items = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereKey(array_keys($demanded))
            ->get()
            ->keyBy(static fn (CatalogueItem $item): string => (string) $item->getKey())
            ->all();

        /** @var array<string, array{ingredient_id: string, quantity: numeric-string}> $required */
        $required = [];

        foreach ($demanded as $itemId => $entry) {
            $item = $items[$itemId] ?? null;

            if (! $item instanceof CatalogueItem) {
                // Unreachable: every population reads the item id off a row whose
                // foreign key is `restrictOnDelete`, so the article cannot have
                // gone. Skipped rather than guessed at, and deliberately without a
                // reason code — `no_catalogue_item` is dropped from this taxonomy
                // precisely because the schema makes it impossible.
                continue;
            }

            match ($item->item_type) {
                CatalogueItemType::Meal => $this->requireMeal($organisationId, $branchId, $item, $entry, $required, $holes),
                CatalogueItemType::Product => $this->requireProduct($organisationId, $branchId, $item, $entry, $required, $holes),
                CatalogueItemType::SubscriptionPlan => null,
            };
        }

        return $required;
    }

    /**
     * @param  array{quantity: numeric-string, dates: array<string, true>}  $entry
     * @param  array<string, array{ingredient_id: string, quantity: numeric-string}>  $required
     * @param  array<string, array<string, true>>  $holes
     */
    private function requireMeal(
        string $organisationId,
        string $branchId,
        CatalogueItem $meal,
        array $entry,
        array &$required,
        array &$holes,
    ): void {
        $explosion = $this->explosion->explode($organisationId, $meal, $entry['quantity'], $branchId);

        foreach ($explosion->rows as $row) {
            $this->addRequirement($required, $row['stock_item_id'], $row['ingredient_id'], $row['quantity']);
        }

        foreach ($explosion->failures as $failure) {
            $this->addHoles($holes, $entry['dates'], $failure['reason_code']);
        }
    }

    /**
     * A resold product takes its own quantity off its own shelf, one sold for
     * one gone — the read half of `OrderConsumptionService::resolveProduct()`,
     * mirrored rather than re-derived, down to resolving the shelf through
     * {@see MealExplosion::resolveStockItem()} so that a product and a meal made
     * of the same ingredient land on the same row.
     *
     * The unit is the stock item's, unconverted: there is nothing to convert
     * *from*, because a product's demand is already counted in the units it is
     * sold and stocked in.
     *
     * @param  array{quantity: numeric-string, dates: array<string, true>}  $entry
     * @param  array<string, array{ingredient_id: string, quantity: numeric-string}>  $required
     * @param  array<string, array<string, true>>  $holes
     */
    private function requireProduct(
        string $organisationId,
        string $branchId,
        CatalogueItem $product,
        array $entry,
        array &$required,
        array &$holes,
    ): void {
        if ($product->ingredient_id === null) {
            $this->addHoles($holes, $entry['dates'], 'no_ingredient_link');

            return;
        }

        $stockItem = $this->explosion->resolveStockItem($organisationId, (string) $product->ingredient_id, $branchId);

        if (! $stockItem instanceof StockItem) {
            $this->addHoles($holes, $entry['dates'], 'no_stock_item');

            return;
        }

        if ($stockItem->unit_id === null) {
            $this->addHoles($holes, $entry['dates'], 'no_stock_unit');

            return;
        }

        $quantity = $this->round($entry['quantity']);

        if (bccomp($quantity, '0', self::SCALE) <= 0) {
            return;
        }

        $this->addRequirement($required, (string) $stockItem->getKey(), (string) $product->ingredient_id, $quantity);
    }

    /**
     * Compare each requirement against the branch's shelf and say what to buy.
     *
     * **A stock item with no level row at this branch reads as zero, not as
     * unknown.** A level row is created by the first movement; its absence means
     * nothing has ever been received or counted there, which is a shelf holding
     * none of that thing. Publishing it as an unknown would put an em dash where
     * the buyer most needs a number.
     *
     * `suggested_buy` is buy-up-to-par where a par is set and the bare shortfall
     * where it is not: `par − (available − required)` is what leaves the shelf at
     * par once the window has been cooked. Where that is not positive — which is
     * exactly the case H12 warns about, a par written below the reorder threshold
     * or below the window's own demand — it falls back to the shortfall, so a par
     * nobody has maintained can never *reduce* a buy below what the window needs.
     *
     * @param  array<string, array{ingredient_id: string, quantity: numeric-string}>  $required
     * @return list<array{ingredient_id: string, stock_item_id: string, code: string, name_en: string, unit_id: string|null, unit_code: string|null, required: numeric-string, available: numeric-string, short: numeric-string, suggested_buy: numeric-string}>
     */
    private function compareAgainstShelf(string $organisationId, string $branchId, array $required): array
    {
        if ($required === []) {
            return [];
        }

        $stockItemIds = array_keys($required);

        /** @var array<string, StockItem> $stockItems */
        $stockItems = StockItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereKey($stockItemIds)
            ->orderBy('code')
            ->get()
            ->keyBy(static fn (StockItem $item): string => (string) $item->getKey())
            ->all();

        /** @var array<string, StockLevel> $levels */
        $levels = StockLevel::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('branch_id', $branchId)
            ->whereIn('stock_item_id', $stockItemIds)
            ->get()
            ->keyBy(static fn (StockLevel $level): string => (string) $level->stock_item_id)
            ->all();

        $unitIds = array_values(array_filter(array_map(
            static fn (StockItem $item): ?string => $item->unit_id,
            $stockItems,
        )));

        /** @var array<string, MeasurementUnit> $units */
        $units = $unitIds === []
            ? []
            : MeasurementUnit::query()
                ->whereKey($unitIds)
                ->get()
                ->keyBy(static fn (MeasurementUnit $unit): string => (string) $unit->getKey())
                ->all();

        $rows = [];

        // `$stockItems` is already ordered by code, so the buy list comes out in
        // the order a store cupboard is walked rather than in the order the
        // recipes happened to mention things.
        foreach ($stockItems as $stockItemId => $stockItem) {
            $requirement = $required[$stockItemId] ?? null;

            if ($requirement === null) {
                continue;
            }

            $level = $levels[$stockItemId] ?? null;
            $available = $level === null ? '0' : $this->numeric((string) $level->quantity);
            $need = $requirement['quantity'];

            $short = bccomp($need, $available, self::COMPARISON_SCALE) > 0
                ? bcsub($need, $available, self::COMPARISON_SCALE)
                : bcadd('0', '0', self::COMPARISON_SCALE);

            $unitId = $stockItem->unit_id;
            $unit = $unitId === null ? null : ($units[$unitId] ?? null);

            $rows[] = [
                'ingredient_id' => $requirement['ingredient_id'],
                'stock_item_id' => (string) $stockItemId,
                'code' => $stockItem->code,
                'name_en' => $stockItem->name_en,
                'unit_id' => $unitId,
                'unit_code' => $unit?->code,
                'required' => bcadd($need, '0', self::SCALE),
                'available' => bcadd($available, '0', self::COMPARISON_SCALE),
                'short' => $short,
                'suggested_buy' => $this->suggestedBuy($level?->par_level, $available, $need, $short),
            ];
        }

        return $rows;
    }

    /**
     * @param  numeric-string  $available
     * @param  numeric-string  $need
     * @param  numeric-string  $short
     * @return numeric-string
     */
    private function suggestedBuy(?string $parLevel, string $available, string $need, string $short): string
    {
        if ($parLevel === null) {
            return $short;
        }

        // par − (available − required), rearranged so both subtractions happen at
        // the comparison scale rather than one of them at six.
        $upTo = bcadd(bcsub($this->numeric($parLevel), $available, self::COMPARISON_SCALE), $need, self::COMPARISON_SCALE);

        return bccomp($upTo, '0', self::COMPARISON_SCALE) > 0 ? $upTo : $short;
    }

    /**
     * @param  array<string, array{quantity: numeric-string, dates: array<string, true>}>  $demanded
     */
    private function addDemand(array &$demanded, string $catalogueItemId, string $quantity, string $date): void
    {
        $demanded[$catalogueItemId] ??= ['quantity' => '0', 'dates' => []];
        $demanded[$catalogueItemId]['quantity'] = bcadd(
            $demanded[$catalogueItemId]['quantity'],
            $this->numeric($quantity),
            self::SCALE,
        );
        $demanded[$catalogueItemId]['dates'][$date] = true;
    }

    /**
     * @param  array<string, array{ingredient_id: string, quantity: numeric-string}>  $required
     * @param  numeric-string  $quantity
     */
    private function addRequirement(array &$required, string $stockItemId, string $ingredientId, string $quantity): void
    {
        $required[$stockItemId] ??= ['ingredient_id' => $ingredientId, 'quantity' => '0'];
        $required[$stockItemId]['quantity'] = bcadd($required[$stockItemId]['quantity'], $quantity, self::SCALE);
    }

    /**
     * @param  array<string, array<string, true>>  $holes
     * @param  array<string, true>  $dates
     */
    private function addHoles(array &$holes, array $dates, string $reasonCode): void
    {
        foreach (array_keys($dates) as $date) {
            $this->addHole($holes, (string) $date, $reasonCode);
        }
    }

    /**
     * A hole is a **(date, reason) pair**, recorded as a set rather than a
     * counter.
     *
     * Three ingredients of one dish all failing `no_stock_item` on Tuesday is one
     * Tuesday a buyer cannot plan for that reason, not three — the number a
     * screen is asking for is "how much of this window is guesswork", and
     * counting occurrences would make an elaborate recipe look like a bigger
     * problem than a simple one with the same consequence.
     *
     * @param  array<string, array<string, true>>  $holes
     */
    private function addHole(array &$holes, string $date, string $reasonCode): void
    {
        $holes[$date] ??= [];
        $holes[$date][self::REASON_MAP[$reasonCode] ?? $reasonCode] = true;
    }

    /**
     * Hole counts by reason, most days first and then alphabetically so that two
     * identical windows produce identical responses.
     *
     * @param  array<string, array<string, true>>  $holes
     * @return array<string, int>
     */
    private function countReasons(array $holes): array
    {
        $counts = [];

        foreach ($holes as $reasons) {
            foreach (array_keys($reasons) as $reason) {
                $counts[(string) $reason] = ($counts[(string) $reason] ?? 0) + 1;
            }
        }

        uksort($counts, static function (string $left, string $right) use ($counts): int {
            return [$counts[$right], $left] <=> [$counts[$left], $right];
        });

        return $counts;
    }

    /**
     * bcmath handed a non-numeric string returns zero rather than erroring, so a
     * malformed quantity would silently make a requirement free. This turns that
     * into a loud failure instead — the same guard the explosion and the
     * deduction carry, for the same reason.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Requirement forecast arithmetic received a non-numeric value [{$value}].");
        }

        return $value;
    }

    /**
     * Round half away from zero to the six places the stock columns store — the
     * one rounding rule shared across the money-and-stock arithmetic.
     *
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function round(string $value): string
    {
        $half = '0.'.str_repeat('0', self::SCALE).'5';
        $negative = str_starts_with($value, '-');

        return bcadd($value, $negative ? '-'.$half : $half, self::SCALE);
    }
}
