<?php

declare(strict_types=1);

use Healthy360\Allergens\Http\Controllers\AllergenClassDeactivateController;
use Healthy360\Allergens\Http\Controllers\AllergenClassStoreController;
use Healthy360\Allergens\Http\Controllers\AllergenClassUpdateController;
use Healthy360\Allergens\Http\Controllers\PublicAllergenClassIndexController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemAllergenIndexController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemChannelReplaceController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemDietClassificationReplaceController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemIndexController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemIngredientReplaceController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemPublishController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemReadinessController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemRetireController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemShowController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemStoreController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemUpdateController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemVariantReplaceController;
use Healthy360\Catalogues\Http\Controllers\PlanCombinationIndexController;
use Healthy360\Catalogues\Http\Controllers\PlanCombinationStoreController;
use Healthy360\Catalogues\Http\Controllers\PlanCombinationUpdateController;
use Healthy360\Catalogues\Http\Controllers\PlanDurationIndexController;
use Healthy360\Catalogues\Http\Controllers\PlanDurationStoreController;
use Healthy360\Catalogues\Http\Controllers\PlanDurationUpdateController;
use Healthy360\Catalogues\Http\Controllers\PlanEnergyBandIndexController;
use Healthy360\Catalogues\Http\Controllers\PlanEnergyBandStoreController;
use Healthy360\Catalogues\Http\Controllers\PlanEnergyBandUpdateController;
use Healthy360\Catalogues\Http\Controllers\PlanProfileShowController;
use Healthy360\Catalogues\Http\Controllers\PlanProfileUpdateController;
use Healthy360\Catalogues\Http\Controllers\PlanVariantDurationIndexController;
use Healthy360\Catalogues\Http\Controllers\PlanVariantDurationReplaceController;
use Healthy360\Catalogues\Http\Controllers\PlanVariantIndexController;
use Healthy360\Catalogues\Http\Controllers\PlanVariantReplaceController;
use Healthy360\Catalogues\Http\Controllers\PublicDietClassificationIndexController;
use Healthy360\Catalogues\Http\Controllers\SalesChannelIndexController;
use Healthy360\Catalogues\Http\Controllers\SalesChannelShowController;
use Healthy360\Catalogues\Http\Controllers\SalesChannelStoreController;
use Healthy360\Catalogues\Http\Controllers\SalesChannelUpdateController;
use Healthy360\Delivery\Http\Controllers\DeliveryWindowIndexController;
use Healthy360\Delivery\Http\Controllers\DeliveryWindowStoreController;
use Healthy360\Delivery\Http\Controllers\DeliveryWindowUpdateController;
use Healthy360\Delivery\Http\Controllers\DeliveryZoneArchiveController;
use Healthy360\Delivery\Http\Controllers\DeliveryZoneAreaIndexController;
use Healthy360\Delivery\Http\Controllers\DeliveryZoneAreaReplaceController;
use Healthy360\Delivery\Http\Controllers\DeliveryZoneIndexController;
use Healthy360\Delivery\Http\Controllers\DeliveryZoneShowController;
use Healthy360\Delivery\Http\Controllers\DeliveryZoneStoreController;
use Healthy360\Delivery\Http\Controllers\DeliveryZoneUpdateController;
use Healthy360\Delivery\Http\Controllers\PublicDeliveryAreaIndexController;
use Healthy360\Identity\Http\Controllers\ContextController;
use Healthy360\Identity\Http\Controllers\DeviceController;
use Healthy360\Identity\Http\Controllers\MeController;
use Healthy360\Identity\Http\Controllers\MembershipController;
use Healthy360\Ingredients\Http\Controllers\IngredientAliasDestroyController;
use Healthy360\Ingredients\Http\Controllers\IngredientAliasIndexController;
use Healthy360\Ingredients\Http\Controllers\IngredientAliasStoreController;
use Healthy360\Ingredients\Http\Controllers\IngredientAllergenIndexController;
use Healthy360\Ingredients\Http\Controllers\IngredientAllergenReplaceController;
use Healthy360\Ingredients\Http\Controllers\IngredientArchiveController;
use Healthy360\Ingredients\Http\Controllers\IngredientCategoryIndexController;
use Healthy360\Ingredients\Http\Controllers\IngredientCategoryStoreController;
use Healthy360\Ingredients\Http\Controllers\IngredientCategoryUpdateController;
use Healthy360\Ingredients\Http\Controllers\IngredientIndexController;
use Healthy360\Ingredients\Http\Controllers\IngredientShowController;
use Healthy360\Ingredients\Http\Controllers\IngredientStoreController;
use Healthy360\Ingredients\Http\Controllers\IngredientUpdateController;
use Healthy360\Kitchens\Http\Controllers\BranchOperatingReplaceController;
use Healthy360\Kitchens\Http\Controllers\BranchOperatingShowController;
use Healthy360\Organisations\Http\Controllers\CurrentOrganisationController;
use Healthy360\Pricing\Http\Controllers\PriceListArchiveController;
use Healthy360\Pricing\Http\Controllers\PriceListChannelReplaceController;
use Healthy360\Pricing\Http\Controllers\PriceListEntryIndexController;
use Healthy360\Pricing\Http\Controllers\PriceListEntryReplaceController;
use Healthy360\Pricing\Http\Controllers\PriceListIndexController;
use Healthy360\Pricing\Http\Controllers\PriceListPublishController;
use Healthy360\Pricing\Http\Controllers\PriceListShowController;
use Healthy360\Pricing\Http\Controllers\PriceListStoreController;
use Healthy360\Pricing\Http\Controllers\PriceListUpdateController;
use Healthy360\Recipes\Http\Controllers\RecipeArchiveController;
use Healthy360\Recipes\Http\Controllers\RecipeCostSnapshotIndexController;
use Healthy360\Recipes\Http\Controllers\RecipeCostSnapshotStoreController;
use Healthy360\Recipes\Http\Controllers\RecipeIndexController;
use Healthy360\Recipes\Http\Controllers\RecipeLineReplaceController;
use Healthy360\Recipes\Http\Controllers\RecipeOutputReplaceController;
use Healthy360\Recipes\Http\Controllers\RecipeShowController;
use Healthy360\Recipes\Http\Controllers\RecipeStepReplaceController;
use Healthy360\Recipes\Http\Controllers\RecipeStoreController;
use Healthy360\Recipes\Http\Controllers\RecipeTechnicalSheetController;
use Healthy360\Recipes\Http\Controllers\RecipeUpdateController;
use Healthy360\Recipes\Http\Controllers\RecipeVersionAllergenIndexController;
use Healthy360\Recipes\Http\Controllers\RecipeVersionIndexController;
use Healthy360\Recipes\Http\Controllers\RecipeVersionPublishController;
use Healthy360\Recipes\Http\Controllers\RecipeVersionReadinessController;
use Healthy360\Recipes\Http\Controllers\RecipeVersionRetireController;
use Healthy360\Recipes\Http\Controllers\RecipeVersionShowController;
use Healthy360\Recipes\Http\Controllers\RecipeVersionStoreController;
use Healthy360\Recipes\Http\Controllers\RecipeVersionUpdateController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Healthy360 API — version 1
|--------------------------------------------------------------------------
|
| Registered by bootstrap/app.php with the `api` middleware group and the
| /api/v1 prefix. Authentication endpoints live in routes/api-v1-auth.php,
| under the prefix declared by config/fortify.php.
|
| Every route here answers in the Healthy360 envelope
| (docs/api/conventions.md) and appears in openapi/healthy360.v1.yaml — a
| Pest test asserts that correspondence in both directions.
|
| `auth:sanctum` covers both credentials: a first-party cookie session (the
| Sanctum guard falls back to the `web` guard) and a bearer personal access
| token. `verified` is Healthy360's JSON email-verification guard.
|
| `db.context` publishes the authenticated identity to the PostgreSQL session
| variables the row-level security policies read, and resets them once the
| response has been sent (plan §11, ADR-0007).
|
*/

