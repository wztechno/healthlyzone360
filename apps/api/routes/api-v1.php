<?php

declare(strict_types=1);

use Healthy360\Allergens\Http\Controllers\AllergenClassDeactivateController;
use Healthy360\Allergens\Http\Controllers\AllergenClassStoreController;
use Healthy360\Allergens\Http\Controllers\AllergenClassUpdateController;
use Healthy360\Allergens\Http\Controllers\PublicAllergenClassIndexController;
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
use Healthy360\Organisations\Http\Controllers\CurrentOrganisationController;
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
