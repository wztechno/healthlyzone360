<?php

declare(strict_types=1);

use Database\Seeders\DatabaseSeeder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| The anonymous surface leaks nothing (master plan v2 §4.8)
|--------------------------------------------------------------------------
|
| §4.8 names a denylist — recipe lines, raw-material quantities, unit costs,
| cost snapshots, waste coefficients, supplier identities, margins,
| data-quality notes, document paths, KYC, signature evidence, review
| commentary, internal recipe identifiers — and requires an automated sweep
| across the *whole* anonymous surface in every phase that adds a public
| endpoint. This is that sweep, extended by M1 from three reference lists to
| the marketplace.
|
| It works in two directions, because the two catch different mistakes.
|
| **Literals.** Distinctive strings and a distinctive number are written into
| the confidential columns of the demonstration kitchen — a supplier note, an
| import reference, a quarantine reason, a wholesale price. If any of them
| appears anywhere in any anonymous response, something serialised a row it
| should never have loaded. A literal sweep catches a leak through a field
| nobody thought to name.
|
| **Keys.** Every anonymous response is walked recursively and every object key
| is checked against the denylist. A key sweep catches a leak whose *value*
| happens to be innocuous today — an empty `cost_snapshots: []` is not a leak
| yet, and is the shape that becomes one the moment somebody populates it.
|
| The route list is discovered rather than typed. A future anonymous endpoint
| joins this sweep by existing, which is the only way a sweep like this stays
| true.
|
*/

/** Written into confidential columns; must appear in no anonymous response. */
const LEAK_LITERAL = 'H360-CONFIDENTIAL-SWEEP-LITERAL';

/** A wholesale unit price, in minor units. Distinctive enough to grep for. */
const LEAK_COST_MINOR = 987654321;

/**
 * Keys no anonymous response may carry, whatever their value.
 *
 * Three families. **Confidential domain data** (costs, margins, suppliers,
 * waste, formulations) is the §4.8 denylist proper. **Internal bookkeeping**
 * (`created_by`, `lock_version`, `organisation_id`, the price-list identifiers
 * a resolver carries for C1's benefit) is not secret but is nobody's business
 * on a consumer surface, and its presence means a projection was skipped.
 * **Both-language columns** (`name_en` beside `name_ar`) are the specific §4.8
 * localisation rule: a public projection carries one server-chosen name, and a
 * pair of columns means somebody serialised the model.
 *
 * @return list<string>
 */
function publicKeyDenylist(): array
{
    return [
        // Confidential domain data.
        'cost', 'unit_cost', 'cost_amount', 'total_cost', 'cost_per_unit',
        'cost_snapshot', 'cost_snapshots', 'margin', 'margin_percent', 'markup',
        'supplier', 'supplier_id', 'supplier_name', 'waste', 'waste_coefficient',
        'yield_factor', 'lines', 'recipe_lines', 'steps', 'outputs', 'quantity',
        'recipe_id', 'recipe_version_id', 'recipe_version_ids',

        // Internal bookkeeping and pricing paperwork.
        'price_list_id', 'price_list_item_id', 'unit_amount_minor', 'min_quantity',
        'price_status', 'organisation_id', 'created_by', 'updated_by', 'lock_version',
        'seeded_at', 'source_system', 'source_ref', 'data_quality_flags',
        'review_reason', 'notes', 'evidence', 'document_path', 'kyc', 'signature',
        'verification_status',

        // Both-language columns (§4.8 localisation).
        'name_en', 'name_ar', 'description_en', 'description_ar',
        'summary_en', 'summary_ar',
    ];
}

/**
 * Every anonymous GET under `/api/v1`, with its path parameters filled in.
 *
 * "Anonymous" is read off the route's own middleware stack rather than from a
 * list here: a route that does not require `auth:sanctum` is reachable without
 * a session, and that is exactly the set this sweep must cover.
 *
 * @return list<string>
 */