Route::middleware(['auth:sanctum', 'db.context', 'device.touch'])->group(function (): void {
    // Deliberately reachable before email verification: the client needs
    // this payload to render the "verify your email" state.
    Route::get('/me', MeController::class)->name('me.show');
    Route::get('/me/memberships', MembershipController::class)->name('me.memberships');

    Route::middleware('verified')->group(function (): void {
        Route::put('/me/context', ContextController::class)->name('me.context.update');

        Route::get('/me/devices', [DeviceController::class, 'index'])->name('me.devices.index');

        // Step-up: cutting off a stolen phone must not be possible from a
        // hijacked session (plan §13 — 403 auth.step_up_required).
        Route::delete('/me/devices/{device}', [DeviceController::class, 'destroy'])
            ->middleware('step-up')
            ->name('me.devices.destroy');

        // The organisation-scoped probe of the vertical slice: headers,
        // membership and permission proven end to end.
        Route::get('/organisations/current', CurrentOrganisationController::class)
            ->middleware(['org.context', 'branch.context', 'permission:organisation.view_current'])
            ->name('organisations.current');

        /*
        |------------------------------------------------------------------
        | Kitchen catalogue — ingredients & allergen mappings (K1.1)
        |------------------------------------------------------------------
        |
        | Organisation-scoped, not branch-scoped: an ingredient master is
        | owned by the kitchen, not by one of its branches.
        |
        | Reads return the caller's own rows *and* the platform library;
        | writes touch the caller's own rows only. A tenant that tries to
        | edit a platform row is refused with authz.permission_denied and
        | reason policy_denied — never a 404, because it can see the row.
        |
        | `precondition` guards the writes on `ingredients`, the one resource
        | here that carries `lock_version` (master plan v2 §4.13).
        |
        */
        Route::middleware('org.context')->prefix('/catalogue')->group(function (): void {
            Route::middleware('permission:catalogue.view_organisation')->group(function (): void {
                Route::get('/ingredients', IngredientIndexController::class)->name('catalogue.ingredients.index');
                Route::get('/ingredients/{ingredient}', IngredientShowController::class)->name('catalogue.ingredients.show');
                Route::get('/ingredients/{ingredient}/allergens', IngredientAllergenIndexController::class)->name('catalogue.ingredients.allergens.index');
                Route::get('/ingredients/{ingredient}/aliases', IngredientAliasIndexController::class)->name('catalogue.ingredients.aliases.index');
                Route::get('/ingredient-categories', IngredientCategoryIndexController::class)->name('catalogue.ingredient-categories.index');
            });

            Route::middleware('permission:catalogue.manage_organisation')->group(function (): void {
                Route::post('/ingredients', IngredientStoreController::class)->name('catalogue.ingredients.store');

                Route::patch('/ingredients/{ingredient}', IngredientUpdateController::class)
                    ->middleware('precondition')
                    ->name('catalogue.ingredients.update');

                Route::post('/ingredients/{ingredient}/archive', IngredientArchiveController::class)
                    ->middleware('precondition')
                    ->name('catalogue.ingredients.archive');

                Route::put('/ingredients/{ingredient}/allergens', IngredientAllergenReplaceController::class)->name('catalogue.ingredients.allergens.replace');

                Route::post('/ingredients/{ingredient}/aliases', IngredientAliasStoreController::class)->name('catalogue.ingredients.aliases.store');
                Route::delete('/ingredients/{ingredient}/aliases/{alias}', IngredientAliasDestroyController::class)->name('catalogue.ingredients.aliases.destroy');

                Route::post('/ingredient-categories', IngredientCategoryStoreController::class)->name('catalogue.ingredient-categories.store');
                Route::patch('/ingredient-categories/{category}', IngredientCategoryUpdateController::class)->name('catalogue.ingredient-categories.update');
            });

            /*
            |--------------------------------------------------------------
            | Recipes & versions (K1.2)
            |--------------------------------------------------------------
            |
            | Three permissions, not two. `recipe.view_organisation` and
            | `recipe.manage_organisation` are the familiar pair; publication
            | has its own, because freezing an allergen label that reaches a
            | diner and withdrawing whatever was live before is a different
            | authority from editing a draft. A chef holds manage; deciding
            | what the kitchen sells is somebody else's decision.
            |
            | `precondition` guards every write to a lock-versioned resource.
            | On the version sub-resources — lines, outputs, steps — the
            | validator is the **version's**, because the set is the unit of
            | change and a per-row validator would let two editors replace
            | different halves of one formulation.
            |
            | Publish and retire are POST sub-resource actions, never a
            | `PATCH status` (master plan v2 §4.15).
            |
            */
            Route::middleware('permission:recipe.view_organisation')->group(function (): void {
                Route::get('/recipes', RecipeIndexController::class)->name('catalogue.recipes.index');
                Route::get('/recipes/{recipe}', RecipeShowController::class)->name('catalogue.recipes.show');
                Route::get('/recipes/{recipe}/versions', RecipeVersionIndexController::class)->name('catalogue.recipes.versions.index');
                Route::get('/recipes/{recipe}/versions/{version}', RecipeVersionShowController::class)->name('catalogue.recipes.versions.show');
                Route::get('/recipes/{recipe}/versions/{version}/allergens', RecipeVersionAllergenIndexController::class)->name('catalogue.recipes.versions.allergens.index');

                // K1.8. A read of the publish gate, behind the *read*
                // permission on purpose: the chef who has to fix a formulation
                // must be able to see what is wrong with it, and guarding the
                // diagnosis behind the authority to publish would leave the
                // only person who can see the problem unable to fix it.
                Route::get('/recipes/{recipe}/versions/{version}/readiness', RecipeVersionReadinessController::class)->name('catalogue.recipes.versions.readiness');
            });

            Route::middleware('permission:recipe.manage_organisation')->group(function (): void {
                Route::post('/recipes', RecipeStoreController::class)->name('catalogue.recipes.store');

                Route::patch('/recipes/{recipe}', RecipeUpdateController::class)
                    ->middleware('precondition')
                    ->name('catalogue.recipes.update');

                Route::post('/recipes/{recipe}/archive', RecipeArchiveController::class)
                    ->middleware('precondition')
                    ->name('catalogue.recipes.archive');

                Route::post('/recipes/{recipe}/versions', RecipeVersionStoreController::class)->name('catalogue.recipes.versions.store');

                Route::patch('/recipes/{recipe}/versions/{version}', RecipeVersionUpdateController::class)
                    ->middleware('precondition')
                    ->name('catalogue.recipes.versions.update');

                Route::put('/recipes/{recipe}/versions/{version}/lines', RecipeLineReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.recipes.versions.lines.replace');

                Route::put('/recipes/{recipe}/versions/{version}/outputs', RecipeOutputReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.recipes.versions.outputs.replace');

                Route::put('/recipes/{recipe}/versions/{version}/steps', RecipeStepReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.recipes.versions.steps.replace');
            });

            Route::middleware('permission:recipe.publish_organisation')->group(function (): void {
                Route::post('/recipes/{recipe}/versions/{version}/publish', RecipeVersionPublishController::class)
                    ->middleware('precondition')
                    ->name('catalogue.recipes.versions.publish');

                Route::post('/recipes/{recipe}/versions/{version}/retire', RecipeVersionRetireController::class)
                    ->middleware('precondition')
                    ->name('catalogue.recipes.versions.retire');
            });

            /*
            |--------------------------------------------------------------
            | Recipe costs (K1.3)
            |--------------------------------------------------------------
            |
            | A fourth recipe permission, and the only one that is about
            | money. `recipe.view_organisation` gets a line cook the method
            | and the allergen label — everything needed to make the dish —
            | while `recipe.view_costs_organisation` is what it takes to see
            | what the dish costs (appendix C). Nothing here is reachable
            | with the ordinary recipe read permission, and nothing outside
            | here serialises a cost.
            |
            | The POST stacks **both** codes: writing is
            | `recipe.manage_organisation`, and what it writes is money.
            | Middleware groups compose, so the inner declaration is an
            | additional gate rather than a replacement.
            |
            | No `precondition` on the POST: a snapshot appends to a ledger
            | beside the version rather than mutating it, so there is no lost
            | update for an `If-Match` to prevent.
            |
            */
            Route::middleware('permission:recipe.view_costs_organisation')->group(function (): void {
                Route::get('/recipes/{recipe}/versions/{version}/technical-sheet', RecipeTechnicalSheetController::class)
                    ->name('catalogue.recipes.versions.technical-sheet');

                Route::get('/recipes/{recipe}/versions/{version}/cost-snapshots', RecipeCostSnapshotIndexController::class)
                    ->name('catalogue.recipes.versions.cost-snapshots.index');

                Route::post('/recipes/{recipe}/versions/{version}/cost-snapshots', RecipeCostSnapshotStoreController::class)
                    ->middleware('permission:recipe.manage_organisation')
                    ->name('catalogue.recipes.versions.cost-snapshots.store');
            });

            /*
            |--------------------------------------------------------------
            | Sellable catalogue — items, variants and channels (K1.4)
            |--------------------------------------------------------------
            |
            | Reads and edits reuse the K1.1 catalogue pair: ingredients,
            | categories and items are one catalogue, and a fifth pair of
            | codes over the same screens would be bookkeeping rather than
            | authority. Publication is the exception —
            | `catalogue.publish_organisation` is the authority to decide
            | what a customer can buy, held by the kitchen manager and the
            | commercial manager and by neither the chef nor the staff.
            |
            | `precondition` guards every write to a lock-versioned
            | resource. On the item sub-resources — variants, ingredients,
            | diet tags, channels — the validator is the **item's**, because
            | each set is the unit of change and a per-row validator would
            | let two editors replace different halves of one listing.
            |
            | `{item}` and `{channel}` accept an identifier or the row's own
            | stable key (slug, code): a client that walked the list holds
            | one, a marketplace integration or a human holds the other.
            |
            | The allergen endpoint has no writer, deliberately. An item's
            | allergens are derived — from a published recipe version's
            | frozen label, or from the item's own ingredient list — and an
            | endpoint that let a merchandiser type one in would be an
            | endpoint that lets a merchandiser overrule a chef.
            |
            */
            Route::middleware('permission:catalogue.view_organisation')->group(function (): void {
                Route::get('/sales-channels', SalesChannelIndexController::class)->name('catalogue.sales-channels.index');
                Route::get('/sales-channels/{channel}', SalesChannelShowController::class)->name('catalogue.sales-channels.show');

                Route::get('/items', CatalogueItemIndexController::class)->name('catalogue.items.index');
                Route::get('/items/{item}', CatalogueItemShowController::class)->name('catalogue.items.show');
                Route::get('/items/{item}/allergens', CatalogueItemAllergenIndexController::class)->name('catalogue.items.allergens.index');

                // K1.8, and the same argument as its recipe twin: whoever has
                // to complete a listing must be able to see what it is still
                // missing, which is the read permission's business rather than
                // the publisher's.
                Route::get('/items/{item}/readiness', CatalogueItemReadinessController::class)->name('catalogue.items.readiness');
            });

            Route::middleware('permission:catalogue.manage_organisation')->group(function (): void {
                Route::post('/sales-channels', SalesChannelStoreController::class)->name('catalogue.sales-channels.store');

                Route::patch('/sales-channels/{channel}', SalesChannelUpdateController::class)
                    ->middleware('precondition')
                    ->name('catalogue.sales-channels.update');

                Route::post('/items', CatalogueItemStoreController::class)->name('catalogue.items.store');

                Route::patch('/items/{item}', CatalogueItemUpdateController::class)
                    ->middleware('precondition')
                    ->name('catalogue.items.update');

                Route::put('/items/{item}/variants', CatalogueItemVariantReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.items.variants.replace');

                Route::put('/items/{item}/ingredients', CatalogueItemIngredientReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.items.ingredients.replace');

                Route::put('/items/{item}/diet-classifications', CatalogueItemDietClassificationReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.items.diet-classifications.replace');

                Route::put('/items/{item}/channels', CatalogueItemChannelReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.items.channels.replace');
            });

            Route::middleware('permission:catalogue.publish_organisation')->group(function (): void {
                Route::post('/items/{item}/publish', CatalogueItemPublishController::class)
                    ->middleware('precondition')
                    ->name('catalogue.items.publish');

                Route::post('/items/{item}/retire', CatalogueItemRetireController::class)
                    ->middleware('precondition')
                    ->name('catalogue.items.retire');
            });

            /*
            |--------------------------------------------------------------
            | Pricing — lists, entries and channel assignments (K1.5)
            |--------------------------------------------------------------
            |
            | The one kitchen family with **its own permission pair**. Every
            | other surface here reuses `catalogue.view_organisation` /
            | `catalogue.manage_organisation`, because ingredients, recipes
            | and listings are one catalogue and a second pair of codes over
            | the same screens would be bookkeeping. Prices are different:
            | price visibility is commercial, not culinary. A chef writes
            | formulations and a kitchen hand reads them; neither needs to
            | know what the dish sells for, and on an `agreement` list the
            | number is one customer's negotiated position. Folding it into
            | `catalogue.view_organisation` would have handed the most
            | commercially sensitive figure in the system to everybody who
            | can read an ingredient — and quietly undone K1.3's cost split,
            | since a margin is reconstructable from a cost and a price.
            |
            | Activation and archiving reuse `catalogue.publish_organisation`
            | rather than adding a third publish code: deciding that a tariff
            | goes live is the same authority as deciding what is on sale,
            | held by the same two roles.
            |
            | `precondition` guards every write, and on the sub-resources the
            | validator is the **list's**. A tariff's rows are one document
            | even though they live in three tables: two merchandisers
            | repricing at once is the race this catches, and per-row
            | validators would let both succeed and leave a tariff that is
            | half of each.
            |
            | `{priceList}` accepts an identifier or the list's `code`.
            |
            | There is no DELETE anywhere in this family, and there never
            | will be. A price is evidence of what a customer was charged;
            | withdrawing one closes its interval, and withdrawing a tariff
            | detaches it from its channels and archives it. Nothing is
            | erased, because an order taken last March has to stay
            | explainable.
            |
            */
            Route::middleware('permission:price_list.view_organisation')->group(function (): void {
                Route::get('/price-lists', PriceListIndexController::class)->name('catalogue.price-lists.index');
                Route::get('/price-lists/{priceList}', PriceListShowController::class)->name('catalogue.price-lists.show');
                Route::get('/price-lists/{priceList}/entries', PriceListEntryIndexController::class)->name('catalogue.price-lists.entries.index');
            });

            Route::middleware('permission:price_list.manage_organisation')->group(function (): void {
                Route::post('/price-lists', PriceListStoreController::class)->name('catalogue.price-lists.store');

                Route::patch('/price-lists/{priceList}', PriceListUpdateController::class)
                    ->middleware('precondition')
                    ->name('catalogue.price-lists.update');

                Route::put('/price-lists/{priceList}/entries', PriceListEntryReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.price-lists.entries.replace');

                Route::put('/price-lists/{priceList}/channels', PriceListChannelReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.price-lists.channels.replace');
            });

            Route::middleware('permission:catalogue.publish_organisation')->group(function (): void {
                Route::post('/price-lists/{priceList}/publish', PriceListPublishController::class)
                    ->middleware('precondition')
                    ->name('catalogue.price-lists.publish');

                Route::post('/price-lists/{priceList}/archive', PriceListArchiveController::class)
                    ->middleware('precondition')
                    ->name('catalogue.price-lists.archive');
            });

            /*
            |--------------------------------------------------------------
            | Commercial plan definitions (K1.6)
            |--------------------------------------------------------------
            |
            | A third permission domain, `plan.*`, on the K1.5 argument taken
            | one step further: a subscription is a **commercial instrument**
            | before it is a menu. Its profile decides how late a subscriber
            | may change a delivery and whether they may pause at all; its
            | matrix decides what a recurring charge is levied for; its
            | durations carry the discounts a longer commitment earns. Those
            | are the commercial manager's decisions, and folding them into
            | `catalogue.manage_organisation` would have handed them to
            | everybody who can rename a product.
            |
            | There is deliberately **no `plan.view_organisation`**. Reading a
            | plan's configuration is reading the catalogue — a chef needs to
            | know the kitchen produces two lunches a day for the premium tier
            | — and a read code no screen could sensibly withhold would be
            | bookkeeping rather than authority. What is genuinely commercial
            | is the *discount*, and it sits behind
            | `plan.manage_organisation` along with the writes.
            |
            | The vocabulary PATCHes are **precondition-free**: these rows
            | carry no `lock_version` (appendix D), and the concurrency
            | contract applies only to resources that do. The plan
            | sub-resources all take `If-Match` carrying the **item's**
            | validator, because a profile, a matrix and a set of duration
            | assignments are three faces of one listing.
            |
            | `{item}` accepts an identifier or the plan's slug, and a
            | catalogue item that is not a subscription plan is a `422` rather
            | than a `404`: the caller can see the row perfectly well through
            | `/catalogue/items/{item}`, and a 404 would send them hunting for
            | a typo.
            |
            | Publication is **not** here. It stays
            | `POST /catalogue/items/{item}/publish` — one action, one URL, one
            | audit trail — and `plan.publish_organisation` is checked inside
            | the action service, which is the only layer that has loaded the
            | row and can therefore know it is a plan.
            |
            | There is no DELETE anywhere in this family. Vocabulary rows
            | deactivate, matrix cells archive, and both because a price row
            | and eventually an order point at what they describe.
            |
            */
            Route::middleware('permission:plan.manage_organisation')->group(function (): void {
                Route::get('/plan-vocabulary/combinations', PlanCombinationIndexController::class)->name('catalogue.plan-vocabulary.combinations.index');
                Route::post('/plan-vocabulary/combinations', PlanCombinationStoreController::class)->name('catalogue.plan-vocabulary.combinations.store');
                Route::patch('/plan-vocabulary/combinations/{combination}', PlanCombinationUpdateController::class)->name('catalogue.plan-vocabulary.combinations.update');

                Route::get('/plan-vocabulary/energy-bands', PlanEnergyBandIndexController::class)->name('catalogue.plan-vocabulary.energy-bands.index');
                Route::post('/plan-vocabulary/energy-bands', PlanEnergyBandStoreController::class)->name('catalogue.plan-vocabulary.energy-bands.store');
                Route::patch('/plan-vocabulary/energy-bands/{band}', PlanEnergyBandUpdateController::class)->name('catalogue.plan-vocabulary.energy-bands.update');

                Route::get('/plan-vocabulary/durations', PlanDurationIndexController::class)->name('catalogue.plan-vocabulary.durations.index');
                Route::post('/plan-vocabulary/durations', PlanDurationStoreController::class)->name('catalogue.plan-vocabulary.durations.store');
                Route::patch('/plan-vocabulary/durations/{duration}', PlanDurationUpdateController::class)->name('catalogue.plan-vocabulary.durations.update');

                Route::put('/plans/{item}/profile', PlanProfileUpdateController::class)
                    ->middleware('precondition')
                    ->name('catalogue.plans.profile.update');

                Route::get('/plans/{item}/variants', PlanVariantIndexController::class)->name('catalogue.plans.variants.index');

                Route::put('/plans/{item}/variants', PlanVariantReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.plans.variants.replace');

                Route::get('/plans/{item}/variant-durations', PlanVariantDurationIndexController::class)->name('catalogue.plans.variant-durations.index');

                Route::put('/plans/{item}/variant-durations', PlanVariantDurationReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.plans.variant-durations.replace');
            });

            /*
            | The one plan read that is **not** commercial. A plan's terms —
            | how it is sold, on what basis it is priced, whether a subscriber
            | may skip or pause, and how late a delivery may be changed — are
            | what a customer will be shown on the plan page in M1, and what a
            | chef needs to know to produce against. So the read sits with the
            | rest of the catalogue rather than behind
            | `plan.manage_organisation`, which every holder of also holds.
            |
            | The discounts do not, and that is the whole boundary: they live
            | on `…/variant-durations` above.
            */
            Route::middleware('permission:catalogue.view_organisation')->group(function (): void {
                Route::get('/plans/{item}/profile', PlanProfileShowController::class)->name('catalogue.plans.profile.show');
            });

            /*
            |--------------------------------------------------------------
            | Delivery configuration — zones, areas and windows (K1.7)
            |--------------------------------------------------------------
            |
            | A fourth permission domain, `delivery_zone.*`, and **one code
            | rather than a pair**. The K1.6 argument decides it: there is no
            | screen that could sensibly show a kitchen where it delivers while
            | withholding the ability to change it, and a read code no screen
            | could withhold is bookkeeping rather than authority.
            |
            | Its own domain rather than more `catalogue.*` because where a
            | kitchen delivers, what it charges to get there and what it will
            | not go below are decisions about *logistics*. A merchandiser who
            | can rename a product has no business redrawing the delivery map.
            | Held by the kitchen manager and the commercial manager — the fee
            | and the minimum order are prices, which is the commercial role's
            | whole job — and by neither the chef nor kitchen staff.
            |
            | **Windows ride the same code.** When the van goes is the same
            | kind of decision as where it goes, and a second code for the
            | other half of one screen would be ceremony.
            |
            | `precondition` guards the zone writes, and on `…/areas` the
            | validator is the **zone's**: a zone and its map are one document,
            | and two operators redrawing at once is the race it catches. The
            | window PATCH is precondition-free because those rows carry no
            | `lock_version` — the rule the K1.6 vocabularies follow.
            |
            | `{zone}` and `{window}` accept an identifier or the row's own
            | `code`: a client that walked the list holds one, an operator or
            | an importer holds the other.
            |
            | There is no DELETE anywhere in this family. A zone archives —
            | releasing its area claims — and a window deactivates, because an
            | order taken for the evening slot has to stay explainable.
            |
            */
            Route::middleware('permission:delivery_zone.manage_organisation')->group(function (): void {
                Route::get('/delivery-zones', DeliveryZoneIndexController::class)->name('catalogue.delivery-zones.index');
                Route::post('/delivery-zones', DeliveryZoneStoreController::class)->name('catalogue.delivery-zones.store');
                Route::get('/delivery-zones/{zone}', DeliveryZoneShowController::class)->name('catalogue.delivery-zones.show');

                Route::patch('/delivery-zones/{zone}', DeliveryZoneUpdateController::class)
                    ->middleware('precondition')
                    ->name('catalogue.delivery-zones.update');

                Route::post('/delivery-zones/{zone}/archive', DeliveryZoneArchiveController::class)
                    ->middleware('precondition')
                    ->name('catalogue.delivery-zones.archive');

                Route::get('/delivery-zones/{zone}/areas', DeliveryZoneAreaIndexController::class)->name('catalogue.delivery-zones.areas.index');

                Route::put('/delivery-zones/{zone}/areas', DeliveryZoneAreaReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.delivery-zones.areas.replace');

                Route::get('/delivery-windows', DeliveryWindowIndexController::class)->name('catalogue.delivery-windows.index');
                Route::post('/delivery-windows', DeliveryWindowStoreController::class)->name('catalogue.delivery-windows.store');
                Route::patch('/delivery-windows/{window}', DeliveryWindowUpdateController::class)->name('catalogue.delivery-windows.update');
            });
        });

        /*
        |------------------------------------------------------------------
        | Kitchen operating data (K1.7)
        |------------------------------------------------------------------
        |
        | The one family in the kitchen programme that is **branch-scoped**.
        | Opening hours are a fact about a place, so `branch.context` is
        | required rather than optional here, and the branch comes from
        | `X-Branch-Id` — never from the body, which would be a second and
        | unvalidated way to name a branch. The middleware permits an absent
        | header (an organisation-wide membership may select no branch), so the
        | service refuses that case explicitly with
        | `400 context.branch_required` rather than guessing.
        |
        | The permissions are the **foundation `branch.*` pair**, not a new
        | code. When a branch is open is a fact about the branch, and
        | `branch.view_current` / `branch.manage_current` already exist for
        | exactly that subject — a branch manager who can open and close a
        | branch can plainly state when it trades. K1.7 adds
        | `branch.manage_current` to the kitchen-manager template, which
        | previously held only the read.
        |
        | No `If-Match`: the week is replaced whole in one transaction, so
        | there is no half-week for a validator to protect and the rows carry
        | no `lock_version`.
        |
        */
        Route::middleware(['org.context', 'branch.context'])->prefix('/kitchen')->group(function (): void {
            Route::get('/branch-operating', BranchOperatingShowController::class)
                ->middleware('permission:branch.view_current')
                ->name('kitchen.branch-operating.show');

            Route::put('/branch-operating', BranchOperatingReplaceController::class)
                ->middleware('permission:branch.manage_current')
                ->name('kitchen.branch-operating.replace');
        });

        /*
        |------------------------------------------------------------------
        | Platform reference governance (K1.1)
        |------------------------------------------------------------------
        |
        | Two gates, not one. `platform.context` asserts the selected
        | organisation is the platform operator; `permission` asserts the
        | member holds the platform code. A tenant that somehow acquired the
        | permission still cannot reach these routes, because the
        | organisation type is not something a tenant can grant itself.
        |
        | There is no DELETE: allergen classes are deactivated, never
        | removed (master plan v2 §4.6).
        |
        */
        Route::middleware(['org.context', 'platform.context', 'permission:reference.manage_platform'])
            ->prefix('/reference')
            ->group(function (): void {
                Route::post('/allergen-classes', AllergenClassStoreController::class)->name('reference.allergen-classes.store');
                Route::patch('/allergen-classes/{code}', AllergenClassUpdateController::class)->name('reference.allergen-classes.update');
                Route::post('/allergen-classes/{code}/deactivate', AllergenClassDeactivateController::class)->name('reference.allergen-classes.deactivate');
            });
    });
});

/*
|--------------------------------------------------------------------------
| Public reference data
|--------------------------------------------------------------------------
|
| Anonymous by design: an allergy filter that only works after sign-in is not
| an allergy filter. Rate limiting is the `api` group's (60/min, keyed by IP
| for an anonymous caller), applied by bootstrap/app.php's throttleApi().
|
| Served through the public projection — one server-localised name, chosen
| from Accept-Language, never both language columns (master plan v2 §4.8).
|
*/
Route::get('/reference/allergen-classes', PublicAllergenClassIndexController::class)
    ->name('reference.allergen-classes.index');

// Anonymous for the same reason (K1.4): a diet filter that only works after
// sign-in is not a diet filter. A classification is a preference, never a
// medical restriction — what a dish contains is the allergen list above.
Route::get('/reference/diet-classifications', PublicDietClassificationIndexController::class)
    ->name('reference.diet-classifications.index');

// Anonymous for a sharper version of the same reason (K1.7): J1's onboarding
// asks a customer for their delivery area *before* an account exists, so an
// address form that only works after sign-in cannot be part of sign-up.
//
// The one public list here that is **cursor-paginated**. Fourteen allergen
// classes and twelve diet classifications are constants; the gazetteer is 125
// rows for one country and grows with every market. `country_code` is required
// — area codes are unique within a country, not across the platform.
Route::get('/reference/delivery-areas', PublicDeliveryAreaIndexController::class)
    ->name('reference.delivery-areas.index');