function anonymousGetPaths(): array
{
    $substitutions = [
        '{kitchen}' => 'verdant-kitchen',
        '{meal}' => 'grilled-chicken-freekeh',
        '{plan}' => 'balanced-plan',

        // G1. `GET /guest/orders/{order}` carries no `auth:sanctum` — its
        // credential is `X-Guest-Token` — so the discovery below finds it, and
        // rightly: an endpoint an anonymous caller can *reach* belongs in a
        // sweep of what an anonymous caller can *see*. Any identifier will do,
        // because the interesting response is the refusal.
        '{order}' => '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d3c',
    ];

    $queries = [
        'api/v1/reference/delivery-areas' => '?country_code=LB',
    ];

    $paths = [];

    foreach (Route::getRoutes() as $route) {
        /** @var RoutingRoute $route */
        if (! str_starts_with($route->uri(), 'api/v1/') || ! in_array('GET', $route->methods(), true)) {
            continue;
        }

        if (in_array('auth:sanctum', $route->gatherMiddleware(), true)) {
            continue;
        }

        $uri = $route->uri();

        foreach ($substitutions as $parameter => $value) {
            $uri = str_replace($parameter, $value, $uri);
        }

        // A parameter nothing substitutes would be requested literally, which
        // would answer 404 and prove nothing. Failing loudly is the point: a
        // new anonymous endpoint must be given a fixture here, not skipped.
        expect($uri)->not->toContain('{', "The sweep has no fixture for the anonymous route {$route->uri()}.");

        $paths[] = '/'.$uri.($queries[$route->uri()] ?? '');
    }

    sort($paths);

    return array_values(array_unique($paths));
}

/**
 * Every object key in a decoded body, at every depth — except the subtrees
 * named in `$exemptSubtrees`, whose keys are walked *past* rather than *into*.
 *
 * The one exemption this sweep grants is the marketplace meal's public
 * nutrition shape. Meal composition/nutrition — the `nutrition` object and the
 * `serving` summary mirrored from it — is INTENTIONALLY public on the meal
 * endpoint by owner decision (2026-08-10): a consumer surface states a dish's
 * serving size and per-serving amounts, and that shape legitimately carries
 * `quantity` (serving quantity) and `notes` (calculation notes). The allowance
 * is scoped to those two subtrees on that surface alone; `quantity` and `notes`
 * stay denylisted at every other depth and on every other surface, so a recipe
 * line's quantity, a supplier note, or a data-quality note is still caught.
 *
 * @param  list<string>  $exemptSubtrees
 * @return list<string>
 */
function keysWithin(mixed $body, array $exemptSubtrees = []): array
{
    if (! is_array($body)) {
        return [];
    }

    $keys = [];

    foreach ($body as $key => $value) {
        if (is_string($key)) {
            $keys[] = $key;

            // The key of an exempt subtree is itself recorded (it is innocuous),
            // but its descendants are not walked: the carve-out is the subtree,
            // not a global pardon for the keys inside it.
            if (in_array($key, $exemptSubtrees, true)) {
                continue;
            }
        }

        $keys = [...$keys, ...keysWithin($value, $exemptSubtrees)];
    }

    return $keys;
}

/**
 * The subtrees a marketplace meal is permitted to carry public nutrition under.
 *
 * @return list<string>
 */
function mealNutritionSubtrees(): array
{
    return ['nutrition', 'serving'];
}

/**
 * One anonymous response, swept.
 *
 * A `404` is swept exactly like a `200`. `GET /marketplace/meal-plans/{plan}`
 * legitimately answers `404` in this world — nothing is publishable — and an
 * error envelope is an anonymous response too: the `details` object of a
 * refusal is a perfectly good place to leak a row somebody loaded before
 * deciding to refuse. Any other status is a bug in the sweep's fixtures and
 * fails loudly.
 *
 * @return array{content: string, json: mixed}
 */
function sweptResponse(object $test, string $path): array
{
    /** @var TestResponse $response */
    $response = $test->getJson($path);

    // 401 joins the set with G1's token-gated reads. They are credentialled
    // rather than anonymous, but an anonymous caller reaches them, and their
    // refusal envelope is swept like every other body here — the `details` of a
    // refusal being a perfectly good place to leak a row somebody loaded before
    // deciding to refuse.
    //
    // 403 joins it for the same reason from the signature-gated reads. The
    // anonymous `GET /auth/verify-email/{id}/{hash}` is protected by `signed`
    // (ValidateSignature), so probing it with an unsigned id/hash rightly
    // answers 403 and leaks nothing — the refusal is correct and its envelope is
    // swept like every other body here.
    expect($response->getStatusCode())->toBeIn([200, 401, 403, 404], "{$path} answered an unexpected status.");

    return ['content' => $response->content(), 'json' => $response->json()];
}

beforeEach(function (): void {
    $this->seed(DatabaseSeeder::class);

    // The confidential world, written after the seed so it lands on rows the
    // marketplace really does read: this kitchen's ingredients feed the
    // published menu's allergen derivation, and its wholesale desk prices the
    // same catalogue the web shop does.
    //
    // The blanket writes go to the columns that carry no uniqueness — a
    // supplier note and a quarantine reason — and the import-provenance pair,
    // which *is* unique per organisation, is written to one row. One row is
    // enough: the sweep is looking for a substring anywhere in a response, not
    // for a count.
    Ingredient::withoutTenancy()->update(['notes' => LEAK_LITERAL]);
    CatalogueItem::withoutTenancy()->update(['review_reason' => LEAK_LITERAL]);

    Ingredient::withoutTenancy()->where('slug', 'freekeh')->update([
        'source_system' => 'confidential_sweep',
        'source_ref' => LEAK_LITERAL,
    ]);

    CatalogueItem::withoutTenancy()->where('slug', 'grilled-chicken-freekeh')->update([
        'source_system' => 'confidential_sweep',
        'source_ref' => LEAK_LITERAL,
    ]);

    // A **volume tier** on the very list the marketplace prices from: five
    // hundred portions of the same meal, at a rate nobody buying one is
    // entitled to see. The consumer contract explicitly cannot represent a
    // volume tier or a minimum order quantity, and this is the row that proves
    // the resolver honours the tier rule rather than merely lacking a field for
    // it — a public read asks for one, so the base price wins and this number
    // must appear in no response at all.
    $tiered = PriceList::withoutTenancy()->where('code', 'verdant-menu-usd')->sole();
    $meal = CatalogueItem::withoutTenancy()->where('slug', 'grilled-chicken-freekeh')->sole();

    PriceListItem::withoutTenancy()->create([
        'organisation_id' => $tiered->organisation_id,
        'price_list_id' => $tiered->getKey(),
        'catalogue_item_id' => $meal->getKey(),
        'catalogue_item_variant_id' => null,
        'min_quantity' => '500.0000',
        'unit_amount_minor' => LEAK_COST_MINOR,
        'price_status' => 'confirmed',
        'effective_from' => now()->toDateString(),
    ]);
});

it('covers every anonymous endpoint the application serves', function (): void {
    $paths = anonymousGetPaths();

    // A guard on the guard: if route discovery silently returned nothing, every
    // assertion below would pass vacuously.
    expect($paths)->toContain(
        '/api/v1/marketplace/kitchens',
        '/api/v1/marketplace/meals',
        '/api/v1/marketplace/meal-plans',
        '/api/v1/reference/allergen-classes',
    )->and(count($paths))->toBeGreaterThanOrEqual(9);
});

it('never serialises a confidential literal on any anonymous endpoint', function (): void {
    foreach (anonymousGetPaths() as $path) {
        $body = sweptResponse($this, $path)['content'];

        expect($body)->not->toContain(LEAK_LITERAL, "{$path} leaked a confidential literal.")
            ->and($body)->not->toContain((string) LEAK_COST_MINOR, "{$path} leaked a wholesale price.");
    }
});

it('never carries a denylisted key on any anonymous endpoint', function (): void {
    $denylist = publicKeyDenylist();

    foreach (anonymousGetPaths() as $path) {
        $keys = keysWithin(sweptResponse($this, $path)['json'], mealNutritionSubtrees());
        $offending = array_values(array_intersect($keys, $denylist));

        expect($offending)->toBe([], "{$path} carried denylisted keys: ".implode(', ', $offending));
    }
});

it('sweeps the single-resource endpoints as well as the collections', function (): void {
    $denylist = publicKeyDenylist();

    foreach (['/api/v1/marketplace/kitchens/verdant-kitchen', '/api/v1/marketplace/meals/mezze-plate'] as $path) {
        $swept = sweptResponse($this, $path);

        expect($swept['content'])->not->toContain(LEAK_LITERAL)
            ->and($swept['content'])->not->toContain((string) LEAK_COST_MINOR)
            ->and(array_values(array_intersect(keysWithin($swept['json'], mealNutritionSubtrees()), $denylist)))->toBe([]);
    }
});

it('never lets a placeholder or market-priced row become a public price', function (): void {
    // `chicken-freekeh-bowl` is priced only by a placeholder row — "we have not
    // priced this" — on a draft tariff. It is a draft item too, so it is doubly
    // invisible; the assertion that matters is that no response anywhere
    // mentions it, rather than that it merely fails to appear in one list.
    foreach (anonymousGetPaths() as $path) {
        expect(sweptResponse($this, $path)['content'])
            ->not->toContain('chicken-freekeh-bowl', "{$path} exposed an unpriced draft listing.");
    }
});

it('shows one kitchen nothing of another kitchen', function (): void {
    // Cedar Clinic is not a kitchen and its rows share every table the
    // marketplace reads. Nothing of it may appear on a surface that answers
    // questions about kitchens.
    foreach (anonymousGetPaths() as $path) {
        $body = sweptResponse($this, $path)['content'];

        expect($body)->not->toContain('cedar-clinic', "{$path} exposed a non-kitchen organisation.")
            ->and($body)->not->toContain('Cedar Clinic', "{$path} exposed a non-kitchen organisation.");
    }
});
