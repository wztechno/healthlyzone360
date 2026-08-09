<?php

declare(strict_types=1);

use Healthy360\Allergens\Http\Controllers\AllergenClassDeactivateController;
use Healthy360\Allergens\Http\Controllers\AllergenClassStoreController;
use Healthy360\Allergens\Http\Controllers\AllergenClassUpdateController;
use Healthy360\Allergens\Http\Controllers\PublicAllergenClassIndexController;
use Healthy360\B2b\Http\Controllers\B2bAgreementIndexController;
use Healthy360\B2b\Http\Controllers\B2bAgreementShowController;
use Healthy360\B2b\Http\Controllers\B2bAgreementSignatureChallengeController;
use Healthy360\B2b\Http\Controllers\B2bAgreementSignController;
use Healthy360\B2b\Http\Controllers\B2bApplicationContactReplaceController;
use Healthy360\B2b\Http\Controllers\B2bApplicationIndexController;
use Healthy360\B2b\Http\Controllers\B2bApplicationLocationReplaceController;
use Healthy360\B2b\Http\Controllers\B2bApplicationSectionUpdateController;
use Healthy360\B2b\Http\Controllers\B2bApplicationShowController;
use Healthy360\B2b\Http\Controllers\B2bApplicationStoreController;
use Healthy360\B2b\Http\Controllers\B2bApplicationSubmitController;
use Healthy360\B2b\Http\Controllers\B2bApplicationWithdrawController;
use Healthy360\B2b\Http\Controllers\B2bCatalogueItemIndexController;
use Healthy360\B2b\Http\Controllers\B2bCatalogueItemShowController;
use Healthy360\B2b\Http\Controllers\CorporateProgrammeIndexController;
use Healthy360\B2b\Http\Controllers\CorporateProgrammeShowController;
use Healthy360\B2b\Http\Controllers\InvitationAcceptController;
use Healthy360\B2b\Http\Controllers\InvitationShowController;
use Healthy360\B2b\Http\Controllers\KitchenQuotationIndexController;
use Healthy360\B2b\Http\Controllers\KitchenQuotationQuoteController;
use Healthy360\B2b\Http\Controllers\KitchenQuotationShowController;
use Healthy360\B2b\Http\Controllers\KycDocumentDownloadController;
use Healthy360\B2b\Http\Controllers\KycDocumentIndexController;
use Healthy360\B2b\Http\Controllers\KycDocumentStoreController;
use Healthy360\B2b\Http\Controllers\OffboardingArchiveController;
use Healthy360\B2b\Http\Controllers\OffboardingCancelController;
use Healthy360\B2b\Http\Controllers\OffboardingRevokeAccessController;
use Healthy360\B2b\Http\Controllers\OffboardingSettlementCheckController;
use Healthy360\B2b\Http\Controllers\OffboardingSettlementWaiverController;
use Healthy360\B2b\Http\Controllers\OffboardingShowController;
use Healthy360\B2b\Http\Controllers\OffboardingSignoffChallengeController;
use Healthy360\B2b\Http\Controllers\OffboardingSignoffController;
use Healthy360\B2b\Http\Controllers\OffboardingStoreController;
use Healthy360\B2b\Http\Controllers\OrganisationInvitationIndexController;
use Healthy360\B2b\Http\Controllers\OrganisationInvitationRevokeController;
use Healthy360\B2b\Http\Controllers\OrganisationInvitationStoreController;
use Healthy360\B2b\Http\Controllers\PlatformB2bApplicationApproveController;
use Healthy360\B2b\Http\Controllers\PlatformB2bApplicationClaimController;
use Healthy360\B2b\Http\Controllers\PlatformB2bApplicationDeclineController;
use Healthy360\B2b\Http\Controllers\PlatformB2bApplicationIndexController;
use Healthy360\B2b\Http\Controllers\PlatformB2bApplicationProvisionController;
use Healthy360\B2b\Http\Controllers\PlatformB2bApplicationRequestInformationController;
use Healthy360\B2b\Http\Controllers\PlatformB2bApplicationShowController;
use Healthy360\B2b\Http\Controllers\PlatformKycDocumentDownloadController;
use Healthy360\B2b\Http\Controllers\PlatformKycDocumentReviewController;
use Healthy360\B2b\Http\Controllers\QuotationAcceptController;
use Healthy360\B2b\Http\Controllers\QuotationDeclineController;
use Healthy360\B2b\Http\Controllers\QuotationIndexController;
use Healthy360\B2b\Http\Controllers\QuotationShowController;
use Healthy360\B2b\Http\Controllers\QuotationStoreController;
use Healthy360\B2b\Http\Controllers\QuotationSubmitController;
use Healthy360\B2b\Http\Controllers\QuotationUpdateController;
use Healthy360\B2b\Http\Controllers\RecordExportShowController;
use Healthy360\B2b\Http\Controllers\RecordExportStoreController;
use Healthy360\Cart\Http\Controllers\CartItemDestroyController;
use Healthy360\Cart\Http\Controllers\CartItemStoreController;
use Healthy360\Cart\Http\Controllers\CartItemUpdateController;
use Healthy360\Cart\Http\Controllers\CartStoreController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemAllergenIndexController;
use Healthy360\Catalogues\Http\Controllers\CatalogueItemAvailabilityReplaceController;
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
use Healthy360\Customers\Closure\Http\Controllers\ClosureRequestCancelController;
use Healthy360\Customers\Closure\Http\Controllers\ClosureRequestLiveController;
use Healthy360\Customers\Closure\Http\Controllers\ClosureRequestStoreController;
use Healthy360\Customers\Closure\Http\Controllers\ClosureRequestVerifyController;
use Healthy360\Customers\Closure\Http\Controllers\PlatformClosureRequestStoreController;
use Healthy360\Customers\Guest\Http\Controllers\GuestContactStoreController;
use Healthy360\Customers\Guest\Http\Controllers\GuestContactVerifyController;
use Healthy360\Customers\Guest\Http\Controllers\GuestConvertController;
use Healthy360\Customers\Guest\Http\Controllers\GuestDeletionRequestStoreController;
use Healthy360\Customers\Guest\Http\Controllers\GuestDeletionVerifyController;
use Healthy360\Customers\Guest\Http\Controllers\GuestSessionShowController;
use Healthy360\Customers\Guest\Http\Controllers\GuestSessionStoreController;
use Healthy360\Customers\Http\Controllers\AddressDefaultController;
use Healthy360\Customers\Http\Controllers\AddressDestroyController;
use Healthy360\Customers\Http\Controllers\AddressIndexController;
use Healthy360\Customers\Http\Controllers\AddressStoreController;
use Healthy360\Customers\Http\Controllers\AddressUpdateController;
use Healthy360\Customers\Http\Controllers\ConsentDestroyController;
use Healthy360\Customers\Http\Controllers\ConsentIndexController;
use Healthy360\Customers\Http\Controllers\ConsentStoreController;
use Healthy360\Customers\Http\Controllers\ContactDestroyController;
use Healthy360\Customers\Http\Controllers\ContactIndexController;
use Healthy360\Customers\Http\Controllers\ContactPrimaryController;
use Healthy360\Customers\Http\Controllers\ContactStoreController;
use Healthy360\Customers\Http\Controllers\CustomerAccountShowController;
use Healthy360\Customers\Http\Controllers\CustomerAccountStoreController;
use Healthy360\Customers\Http\Controllers\DietaryProfileReplaceController;
use Healthy360\Customers\Http\Controllers\DietaryProfileShowController;
use Healthy360\Delivery\Http\Controllers\DeliveryJobIndexController;
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
use Healthy360\Delivery\Http\Controllers\DriverJobDeliverController;
use Healthy360\Delivery\Http\Controllers\DriverJobIndexController;
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
use Healthy360\Inventory\Http\Controllers\StockAdjustController;
use Healthy360\Inventory\Http\Controllers\StockItemIndexController;
use Healthy360\Inventory\Http\Controllers\StockItemStoreController;
use Healthy360\Inventory\Http\Controllers\StockLevelIndexController;
use Healthy360\Inventory\Http\Controllers\StockLowStockCountController;
use Healthy360\Inventory\Http\Controllers\StockThresholdController;
use Healthy360\Inventory\Http\Controllers\StockWasteController;
use Healthy360\KitchenDisplay\Http\Controllers\KdsTicketBumpController;
use Healthy360\KitchenDisplay\Http\Controllers\KdsTicketIndexController;
use Healthy360\Kitchens\Http\Controllers\BranchOperatingReplaceController;
use Healthy360\Kitchens\Http\Controllers\BranchOperatingShowController;
use Healthy360\Kitchens\Http\Controllers\PublicKitchenIndexController;
use Healthy360\Kitchens\Http\Controllers\PublicKitchenShowController;
use Healthy360\Kitchens\Http\Controllers\PublicMealIndexController;
use Healthy360\Kitchens\Http\Controllers\PublicMealPlanIndexController;
use Healthy360\Kitchens\Http\Controllers\PublicMealPlanShowController;
use Healthy360\Kitchens\Http\Controllers\PublicMealShowController;
use Healthy360\Orders\Http\Controllers\CheckoutPreviewController;
use Healthy360\Orders\Http\Controllers\GuestOrderShowController;
use Healthy360\Orders\Http\Controllers\GuestOrderStoreController;
use Healthy360\Orders\Http\Controllers\KitchenOrderCancelController;
use Healthy360\Orders\Http\Controllers\KitchenOrderConfirmController;
use Healthy360\Orders\Http\Controllers\KitchenOrderFulfilController;
use Healthy360\Orders\Http\Controllers\KitchenOrderIndexController;
use Healthy360\Orders\Http\Controllers\KitchenOrderShowController;
use Healthy360\Orders\Http\Controllers\MyOrderIndexController;
use Healthy360\Orders\Http\Controllers\MyOrderShowController;
use Healthy360\Orders\Http\Controllers\OrderStoreController;
use Healthy360\Organisations\Http\Controllers\CurrentOrganisationController;
use Healthy360\Payments\Http\Controllers\PaymentIntentCaptureController;
use Healthy360\Payments\Http\Controllers\PaymentIntentStoreController;
use Healthy360\Payments\Http\Controllers\PaymentRefundStoreController;
use Healthy360\PlatformAdministration\Http\Controllers\PlatformKitchenIndexController;
use Healthy360\PlatformAdministration\Http\Controllers\PlatformKitchenOwnerInvitationController;
use Healthy360\PlatformAdministration\Http\Controllers\PlatformKitchenOwnerRevokeController;
use Healthy360\PlatformAdministration\Http\Controllers\PlatformKitchenReactivateController;
use Healthy360\PlatformAdministration\Http\Controllers\PlatformKitchenShowController;
use Healthy360\PlatformAdministration\Http\Controllers\PlatformKitchenStoreController;
use Healthy360\PlatformAdministration\Http\Controllers\PlatformKitchenSuspendController;
use Healthy360\POS\Http\Controllers\PosSaleStoreController;
use Healthy360\Pricing\Http\Controllers\PriceListArchiveController;
use Healthy360\Pricing\Http\Controllers\PriceListChannelReplaceController;
use Healthy360\Pricing\Http\Controllers\PriceListEntryIndexController;
use Healthy360\Pricing\Http\Controllers\PriceListEntryReplaceController;
use Healthy360\Pricing\Http\Controllers\PriceListIndexController;
use Healthy360\Pricing\Http\Controllers\PriceListPublishController;
use Healthy360\Pricing\Http\Controllers\PriceListShowController;
use Healthy360\Pricing\Http\Controllers\PriceListStoreController;
use Healthy360\Pricing\Http\Controllers\PriceListUpdateController;
use Healthy360\Procurement\Http\Controllers\GoodsReceiptIndexController;
use Healthy360\Procurement\Http\Controllers\GoodsReceiptStoreController;
use Healthy360\Procurement\Http\Controllers\MonthlyCostReportController;
use Healthy360\Procurement\Http\Controllers\PurchasesLedgerIndexController;
use Healthy360\Procurement\Http\Controllers\SupplierIndexController;
use Healthy360\Production\Http\Controllers\ProductionOrderCompleteController;
use Healthy360\Production\Http\Controllers\ProductionOrderIndexController;
use Healthy360\Production\Http\Controllers\ProductionOrderStoreController;
use Healthy360\QualityControl\Http\Controllers\QualityCheckHoldController;
use Healthy360\QualityControl\Http\Controllers\QualityCheckIndexController;
use Healthy360\QualityControl\Http\Controllers\QualityCheckReleaseController;
use Healthy360\QualityControl\Http\Controllers\QualityCheckStoreController;
use Healthy360\Recipes\Http\Controllers\RecipeArchiveController;
use Healthy360\Recipes\Http\Controllers\RecipeCostSnapshotIndexController;
use Healthy360\Recipes\Http\Controllers\RecipeCostSnapshotStoreController;
use Healthy360\Recipes\Http\Controllers\RecipeIndexController;
use Healthy360\Recipes\Http\Controllers\RecipeLineReplaceController;
use Healthy360\Recipes\Http\Controllers\RecipeOutputReplaceController;
use Healthy360\Recipes\Http\Controllers\RecipeRollupPreviewController;
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
use Healthy360\Subscriptions\Http\Controllers\KitchenSubscriptionScheduleController;
use Healthy360\Subscriptions\Http\Controllers\MySubscriptionDeliveryIndexController;
use Healthy360\Subscriptions\Http\Controllers\MySubscriptionIndexController;
use Healthy360\Subscriptions\Http\Controllers\MySubscriptionShowController;
use Healthy360\Subscriptions\Http\Controllers\SubscriptionAddressUpdateController;
use Healthy360\Subscriptions\Http\Controllers\SubscriptionCancelController;
use Healthy360\Subscriptions\Http\Controllers\SubscriptionChoiceReplaceController;
use Healthy360\Subscriptions\Http\Controllers\SubscriptionPauseController;
use Healthy360\Subscriptions\Http\Controllers\SubscriptionQuoteController;
use Healthy360\Subscriptions\Http\Controllers\SubscriptionResumeController;
use Healthy360\Subscriptions\Http\Controllers\SubscriptionSkipStoreController;
use Healthy360\Subscriptions\Http\Controllers\SubscriptionStoreController;
use Healthy360\Subscriptions\Http\Controllers\SubscriptionWeekdaysUpdateController;
use Healthy360\Subscriptions\Http\Controllers\SubscriptionWindowUpdateController;
use Healthy360\Verification\Http\Controllers\ChallengeResendController;
use Healthy360\Verification\Http\Controllers\ChallengeShowController;
use Healthy360\Verification\Http\Controllers\ChallengeVerifyController;
use Healthy360\Verification\Http\Controllers\EmailChallengeStoreController;
use Healthy360\Verification\Http\Controllers\EmailVerifyController;
use Healthy360\Verification\Http\Controllers\StepUpChallengeStoreController;
use Healthy360\Verification\Http\Controllers\StepUpConfirmController;
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

    // ============================================================================
    // BLOCK A — reachable before the email is verified
    // ============================================================================
    //
    // Middleware: auth:sanctum, db.context, device.touch (from the enclosing group).
    // Explicitly NOT `verified`.
    //
    // This is the one part of the API where the absence of `verified` is the whole
    // point rather than a concession: a caller behind that gate could never reach
    // the endpoints that make them verified. Everything here operates on the
    // caller's own challenges, and a challenge belonging to somebody else is
    // answered `resource.not_found` rather than 403 — a denial would confirm that a
    // stolen identifier names something real.

    Route::prefix('/verification')->group(function (): void {
        // Issue a passcode to the caller's own login address. No body: an endpoint
        // that accepted a destination would send codes to addresses the caller does
        // not hold, and would answer "does this address have an account here" one
        // attempt at a time.
        Route::post('/email/challenges', EmailChallengeStoreController::class)
            ->name('verification.email.challenges.store');

        // The inline-OTP twin of the signed link (D-036). Finds the caller's live
        // contact-verification challenge itself — there is at most one, by index —
        // and settles both halves of the fact: the contact point and
        // users.email_verified_at, in one transaction.
        Route::post('/email/verify', EmailVerifyController::class)
            ->name('verification.email.verify');

        // Generic challenge surface. Read and resend serve every purpose in the
        // table; verify is the contact-verification meaning, which is why it goes
        // through ContactVerificationService while resend goes through OtpService.
        Route::get('/challenges/{challenge}', ChallengeShowController::class)
            ->name('verification.challenges.show');

        Route::post('/challenges/{challenge}/verify', ChallengeVerifyController::class)
            ->name('verification.challenges.verify');

        Route::post('/challenges/{challenge}/resend', ChallengeResendController::class)
            ->name('verification.challenges.resend');
    });

    Route::middleware('verified')->group(function (): void {
        Route::put('/me/context', ContextController::class)->name('me.context.update');

        Route::get('/me/devices', [DeviceController::class, 'index'])->name('me.devices.index');

        // Step-up: cutting off a stolen phone must not be possible from a
        // hijacked session (plan §13 — 403 auth.step_up_required).
        Route::delete('/me/devices/{device}', [DeviceController::class, 'destroy'])
            ->middleware('step-up')
            ->name('me.devices.destroy');

        /*
        |--------------------------------------------------------------------------
        | Step-up by passcode (J1)
        |--------------------------------------------------------------------------
        |
        | Middleware: auth:sanctum, db.context, device.touch, verified.
        |
        | Behind `verified`, unlike the rest of the verification module, and for the
        | opposite reason: a step-up is sent to a destination the account has already
        | proven, so a caller who has proven nothing has nowhere to receive one. The
        | purpose is confined to those `OtpPurpose::grantsStepUp()` admits — the form
        | request refuses an unlisted one at the door and the confirm endpoint refuses
        | to honour a challenge whose purpose does not grant a step-up, because a code
        | obtained for a harmless purpose must never be replayable against a dangerous
        | one.
        |
        | Confirming stamps the `otp` method that `step-up:otp` reads. It is bound to
        | the calling credential — the token, or the session when there is none — so a
        | confirmation in a browser cannot unlock a sensitive action for a phone
        | holding a stolen token.
        |
        */
        Route::prefix('/verification/step-up')->group(function (): void {
            Route::post('/challenges', StepUpChallengeStoreController::class)
                ->name('verification.step-up.challenges.store');

            Route::post('/confirm', StepUpConfirmController::class)
                ->name('verification.step-up.confirm');
        });

        /*
        |--------------------------------------------------------------------------
        | Customer account and consumer self-service (J1)
        |--------------------------------------------------------------------------
        |
        | Middleware: auth:sanctum, db.context, device.touch, verified.
        |
        | A verified email is the first activation requirement, so gating the whole
        | surface on it costs nothing a caller could otherwise have had — and it keeps
        | the onboarding order honest: prove the address, open the account, then fill
        | it in.
        |
        | There is no account identifier in any path. A consumer surface that took one
        | would need a rule about whose accounts a caller may name, the only correct
        | rule is "their own", and the first bug in that rule would be somebody else's
        | address book. Sub-resources are located by id *and* scoped to the caller's
        | account; anything else is `resource.not_found`.
        |
        | `POST /customer-account` is idempotent and answers 201 the first time, 200
        | every time after. An unmet activation requirement is not an error there: the
        | account comes back with its outstanding list, because onboarding is
        | interruptible by design and a 422 would turn a checklist into a form that must
        | be completed in one sitting.
        |
        */
        Route::get('/customer-account', CustomerAccountShowController::class)
            ->name('customer-account.show');

        Route::post('/customer-account', CustomerAccountStoreController::class)
            ->name('customer-account.store');

        Route::prefix('/me')->group(function (): void {
            Route::get('/contacts', ContactIndexController::class)->name('me.contacts.index');
            Route::post('/contacts', ContactStoreController::class)->name('me.contacts.store');

            // Step-up: changing the primary destination is how an attacker holding a
            // hijacked session redirects the codes that would otherwise stop them. The
            // same class of act as revoking a device, guarded the same way.
            //
            // `step-up` means `step-up:password` — the original behaviour and the
            // default. `step-up:otp` is available and would be the stronger choice once
            // the passcode confirmation surface is in every client, because the code
            // goes to the *current* primary and therefore cannot be received by whoever
            // is trying to move it.
            Route::post('/contacts/{contact}/primary', ContactPrimaryController::class)
                ->middleware('step-up')
                ->name('me.contacts.primary');

            // Retires rather than deletes (D-042), and refuses the login mirror with
            // `resource.conflict`: an account whose only route back in has been
            // withdrawn is an account nobody can recover.
            Route::delete('/contacts/{contact}', ContactDestroyController::class)
                ->name('me.contacts.destroy');

            Route::get('/addresses', AddressIndexController::class)->name('me.addresses.index');
            Route::post('/addresses', AddressStoreController::class)->name('me.addresses.store');
            Route::patch('/addresses/{address}', AddressUpdateController::class)->name('me.addresses.update');
            Route::delete('/addresses/{address}', AddressDestroyController::class)->name('me.addresses.destroy');

            // A POST sub-resource action, never a `PATCH is_default` (master plan v2
            // §4.15): promoting means demoting the incumbent, the partial unique index
            // refuses a second default per type, and a client doing it as two field
            // writes would collide with itself between them.
            Route::post('/addresses/{address}/default', AddressDefaultController::class)
                ->name('me.addresses.default');

            // PUT, not PATCH. The declaration is replaced whole because a person
            // removing an allergy means they no longer have it, and a merge would make
            // removal impossible through the ordinary path.
            Route::get('/dietary-profile', DietaryProfileShowController::class)->name('me.dietary-profile.show');
            Route::put('/dietary-profile', DietaryProfileReplaceController::class)->name('me.dietary-profile.replace');

            // Consent is keyed by the definition's own code rather than by a grant id.
            // The person is withdrawing "marketing", not row 4f3a…; and the grant they
            // are withdrawing is whichever version they hold, which only the ledger
            // knows.
            Route::get('/consents', ConsentIndexController::class)->name('me.consents.index');
            Route::post('/consents', ConsentStoreController::class)->name('me.consents.store');
            Route::delete('/consents/{code}', ConsentDestroyController::class)->name('me.consents.destroy');
        });

        // The organisation-scoped probe of the vertical slice: headers,
        // membership and permission proven end to end.
        Route::get('/organisations/current', CurrentOrganisationController::class)
            ->middleware(['org.context', 'branch.context', 'permission:organisation.view_current'])
            ->name('organisations.current');

        /*
        |------------------------------------------------------------------
        | Baskets and checkout (C1)
        |------------------------------------------------------------------
        |
        | **No permission codes anywhere in this family**, and that is the
        | design rather than an omission. Every other authenticated surface on
        | the platform is a member of an organisation acting inside it, and
        | `permission:` is how the platform asks whether they may. A customer
        | is a member of nothing: there is no membership to hang a role on, no
        | organisation to scope one to, and a permission code would have to be
        | granted to every account at sign-up — which is a code that answers
        | "yes" for everybody and therefore answers nothing. The authority
        | here is **ownership**, and it is enforced where ownership lives:
        | `CartLocator` and `OrderLocator` scope every row to the caller's own
        | `CustomerAccount` and answer `resource.not_found` otherwise. This is
        | the foundation `/me/*` pattern, applied to the two resources a
        | customer actually owns.
        |
        | `verified` rather than bare `auth:sanctum`: a basket leads to an
        | order, an order is a promise that somebody will be told when it is
        | late, and a promise made to an unproven address is a promise made to
        | a typo. The account *activation* gate is a separate and later
        | question — `CheckoutEligibility`, answered inside placement — because
        | filling a basket before finishing onboarding is exactly how somebody
        | is persuaded to finish onboarding.
        |
        | **`/carts` is not under `/me`, and `/me/orders` is.** Not an
        | inconsistency: a cart is addressed by identifier because a customer
        | may hold one per channel and the client always knows which one it
        | means, while order history is a *collection of mine* — the same
        | shape as `/me/devices`. The route names follow the resource, not the
        | prefix.
        |
        | There is no `DELETE /carts/{cart}`. A basket expires on its own
        | after a TTL and its lines are kept, because an expired cart is the
        | record of what somebody nearly ordered and is what "resume my
        | basket" restores from. Emptying one is removing its lines.
        |
        | No `precondition` on the cart writes, though `carts` carries
        | `lock_version` and the responses serve it as an `ETag`. The header
        | prevents a *lost update*, and a basket has exactly one author — the
        | race would have to be run by a customer against themselves. The
        | validator is there so a client can tell a stale render from a
        | current one, not to arbitrate.
        |
        */
        Route::post('/carts', CartStoreController::class)->name('carts.store');

        Route::post('/carts/{cart}/items', CartItemStoreController::class)->name('carts.items.store');
        Route::patch('/carts/{cart}/items/{item}', CartItemUpdateController::class)->name('carts.items.update');
        Route::delete('/carts/{cart}/items/{item}', CartItemDestroyController::class)->name('carts.items.destroy');

        /*
        | A query, not a command — no `idempotency` middleware, because the
        | same proposal always has the same answer and there is nothing here
        | for a replay to protect against.
        |
        | **`customer_address_id` is optional here and required at
        | `/orders`.** A shopper previews a total before choosing where it
        | goes — the cart screen has no address at all — and an absent one is
        | reported as the `address_missing` warning rather than refused,
        | because a preview has no transaction to abort. `CheckoutPreviewService`
        | runs the identical `LineProbe` and `ZoneResolver` paths
        | `OrderPlacementService` runs at placement, so this and `POST /orders`
        | never quote two different numbers for a basket nothing has changed
        | about.
        */
        Route::post('/checkouts/preview', CheckoutPreviewController::class)->name('checkouts.preview');

        /*
        | The platform's **first genuinely non-idempotent command**, and the
        | first consumer of the `idempotency` alias that has existed since the
        | foundation. A double tap on a slow connection, a mobile client
        | retrying a request whose response was lost, or a proxy replaying a
        | POST all produce two orders for one intention, and the customer
        | finds out when two couriers arrive.
        |
        | **Two guards, and neither is redundant.** The middleware answers a
        | replay with the stored response *envelope*, which a service cannot
        | do — by the time it runs, the response is gone.
        | `OrderIdempotency`, inside the placement service, claims the key
        | before the order row exists, which is what makes a genuine race an
        | insert conflict rather than a check-then-act two requests can both
        | pass — and it also protects a placement made by a queued job or a
        | console command, which never passes through a middleware at all.
        |
        | The key is optional. A client that sends none gets no replay
        | protection and is told so by its absence rather than by a 400: an
        | endpoint that refused unkeyed requests would break every caller that
        | has ever worked, to protect them from a risk they may not have.
        */
        Route::post('/orders', OrderStoreController::class)
            ->middleware('idempotency')
            ->name('orders.store');

        /*
        | Newest first, and the direction is a property of the endpoint rather
        | than a query parameter: a collection walkable both ways from one
        | cursor would need the direction inside the cursor to stay coherent.
        |
        | **No filters**, unlike the kitchen list below. A person has tens of
        | orders and the whole history fits in a page or two; a parameter to
        | document, version and test in exchange for saving a client one array
        | filter is a bad trade. The kitchen reads a book that grows for as
        | long as the kitchen trades, which is why that list has four.
        */
        Route::get('/me/orders', MyOrderIndexController::class)->name('me.orders.index');
        Route::get('/me/orders/{order}', MyOrderShowController::class)->name('me.orders.show');

        /*
        |------------------------------------------------------------------
        | Payments (C1)
        |------------------------------------------------------------------
        |
        | **The create is the buyer's and the other two are the seller's, and
        | the split in the middleware is the split in the act.** Opening an
        | intent is part of checking out: it names an order, `OrderLocator`
        | scopes that order to the caller's own customer account, and a
        | customer is a member of no organisation, so `org.context` here would
        | ask for a header nobody shopping has. Capturing takes the money and
        | refunding gives it back — both are the kitchen's decisions about the
        | kitchen's money, and `payment_intents.organisation_id` has always
        | held the kitchen (it is copied from the order).
        |
        | Before this the pair had neither the header nor a scope on the model,
        | so `whereKey()` resolved *any* tenant's intent for any verified
        | caller — capture and refund on somebody else's payment, by
        | identifier alone. `PaymentIntent` is now `OrganisationScoped`, which
        | makes a foreign intent **absent** rather than forbidden: a `404`,
        | never a `403`, because a `403` would confirm that the identifier
        | names something real.
        */
        Route::post('/payments/intents', PaymentIntentStoreController::class)->name('payments.intents.store');

        Route::middleware('org.context')->group(function (): void {
            Route::post('/payments/intents/{paymentIntent}/capture', PaymentIntentCaptureController::class)->name('payments.intents.capture');
            Route::post('/payments/intents/{paymentIntent}/refunds', PaymentRefundStoreController::class)->name('payments.intents.refunds.store');
        });

        /*
        |------------------------------------------------------------------
        | Delivery jobs (F1)
        |------------------------------------------------------------------
        |
        | `org.context` on **all three**, including the two driver routes.
        | `DeliveryJob` is `OrganisationScoped` and `OrganisationScope` fails
        | closed — it throws when no organisation is published — so the driver
        | pair without it did not read the wrong rows, it raised
        | `MissingTenantContext` on every call and rendered as `500`. The
        | header was always required in substance; it is now required in the
        | routing table, which is where a reader can see it.
        |
        | No permission code. A driver is staff of the kitchen whose jobs
        | these are, and the narrowing that matters is `driver_user_id` — the
        | caller's own assignments — which is ownership rather than authority
        | and is enforced in the controllers. `/delivery/jobs` is the
        | dispatcher's view of the same table and is scoped by the
        | organisation alone.
        */
        Route::middleware('org.context')->group(function (): void {
            Route::get('/driver/jobs', DriverJobIndexController::class)->name('driver.jobs.index');
            Route::post('/driver/jobs/{job}/deliver', DriverJobDeliverController::class)->name('driver.jobs.deliver');

            Route::get('/delivery/jobs', DeliveryJobIndexController::class)->name('delivery.jobs.index');
        });

        /*
        |------------------------------------------------------------------
        | Corporate buyer catalogue (B2B checkout phase 1)
        |------------------------------------------------------------------
        |
        | Requires `org.context`: prices are resolved through the buyer's own
        | agreement and must never be served on a marketplace surface.
        */
        Route::middleware('org.context')->prefix('/b2b/catalogue')->group(function (): void {
            Route::get('/items', B2bCatalogueItemIndexController::class)->name('b2b.catalogue.items.index');
            Route::get('/items/{item}', B2bCatalogueItemShowController::class)->name('b2b.catalogue.items.show');
        });

        /*
        |------------------------------------------------------------------
        | Corporate programmes & quotations (B1-B12)
        |------------------------------------------------------------------
        |
        | `org.context` throughout: a programme belongs to a provisioned
        | buyer organisation (B12), so there is nothing here for an
        | applicant that has not yet been provisioned — that flow is the
        | unscoped `/b2b/applications` block below.
        |
        | The buyer side carries **no permission code**. Reading the
        | programme list, drafting a quotation's lines, submitting it, and
        | deciding on a kitchen's prices are things any member of the buyer
        | organisation may do (B7: org-shared server drafts) — membership,
        | already proven by `org.context`, is the only gate. This mirrors
        | the B2B catalogue block immediately above, for the same reason.
        |
        | The kitchen side is permission-gated because it looks the other
        | way across the same relationship: `b2b_quotation.view_organisation`
        | for reading what buyers submitted, `b2b_quotation.quote_organisation`
        | for naming a price. Both are organisation-scoped roles, granted to
        | `kitchen_manager` and `commercial_manager` in
        | `PermissionRegistry::organisationPermissions()`.
        */
        Route::middleware('org.context')->prefix('/b2b')->group(function (): void {
            Route::get('/programmes', CorporateProgrammeIndexController::class)->name('b2b.programmes.index');
            Route::get('/programmes/{programme}', CorporateProgrammeShowController::class)->name('b2b.programmes.show');

            Route::get('/programmes/{programme}/quotations', QuotationIndexController::class)->name('b2b.programmes.quotations.index');
            Route::post('/programmes/{programme}/quotations', QuotationStoreController::class)->name('b2b.programmes.quotations.store');

            Route::get('/quotations/{quotation}', QuotationShowController::class)->name('b2b.quotations.show');

            Route::patch('/quotations/{quotation}', QuotationUpdateController::class)
                ->middleware('precondition')
                ->name('b2b.quotations.update');

            Route::post('/quotations/{quotation}/submit', QuotationSubmitController::class)
                ->middleware('precondition')
                ->name('b2b.quotations.submit');

            Route::post('/quotations/{quotation}/accept', QuotationAcceptController::class)
                ->middleware('precondition')
                ->name('b2b.quotations.accept');

            Route::post('/quotations/{quotation}/decline', QuotationDeclineController::class)
                ->middleware('precondition')
                ->name('b2b.quotations.decline');

            Route::middleware('permission:b2b_quotation.view_organisation')->group(function (): void {
                Route::get('/kitchen/quotations', KitchenQuotationIndexController::class)->name('b2b.kitchen.quotations.index');
                Route::get('/kitchen/quotations/{quotation}', KitchenQuotationShowController::class)->name('b2b.kitchen.quotations.show');
            });

            Route::post('/kitchen/quotations/{quotation}/quote', KitchenQuotationQuoteController::class)
                ->middleware(['permission:b2b_quotation.quote_organisation', 'precondition'])
                ->name('b2b.kitchen.quotations.quote');
        });

        /*
        |------------------------------------------------------------------
        | Subscriptions — the customer's own standing arrangements (S1)
        |------------------------------------------------------------------
        |
        | Middleware: auth:sanctum, db.context, device.touch, verified.
        |
        | **No permission codes, for the C1 reason restated.** A customer is a
        | member of no organisation: there is no membership to hang a role on,
        | no organisation to scope one to, and a code granted to every account
        | at sign-up answers "yes" for everybody and therefore answers nothing.
        | The authority here is **ownership**, enforced where ownership lives —
        | `SubscriptionLocator` scopes every row to the caller's own
        | `CustomerAccount` and answers `resource.not_found` otherwise.
        |
        | **`POST /subscriptions` is not under `/me` and the rest is**, the same
        | split `/carts` and `/me/orders` already draw: a creation names no
        | existing resource of the caller's, while a list of somebody's standing
        | arrangements is a *collection of mine*. `GET /subscriptions/quote`
        | sits with the creation because it is the price of a thing that does
        | not exist yet.
        |
        | **`idempotency` on the creation, and nowhere else in the family.** A
        | replayed POST produces a second twenty-day arrangement and the
        | customer finds out when twice the food arrives every morning. Every
        | other write here is a change to a row that already exists, guarded by
        | the state machine and the change window; a replayed pause pauses an
        | already-paused subscription and is refused as an invalid transition.
        |
        | **No `precondition` anywhere, though `subscriptions` carries
        | `lock_version` and every response serves it as an `ETag`.** The
        | `/carts` argument: the header prevents a *lost update*, a lost update
        | needs two authors, and a subscription has one — the race would have to
        | be run by a customer against themselves in two tabs. `If-Match` is
        | honoured when sent (see `ReadsOptionalPrecondition`) so a careful
        | client can protect itself; a 428 on every pause would break every
        | caller that has ever worked to protect them from a race they are not
        | in. Contrast the kitchen's order actions, where two staff confirming
        | the same order at once is an ordinary Tuesday and `precondition` is
        | mandatory.
        |
        | **Pause, resume, cancel and skip are POST sub-resources; address,
        | window, weekdays and choices are PUT replacements.** Never a `PATCH
        | status` and never one `PATCH` accepting all four fields (master plan
        | v2 §4.15): the lifecycle actions have separate consequences,
        | timestamps and journal events, and the three settings ask different
        | questions of the world — an address change re-runs the delivery map,
        | a window change asks nothing of it, and a client changing a slot
        | should not be refused because it also moved house.
        |
        | `…/skips` is a sub-**collection** because a skip is a row that exists
        | afterwards, and it is keyed by date rather than by delivery id: the
        | day a customer wants to skip usually has no row yet, which is the
        | whole point of one-day-ahead generation.
        |
        | There is no DELETE. A cancelled subscription keeps its captured price,
        | its balance and its history, because the credit memo multiplies the
        | price it actually paid and a deleted row could not explain the number.
        |
        */
        Route::post('/subscriptions', SubscriptionStoreController::class)
            ->middleware('idempotency')
            ->name('subscriptions.store');

        Route::get('/subscriptions/quote', SubscriptionQuoteController::class)
            ->name('subscriptions.quote');

        Route::get('/me/subscriptions', MySubscriptionIndexController::class)->name('me.subscriptions.index');
        Route::get('/me/subscriptions/{subscription}', MySubscriptionShowController::class)->name('me.subscriptions.show');

        Route::post('/me/subscriptions/{subscription}/pause', SubscriptionPauseController::class)->name('me.subscriptions.pause');
        Route::post('/me/subscriptions/{subscription}/resume', SubscriptionResumeController::class)->name('me.subscriptions.resume');
        Route::post('/me/subscriptions/{subscription}/cancel', SubscriptionCancelController::class)->name('me.subscriptions.cancel');

        Route::post('/me/subscriptions/{subscription}/skips', SubscriptionSkipStoreController::class)->name('me.subscriptions.skips.store');

        Route::put('/me/subscriptions/{subscription}/address', SubscriptionAddressUpdateController::class)->name('me.subscriptions.address.update');
        Route::put('/me/subscriptions/{subscription}/window', SubscriptionWindowUpdateController::class)->name('me.subscriptions.window.update');
        Route::put('/me/subscriptions/{subscription}/weekdays', SubscriptionWeekdaysUpdateController::class)->name('me.subscriptions.weekdays.update');

        // Free Selection choose-ahead (§7). One day per call, named in the body
        // rather than in the path: a date is not an identifier of anything, and
        // the delivery row usually does not exist yet.
        Route::put('/me/subscriptions/{subscription}/choices', SubscriptionChoiceReplaceController::class)->name('me.subscriptions.choices.replace');

        // The rows that exist, newest first — never the projection. What is
        // *coming* is `next_delivery_date` plus the weekday pattern the client
        // already holds; serving projections into somebody's ledger would put
        // days there that nothing has committed to.
        Route::get('/me/subscriptions/{subscription}/deliveries', MySubscriptionDeliveryIndexController::class)->name('me.subscriptions.deliveries.index');

        /*
        |------------------------------------------------------------------
        | Account closure — the customer's own (J2)
        |------------------------------------------------------------------
        |
        | Middleware: auth:sanctum, db.context, device.touch, verified.
        |
        | **No permission codes, and no `step-up` middleware either.** The first
        | is ownership again. The second is the interesting one: this is the
        | most destructive act a customer can perform and it is deliberately
        | *not* behind `step-up`, because the journey carries its own stronger
        | proof — a passcode sent to the account's verified destination and
        | bound to this specific request on the row
        | (`account_closure_requests.otp_challenge_id`). A purpose-scoped
        | step-up flag would be enough to stop a contact-verification code
        | unlocking a closure, and not enough to stop *a* closure code
        | finalising *another* closure, including one support opened moments
        | earlier that the customer never agreed to. Stacking `step-up` on top
        | would add a password prompt that proves less than what is already
        | there.
        |
        | **`/live` rather than an index.** There is at most one request in
        | flight — the table's partial unique index says so and the service
        | refuses a second — and a collection endpoint would be a list that is
        | always empty or a singleton. Completed and cancelled requests are not
        | listed at all: a history of somebody's previous attempts to leave is
        | not something the platform has a reason to hand back.
        |
        | **There is no `…/challenges` endpoint.** `ClosureService::request()`
        | issues the passcode as part of opening the request and binds it to the
        | row, which is what stops a code obtained for one closure finalising
        | another. A client that needs a fresh code uses the generic
        | `POST /verification/challenges/{challenge}/resend`, which already
        | serves every purpose in the table; a second issuing surface here would
        | be a second place for the binding to be got wrong.
        |
        | `DELETE` stamps `cancelled` and removes nothing. Who asked to leave
        | and then changed their mind is exactly the trail a data-protection
        | enquiry reads.
        |
        */
        Route::post('/me/closure-requests', ClosureRequestStoreController::class)
            ->name('me.closure-requests.store');

        Route::get('/me/closure-requests/live', ClosureRequestLiveController::class)
            ->name('me.closure-requests.live');

        Route::post('/me/closure-requests/{closureRequest}/verify', ClosureRequestVerifyController::class)
            ->name('me.closure-requests.verify');

        Route::delete('/me/closure-requests/{closureRequest}', ClosureRequestCancelController::class)
            ->name('me.closure-requests.cancel');

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
        | `org.trading` sits on every catalogue, recipe, pricing, plan and
        | delivery-zone *write* group below and on none of the read groups
        | (PA1). A kitchen the platform has suspended keeps its workspace —
        | it can still read what it built and see the banner saying why the
        | publish button refuses — but it may not change what it is selling.
        | The operations writes further down (inventory, receipts, production,
        | quality control) are deliberately left open: suspension stops a
        | kitchen selling, not finishing the food it already owes people.
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

            Route::middleware(['org.trading', 'permission:catalogue.manage_organisation'])->group(function (): void {
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
            Route::post('/recipes/roll-up-preview', RecipeRollupPreviewController::class)
                ->name('catalogue.recipes.roll-up-preview');

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

            Route::middleware(['org.trading', 'permission:recipe.manage_organisation'])->group(function (): void {
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

            Route::middleware(['org.trading', 'permission:recipe.publish_organisation'])->group(function (): void {
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
                    ->middleware(['org.trading', 'permission:recipe.manage_organisation'])
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

            Route::middleware(['org.trading', 'permission:catalogue.manage_organisation'])->group(function (): void {
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

                Route::put('/items/{item}/availability', CatalogueItemAvailabilityReplaceController::class)
                    ->middleware('precondition')
                    ->name('catalogue.items.availability.replace');
            });

            Route::middleware(['org.trading', 'permission:catalogue.publish_organisation'])->group(function (): void {
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

            Route::middleware(['org.trading', 'permission:price_list.manage_organisation'])->group(function (): void {
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

            Route::middleware(['org.trading', 'permission:catalogue.publish_organisation'])->group(function (): void {
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
            Route::middleware(['org.trading', 'permission:plan.manage_organisation'])->group(function (): void {
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
            Route::middleware(['org.trading', 'permission:delivery_zone.manage_organisation'])->group(function (): void {
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

            /*
            |--------------------------------------------------------------
            | Kitchen operations — stock, procurement, production, QC, rail
            |--------------------------------------------------------------
            |
            | Re-pointed to the `inventory.*` domain by INV1.0. The whole ops
            | surface used to piggyback `catalogue.view_organisation` /
            | `catalogue.manage_organisation`, which meant everyone who could
            | read the catalogue could read the shelves and everyone who could
            | edit a listing could move stock. Counting stock and writing a
            | product listing are different jobs, so they are now different
            | codes: reads take `inventory.view_organisation`, writes take
            | `inventory.manage_organisation`. A third code,
            | `inventory.view_costs_organisation`, gates the money INV1.1/INV1.2
            | add and is wired into the registry now; nothing in this slice is
            | cost-bearing yet, so no route checks it.
            |
            | `pos/sales` deliberately stays on `catalogue.manage_organisation`:
            | recording a till sale is a commerce action, not an inventory one,
            | and INV1.0's re-point named inventory, procurement, production, QC
            | and the display rail — not POS.
            */
            Route::middleware('permission:inventory.view_organisation')->group(function (): void {
                Route::get('/inventory/items', StockItemIndexController::class)->name('catalogue.inventory.items.index');
                Route::get('/inventory/levels', StockLevelIndexController::class)->name('catalogue.inventory.levels.index');
                Route::get('/inventory/low-stock-count', StockLowStockCountController::class)->name('catalogue.inventory.low-stock-count');
                Route::get('/procurement/suppliers', SupplierIndexController::class)->name('catalogue.procurement.suppliers.index');
                Route::get('/procurement/goods-receipts', GoodsReceiptIndexController::class)->name('catalogue.procurement.goods-receipts.index');
                Route::get('/production/orders', ProductionOrderIndexController::class)->name('catalogue.production.orders.index');
                Route::get('/quality-control/checks', QualityCheckIndexController::class)->name('catalogue.quality-control.checks.index');
                Route::get('/kitchen-display/tickets', KdsTicketIndexController::class)->name('catalogue.kitchen-display.tickets.index');
            });

            Route::middleware('permission:inventory.manage_organisation')->group(function (): void {
                Route::post('/inventory/items', StockItemStoreController::class)->name('catalogue.inventory.items.store');
                Route::post('/inventory/adjustments', StockAdjustController::class)->name('catalogue.inventory.adjustments.store');
                Route::post('/inventory/waste', StockWasteController::class)->name('catalogue.inventory.waste.store');
                Route::patch('/inventory/threshold', StockThresholdController::class)->name('catalogue.inventory.threshold.update');
                Route::post('/procurement/goods-receipts', GoodsReceiptStoreController::class)->name('catalogue.procurement.goods-receipts.store');
                Route::post('/production/orders', ProductionOrderStoreController::class)->name('catalogue.production.orders.store');
                Route::post('/production/orders/{productionOrder}/complete', ProductionOrderCompleteController::class)->name('catalogue.production.orders.complete');
                Route::post('/quality-control/checks', QualityCheckStoreController::class)->name('catalogue.quality-control.checks.store');
                Route::post('/quality-control/checks/{qualityCheck}/hold', QualityCheckHoldController::class)->name('catalogue.quality-control.checks.hold');
                Route::post('/quality-control/checks/{qualityCheck}/release', QualityCheckReleaseController::class)->name('catalogue.quality-control.checks.release');
                Route::post('/kitchen-display/tickets/{ticket}/bump', KdsTicketBumpController::class)->name('catalogue.kitchen-display.tickets.bump');
            });

            /*
            | The purchases ledger (INV1.1) reads the money on every receipt
            | line, so it sits behind `inventory.view_costs_organisation` rather
            | than the plain view code the rest of this surface takes. A person
            | who may count stock and post receipts but not read their valuation
            | gets a 403 here — the redacted goods-receipts index is their read.
            */
            Route::middleware('permission:inventory.view_costs_organisation')->group(function (): void {
                Route::get('/procurement/purchases-ledger', PurchasesLedgerIndexController::class)->name('catalogue.procurement.purchases-ledger.index');

                /*
                | The monthly cost report (INV1.4) sits beside the ledger on the
                | same cost permission: it exposes spend, COGS and the margin
                | reconstructable from cost and revenue, so it takes the code that
                | gates money everywhere in this domain, not the plain view code.
                */
                Route::get('/reports/monthly-cost', MonthlyCostReportController::class)->name('catalogue.reports.monthly-cost.index');
            });

            Route::middleware('permission:catalogue.manage_organisation')->group(function (): void {
                Route::post('/pos/sales', PosSaleStoreController::class)->name('catalogue.pos.sales.store');
            });

            /*
            |--------------------------------------------------------------
            | Orders — the kitchen's book (C1)
            |--------------------------------------------------------------
            |
            | A fifth permission domain, `order.*`, and **a genuine pair** rather
            | than K1.7's single code. The two halves are held by different people
            | for a reason no other family here has: reading the book is what a
            | kitchen hand does all shift, and confirming an order commits the
            | kitchen to cook it while cancelling one takes a customer's dinner
            | away. Both codes already exist in the permission registry, granted to
            | the kitchen-manager template; the read alone goes to kitchen staff.
            |
            | **Under `/catalogue` rather than a new prefix**, because the prefix
            | means "the kitchen's own operating surface, reached with an
            | organisation context" — everything a member of one organisation
            | manages about what it sells. An order is what a listing became.
            |
            | Organisation-scoped, **not** branch-scoped, and deliberately so. A
            | kitchen manager holding an organisation-wide membership selects no
            | branch, and an endpoint reading `X-Branch-Id` would show them
            | nothing until they picked one. Narrowing to one production site is
            | the `branch_id` *query* filter on the index — a narrowing of a book
            | the caller can already see, never a widening of one they cannot.
            |
            | The three lifecycle actions are **POST sub-resources, never a
            | `PATCH status`** (master plan v2 §4.15). Three decisions, three
            | consequences, three separate timestamps and three audit events; a
            | status field would collapse them into one write a client could aim
            | anywhere, and `placed → fulfilled` would become expressible by
            | typing.
            |
            | `precondition` guards all three. It matters more here than anywhere
            | else it is used on the platform: a kitchen screen showing an order
            | list is stale the moment it renders, and two staff members
            | confirming the same order at once is an ordinary Tuesday. The
            | validator is checked inside the same conditional `UPDATE` that
            | performs the transition, so there is no window between the read and
            | the write.
            |
            | There is no DELETE and there never will be. A cancelled order keeps
            | its number, its lines and the prices they were sold at, because a
            | kitchen reconciling a week needs to know what it did not sell as
            | much as what it did.
            |
            | `{order}` is an identifier only — no slug, no order number. The
            | number *is* human-readable and it is tempting, but it is printed on
            | a receipt that passes through a courier's hands, and a URL that
            | accepted it would turn a scrap of paper into an address. It is
            | searchable through the index's `query` filter, behind the read
            | permission, which is the same convenience without the guessable
            | path.
            |
            */
            Route::middleware('permission:order.view_organisation')->group(function (): void {
                Route::get('/orders', KitchenOrderIndexController::class)->name('catalogue.orders.index');
                Route::get('/orders/{order}', KitchenOrderShowController::class)->name('catalogue.orders.show');
            });

            Route::middleware('permission:order.manage_organisation')->group(function (): void {
                Route::post('/orders/{order}/confirm', KitchenOrderConfirmController::class)
                    ->middleware('precondition')
                    ->name('catalogue.orders.confirm');

                // `fulfil`, not `fulfill`. The platform is British throughout —
                // `fulfilled_at`, `OrderStatus::Fulfilled`, `OrderLifecycle::fulfil()` —
                // and a path disagreeing with the column, the enum and the method it
                // drives would be one spelling nobody could predict from the other three.
                Route::post('/orders/{order}/fulfil', KitchenOrderFulfilController::class)
                    ->middleware('precondition')
                    ->name('catalogue.orders.fulfil');

                Route::post('/orders/{order}/cancel', KitchenOrderCancelController::class)
                    ->middleware('precondition')
                    ->name('catalogue.orders.cancel');
            });

            /*
            |--------------------------------------------------------------
            | The forward book of standing arrangements (S1)
            |--------------------------------------------------------------
            |
            | **The endpoint that makes one-day-ahead generation affordable.**
            | §4 generates a single delivery ahead so the order book stays
            | truthful, and the obvious objection is that a kitchen then cannot
            | see next week. It sees next week here: `ScheduleProjection` lays
            | the delivery rows that exist over the weekday patterns of every
            | active subscription, bounded by each one's remaining balance.
            | Nothing on that path writes anything, which is the whole
            | guarantee — a projection that materialised rows would be the
            | phantom orders the design exists to avoid, and would have to be
            | un-materialised on every skip, pause and cancellation.
            |
            | **A sixth permission domain gets its first endpoint.**
            | `subscription.view_organisation` has been in the registry since
            | the foundation as a proposal with nothing behind it; K1.6 and C1
            | both declined to spend it. It is not `order.view_organisation`: a
            | subscription is a standing commercial arrangement carrying a
            | captured price, and reading today's order list is not by itself a
            | reason to see who is committed to what and for how long. It is not
            | `plan.manage_organisation` either — that is the authority to
            | *design* plans, and a production planner needs to read the
            | schedule without being able to change what the kitchen sells.
            | Granted to the kitchen manager and the commercial manager.
            |
            | Organisation-scoped, not branch-scoped, exactly as the order book
            | is: a manager with an organisation-wide membership selects no
            | branch, and an endpoint reading `X-Branch-Id` would show them
            | nothing until they picked one. `branch_id` is a query filter — a
            | narrowing of a view the caller already has.
            |
            | Read-only, and structurally so. There is no writer here and there
            | will not be one: what a *customer* does to a subscription is the
            | `/me/subscriptions` family, against their own ownership.
            |
            */
            Route::middleware('permission:subscription.view_organisation')->group(function (): void {
                Route::get('/subscription-schedule', KitchenSubscriptionScheduleController::class)
                    ->name('catalogue.subscription-schedule.index');
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

        /*
        |--------------------------------------------------------------------------
        | B2B applications — the applicant's own surface (B1)
        |--------------------------------------------------------------------------
        |
        | Middleware: auth:sanctum + db.context + device.touch + verified.
        | **No permission code, and none is missing.** An applicant is not a member
        | of anything — the whole point of this journey is that they have no
        | organisation — so there is nothing for an organisation-scoped permission
        | to be scoped to, and no platform authority they could plausibly hold.
        | What stands in for authorisation is *ownership*: `applicant_user_id` is
        | stamped at creation and `ApplicationService` checks it on every write.
        |
        | A non-owner gets **404**, never 403, and that is deliberate rather than
        | sloppy: telling a stranger "that application exists but is not yours"
        | turns an identifier into a probe for which companies have applied.
        |
        | No `org.context` anywhere in this block. `b2b_applications` is the one
        | business table in the platform that is not tenant-scoped, because it
        | exists so that a tenant may.
        |
        | `precondition` guards the three writes that move state — the section
        | PATCH, submit and withdraw. The set-replace endpoints carry no `If-Match`:
        | each set is replaced whole in one transaction, so there is no half-list
        | for a validator to protect, and the rows carry no `lock_version` of their
        | own because a per-row validator would let two editors replace different
        | halves of one roster.
        |
        | Submit and withdraw are POST sub-resource actions, never a `PATCH status`
        | (master plan v2 §4.15).
        |
        */
        Route::prefix('/b2b')->group(function (): void {
            Route::post('/applications', B2bApplicationStoreController::class)
                ->name('b2b.applications.store');

            Route::get('/applications', B2bApplicationIndexController::class)
                ->name('b2b.applications.index');

            Route::get('/applications/{application}', B2bApplicationShowController::class)
                ->name('b2b.applications.show');

            // The section is in the path rather than the body, so the server can
            // refuse a payload that wandered outside the step the client said it was
            // saving. A key the section does not own is refused — never ignored — and
            // the refusal names the section that does own it.
            Route::patch('/applications/{application}/sections/{section}', B2bApplicationSectionUpdateController::class)
                ->middleware('precondition')
                ->name('b2b.applications.sections.update');

            // Set-replace. `{"contacts": []}` and `{"locations": []}` are the payloads
            // that express a deletion, which a merge-shaped PATCH cannot.
            Route::put('/applications/{application}/contacts', B2bApplicationContactReplaceController::class)
                ->name('b2b.applications.contacts.replace');

            Route::put('/applications/{application}/locations', B2bApplicationLocationReplaceController::class)
                ->name('b2b.applications.locations.replace');

            // The one multipart endpoint in the family. Base64 in a JSON body would
            // inflate every upload by a third and put ten megabytes through the
            // request pipeline as a PHP value rather than as a file on disk.
            Route::post('/applications/{application}/documents', KycDocumentStoreController::class)
                ->name('b2b.applications.documents.store');

            Route::get('/applications/{application}/documents', KycDocumentIndexController::class)
                ->name('b2b.applications.documents.index');

            // Answers with a signed URL *in the envelope*, never a 302. A redirect
            // would put an expiring credential into browser history, the referrer
            // chain and every proxy log on the way to the bucket. `?purpose=` is
            // required and is written onto the access audit event.
            Route::get('/applications/{application}/documents/{document}/download', KycDocumentDownloadController::class)
                ->name('b2b.applications.documents.download');

            Route::post('/applications/{application}/submit', B2bApplicationSubmitController::class)
                ->middleware('precondition')
                ->name('b2b.applications.submit');

            Route::post('/applications/{application}/withdraw', B2bApplicationWithdrawController::class)
                ->middleware('precondition')
                ->name('b2b.applications.withdraw');

            /*
            |----------------------------------------------------------------------
            | Agreements and the signatory's passcode
            |----------------------------------------------------------------------
            |
            | Same middleware as the rest of the applicant surface. Two things are
            | worth reading before the routes.
            |
            | **Signing requires a passcode the named signatory spent themselves.**
            | The challenge endpoint records the application's `signatory_email` as
            | an application-owned contact point — evidence of who was named — and
            | then refuses unless the authenticated caller holds that same address
            | as one of their own contacts. Failing that is 403
            | `b2b.signatory_required`: an office manager who can reach the mailbox
            | is not the person the company bound itself through.
            |
            | **No `precondition` on `/sign`.** `AgreementService::sign()` refuses on
            | the agreement's *state* — only `pending_signature` may be signed — which
            | is a stronger guarantee than "only if nobody edited it since you
            | looked", and an active agreement is immutable anyway.
            |
            */
            Route::get('/applications/{application}/agreements', B2bAgreementIndexController::class)
                ->name('b2b.applications.agreements.index');

            Route::get('/applications/{application}/agreements/{agreement}', B2bAgreementShowController::class)
                ->name('b2b.applications.agreements.show');

            Route::post('/applications/{application}/agreements/{agreement}/signature-challenges', B2bAgreementSignatureChallengeController::class)
                ->name('b2b.applications.agreements.signature-challenges.store');

            Route::post('/applications/{application}/agreements/{agreement}/sign', B2bAgreementSignController::class)
                ->name('b2b.applications.agreements.sign');
        });

        /*
        |--------------------------------------------------------------------------
        | B2B platform review (B1)
        |--------------------------------------------------------------------------
        |
        | Middleware: auth:sanctum + db.context + device.touch + verified +
        | org.context + platform.context + permission, plus `precondition` or
        | `idempotency` where noted.
        |
        | Two gates, not one — the same shape K1.1 used for reference governance.
        | `platform.context` asserts the selected organisation *is* the platform
        | operator; `permission` asserts the member holds the code. A tenant that
        | somehow acquired the permission still cannot reach these routes, because
        | an organisation type is not something a tenant can grant itself.
        |
        | **Four codes rather than one**, because reviewing a B2B application is a
        | workflow with genuinely separable authorities and a single `b2b.manage`
        | would have made the separation unexpressible:
        |
        |   * `b2b_application.view_platform`      — read the queue and one file.
        |   * `b2b_application.review_platform`    — claim one, ask for more.
        |   * `b2b_application.decide_platform`    — approve or decline.
        |   * `b2b_application.provision_platform` — turn an approval into a tenant.
        |
        | `kyc_document.view_platform` is deliberately narrower than the application
        | read: a KYC pack is identity documents belonging to a named person, and
        | being able to work a queue is not by itself a reason to open one.
        |
        | `precondition` guards every state move, and on the claim it is what makes
        | the claim exclusive: two reviewers who both opened the queue hold the same
        | validator, and the second write loses with a 409 naming the current state.
        |
        | Provisioning takes `idempotency` **and** refuses a missing `Idempotency-Key`
        | in the controller, because the middleware only enforces semantics when a
        | key is present — which is the right default everywhere else and the wrong
        | one for a command that creates an organisation, a trading account and a
        | set of invitations. No `precondition`: there is no lost update to prevent,
        | and a validator would only stop a reviewer who had re-read the file in
        | another tab.
        |
        */
        Route::middleware(['org.context', 'platform.context'])->prefix('/platform/b2b')->group(function (): void {
            Route::middleware('permission:b2b_application.view_platform')->group(function (): void {
                // Oldest first, unlike every other list in the platform: this is a
                // queue, and the fair order to work applications in is the order they
                // arrived. Drafts are excluded unless `status=draft` asks for them —
                // a half-typed form nobody has sent is not a reviewer's business.
                Route::get('/applications', PlatformB2bApplicationIndexController::class)
                    ->name('platform.b2b.applications.index');

                Route::get('/applications/{application}', PlatformB2bApplicationShowController::class)
                    ->name('platform.b2b.applications.show');
            });

            Route::middleware('permission:b2b_application.review_platform')->group(function (): void {
                Route::post('/applications/{application}/claim', PlatformB2bApplicationClaimController::class)
                    ->middleware('precondition')
                    ->name('platform.b2b.applications.claim');

                // Hands editing rights back for *named sections only*, while the
                // application keeps its place in the queue. Naming no sections means
                // "we need documents, not answers".
                Route::post('/applications/{application}/request-information', PlatformB2bApplicationRequestInformationController::class)
                    ->middleware('precondition')
                    ->name('platform.b2b.applications.request-information');
            });

            Route::middleware('permission:b2b_application.decide_platform')->group(function (): void {
                Route::post('/applications/{application}/approve', PlatformB2bApplicationApproveController::class)
                    ->middleware('precondition')
                    ->name('platform.b2b.applications.approve');

                Route::post('/applications/{application}/decline', PlatformB2bApplicationDeclineController::class)
                    ->middleware('precondition')
                    ->name('platform.b2b.applications.decline');
            });

            // The irreversible half. Separate from deciding because an approval can be
            // revisited and a provisioned tenant cannot be un-provisioned.
            Route::post('/applications/{application}/provision', PlatformB2bApplicationProvisionController::class)
                ->middleware(['permission:b2b_application.provision_platform', 'idempotency'])
                ->name('platform.b2b.applications.provision');

            Route::middleware('permission:kyc_document.view_platform')->group(function (): void {
                Route::get('/applications/{application}/documents/{document}/download', PlatformKycDocumentDownloadController::class)
                    ->name('platform.b2b.applications.documents.download');

                // Both codes stack. Deciding whether a passport scan is acceptable
                // needs the authority to look at it *and* the authority to work the
                // case; either alone is the wrong answer. Middleware groups compose,
                // so the inner declaration is an additional gate, not a replacement.
                Route::post('/documents/{document}/review', PlatformKycDocumentReviewController::class)
                    ->middleware('permission:b2b_application.review_platform')
                    ->name('platform.b2b.documents.review');
            });

            /*
            |----------------------------------------------------------------------
            | Offboarding — ending a corporate relationship (B2)
            |----------------------------------------------------------------------
            |
            | **Under `/platform/b2b`, not the applicant's `/b2b`.** The two gates
            | this block inherits — `platform.context` and a platform permission —
            | cannot exist in the applicant prefix, which has no organisation
            | context at all because an applicant is a member of nothing. Ending a
            | relationship is the other end of admitting one, and it lives beside
            | it.
            |
            | **Platform-driven, with no organisation-side variant.** A tenant does
            | not decide that its own trading relationship ends. An organisation
            | *request* to be offboarded is a real future need and is deferred
            | rather than approximated: it needs a state before `notice_served` and
            | a human decision at the platform, and an endpoint that let a company
            | put itself straight into `notice_served` would look like the same
            | thing while ending its own trading with nobody in the loop.
            |
            | **Nothing here cascades, and the route table is where that is
            | visible.** Nine states and eight separate commands: it would be
            | shorter to have sign-off revoke and archive in one transaction and it
            | would be wrong, because revocation ends people's access to a system
            | they use for work and the platform should have to be told to do it
            | rather than doing it as a side effect of a signature.
            |
            | **Three codes, not one.**
            |
            |   * `b2b_offboarding.manage_platform` — drive the wind-up. The
            |     operational job.
            |   * `b2b_offboarding.waive_settlement_platform` — stacked on the
            |     waiver alone. Letting a company stop owing money and leave anyway
            |     is a commercial concession, not an operational step; a waiver
            |     reachable by everybody who can click through the other eight steps
            |     would be the escape hatch quietly becoming the path.
            |   * `record_export.create_platform` — stacked on the two export
            |     routes. Taking a complete copy of everything a company gave the
            |     platform is a different act with a different risk, the same
            |     argument that makes `kyc_document.view_platform` narrower than
            |     reading an application.
            |
            | **`idempotency` on `revoke-access` and nowhere else.** It is the
            | irreversible step: everything before it can be cancelled, and from
            | there it cannot, because "cancelling" a revocation would mean silently
            | re-granting access somebody deliberately removed. `archive` is
            | deliberately *without* it — `archiving → archiving` is legal so a
            | partial purge is retried, and a replay guard would refuse the retry
            | that step is designed to accept.
            |
            | **No `precondition` anywhere.** The transitions are guarded by the
            | state machine, which is a stronger guarantee than "only if nobody
            | touched it since you looked": `signed_off → signed_off` is illegal
            | whatever validator a caller holds. The `ETag` is served so a client
            | can tell a stale render from a current one.
            |
            | Sign-off is **not** reachable by whoever is driving the wind-up.
            | `OffboardingService::signOff()` demands a consumed `b2b_signatory`
            | challenge belonging to the caller, and the challenge endpoint sends it
            | to the *agreement's* signatory. The permission is necessary and
            | nowhere near sufficient.
            |
            | There is no DELETE. `cancel` stamps a status and a reason, because why
            | a wind-up stopped is the question somebody asks when the company is
            | still trading eighteen months later.
            |
            */
            Route::middleware('permission:b2b_offboarding.manage_platform')->prefix('/offboardings')->group(function (): void {
                Route::post('/', OffboardingStoreController::class)
                    ->name('platform.b2b.offboardings.store');

                Route::get('/{offboarding}', OffboardingShowController::class)
                    ->name('platform.b2b.offboardings.show');

                Route::post('/{offboarding}/settlement-checks', OffboardingSettlementCheckController::class)
                    ->name('platform.b2b.offboardings.settlement-checks.store');

                Route::post('/{offboarding}/settlement-waiver', OffboardingSettlementWaiverController::class)
                    ->middleware('permission:b2b_offboarding.waive_settlement_platform')
                    ->name('platform.b2b.offboardings.settlement-waiver');

                Route::post('/{offboarding}/signoff-challenges', OffboardingSignoffChallengeController::class)
                    ->name('platform.b2b.offboardings.signoff-challenges.store');

                Route::post('/{offboarding}/signoff', OffboardingSignoffController::class)
                    ->name('platform.b2b.offboardings.signoff');

                Route::post('/{offboarding}/revoke-access', OffboardingRevokeAccessController::class)
                    ->middleware('idempotency')
                    ->name('platform.b2b.offboardings.revoke-access');

                Route::post('/{offboarding}/archive', OffboardingArchiveController::class)
                    ->name('platform.b2b.offboardings.archive');

                Route::post('/{offboarding}/cancel', OffboardingCancelController::class)
                    ->name('platform.b2b.offboardings.cancel');

                Route::middleware('permission:record_export.create_platform')->group(function (): void {
                    Route::post('/{offboarding}/exports', RecordExportStoreController::class)
                        ->name('platform.b2b.offboardings.exports.store');

                    // One endpoint for the status and the download; `?purpose=`
                    // is what separates them. Without it this is a read of the
                    // manifest; with it, a fifteen-minute signed URL is minted
                    // *in the envelope* — never a 302, which would put an
                    // expiring credential into browser history, the referrer
                    // chain and every proxy log on the way to the bucket — and
                    // the access is audited as a Confidential read with the
                    // stated reason.
                    Route::get('/{offboarding}/exports/{export}', RecordExportShowController::class)
                        ->name('platform.b2b.offboardings.exports.show');
                });
            });
        });

        /*
        |--------------------------------------------------------------------------
        | Closure opened on a customer's behalf (J2)
        |--------------------------------------------------------------------------
        |
        | Middleware: auth:sanctum + db.context + device.touch + verified +
        | org.context + platform.context + permission:customer_account.close_platform.
        |
        | **The one endpoint on the platform that starts the deletion of a named
        | person's data**, so it takes the two-gate shape K1.1 and B1 use rather
        | than a permission alone: `platform.context` asserts the selected
        | organisation *is* the platform operator, and a tenant that somehow
        | acquired the code still cannot reach it, because an organisation type is
        | not something a tenant can grant itself.
        |
        | **There is no platform `verify` route, and there never will be.**
        | `ClosureService::verify()` refuses when the caller is the support actor;
        | the passcode goes to the *customer's* verified destination and is entered
        | by the customer. Support may open a closure and may never finish one,
        | because staff who could do both would be staff who can erase anybody —
        | the customer's inbox is the second factor and the only one they have.
        |
        | Keyed on the customer account rather than the user: an agent is looking at
        | an account, and an endpoint taking a `users` identifier would make "which
        | person is this login" a lookup against a table they have no other reason
        | to read. `b2c` only — a corporate account belongs to the company and is
        | B2's to offboard.
        |
        */
        Route::middleware(['org.context', 'platform.context', 'permission:customer_account.close_platform'])
            ->post('/platform/customer-accounts/{account}/closure-requests', PlatformClosureRequestStoreController::class)
            ->name('platform.customer-accounts.closure-requests.store');

        /*
        |--------------------------------------------------------------------------
        | Organisation invitations (B1)
        |--------------------------------------------------------------------------
        |
        | Middleware: auth:sanctum + db.context + device.touch + verified +
        | org.context + permission. No `platform.context`: inviting a colleague is a
        | tenant's own business.
        |
        | The `{organisation}` in the path is checked against the organisation
        | `org.context` validated a membership against, and a mismatch is **404** —
        | "no such organisation, as far as you are concerned" rather than a hint
        | that another tenant exists.
        |
        | **The token never appears in a response body or a log.** `issue()` returns
        | the plaintext once, for the mail; only its SHA-256 reaches the database.
        | That is what makes a database read, a backup and a replica all useless for
        | accepting an invitation — and it is why re-inviting issues a new token and
        | revokes the old rather than resending the original.
        |
        | RLS NOTE — recorded here because it is a decision, not an omission.
        | `organisation_invitations` carries **no PostgreSQL policy**. The accept
        | path resolves a row by hashed token *before* the acceptor is a member of
        | anything, so an org-match policy would fail closed on exactly the request
        | the table exists to serve; and publishing the token hash into a session
        | variable so a policy could match on it would be strictly worse than the
        | token itself — it would put the credential onto the database connection,
        | visible to every statement on it, to protect a row whose only secret is
        | that credential. Isolation is the token plus the `organisation_id`
        | predicate the locator and the list controller apply.
        |
        | DELETE stamps `revoked_at`; nothing is removed. Who was invited and who
        | withdrew it is exactly the trail an access review reads.
        |
        */
        Route::middleware('org.context')->prefix('/organisations/{organisation}')->group(function (): void {
            Route::post('/invitations', OrganisationInvitationStoreController::class)
                ->middleware('permission:membership.invite_organisation')
                ->name('organisations.invitations.store');

            Route::get('/invitations', OrganisationInvitationIndexController::class)
                ->middleware('permission:membership.view_organisation')
                ->name('organisations.invitations.index');

            // The same authority as ending a membership: withdrawing an offer somebody
            // has not yet accepted and removing somebody who has are the same decision
            // taken at two moments.
            Route::delete('/invitations/{invitation}', OrganisationInvitationRevokeController::class)
                ->middleware('permission:membership.end_organisation')
                ->name('organisations.invitations.revoke');
        });

        /*
        |--------------------------------------------------------------------------
        | Accepting an invitation (B1)
        |--------------------------------------------------------------------------
        |
        | Middleware: auth:sanctum + db.context + device.touch + verified. **No
        | `org.context`, and that absence is the entire point** — the acceptor is
        | not a member of anything yet, so requiring an organisation context would
        | mean requiring the membership this request exists to create. They must be
        | signed in, so acceptance is attributable, and email-verified, so the
        | identity is reachable.
        |
        | Every failure — wrong token, expired, revoked, already accepted — is the
        | same 404 with the same message. Distinguishing them would tell somebody
        | holding a guessed token that they guessed right.
        |
        | B1 acceptance was a **shell**: the row was marked accepted and the
        | membership write was not performed. PA1 published
        | `InvitationMembershipGranter` and bound it in the platform administration
        | module, so acceptance now creates the membership and its role, and
        | `membership_created` reports what actually happened rather than a
        | permanent `false`. One thing did tighten: the signed-in user's own email
        | must be the address the invitation was sent to, which answers 403 — the
        | one failure here that cannot confirm a guessed token, because the caller
        | already holds a valid one.
        |
        */
        Route::post('/invitations/{token}/accept', InvitationAcceptController::class)
            ->name('invitations.accept');

        /*
        |------------------------------------------------------------------
        | Platform administration — kitchen tenants (PA1)
        |------------------------------------------------------------------
        |
        | Two gates, as everywhere else on `/platform`: `platform.context`
        | asserts the selected organisation is the platform operator, and
        | `permission` asserts the member holds the platform code. A tenant
        | that somehow acquired `organisation.manage_platform` still cannot
        | reach these routes, because organisation type is not something a
        | tenant can grant itself.
        |
        | **One code for the whole console**, unlike B1's four. A B2B
        | application is a case file several people work in turn, so reading
        | the queue, moving the file and settling it are separable
        | authorities. Tenant lifecycle is not a workflow: whoever may see the
        | list of kitchens is the same person trusted to create one and to
        | suspend one. Splitting it would produce a "viewer" role nobody would
        | ever be given.
        |
        | **Lifecycle is sub-resource actions, never `PATCH status`.** A PATCH
        | would accept `closed` from a console with no business offboarding
        | anybody, would need a state machine in a validator, and would make
        | suspend and reactivate the same request with a different string in
        | it. Both carry `precondition`: two operators sharing a console is the
        | ordinary case, and last-write-wins on "may this business trade" is
        | not a defensible way to settle it.
        |
        | Creating a kitchen carries `idempotency` for the reason provisioning
        | does — a tenant cannot be un-created, and a retry that produced a
        | second one would be discovered by whoever went looking for the first.
        |
        | Revoking an owner is `POST .../revoke`, not `DELETE`, because nothing
        | is deleted: the membership becomes `ended` and stays as the record
        | that this person was an owner. The **last** owner may be revoked —
        | the platform acts deliberately — and `remaining_owners` comes back so
        | the console can warn rather than the API refusing.
        |
        */
        Route::middleware(['org.context', 'platform.context', 'permission:organisation.manage_platform'])
            ->prefix('/platform/organisations/kitchens')
            ->group(function (): void {
                Route::get('/', PlatformKitchenIndexController::class)
                    ->name('platform.organisations.kitchens.index');

                Route::post('/', PlatformKitchenStoreController::class)
                    ->middleware('idempotency')
                    ->name('platform.organisations.kitchens.store');

                Route::get('/{organisation}', PlatformKitchenShowController::class)
                    ->name('platform.organisations.kitchens.show');

                Route::post('/{organisation}/suspend', PlatformKitchenSuspendController::class)
                    ->middleware('precondition')
                    ->name('platform.organisations.kitchens.suspend');

                Route::post('/{organisation}/reactivate', PlatformKitchenReactivateController::class)
                    ->middleware('precondition')
                    ->name('platform.organisations.kitchens.reactivate');

                Route::post('/{organisation}/owners/invitations', PlatformKitchenOwnerInvitationController::class)
                    ->name('platform.organisations.kitchens.owners.invitations.store');

                Route::post('/{organisation}/owners/{membership}/revoke', PlatformKitchenOwnerRevokeController::class)
                    ->name('platform.organisations.kitchens.owners.revoke');
            });
    });
});

/*
|--------------------------------------------------------------------------
| Reading an invitation (PA1)
|--------------------------------------------------------------------------
|
| **Anonymous, and outside the authenticated group on purpose.** The mailed
| link lands somebody on a screen that has to render *before* it can ask them
| to sign in: "join Cedar Kitchen as an owner" is the reason to sign in, and
| putting `auth:sanctum` in front of it would be asking a person to
| authenticate into something nobody has told them the name of. The token is
| the capability, exactly as `X-Guest-Token` is for the guest family above.
|
| It reads and nothing else. The token is not consumed, no state moves, and
| acceptance keeps every gate it had — `POST /invitations/{token}/accept` is
| still signed-in, email-verified, and address-matched.
|
| `throttle:invitation-lookup` replaces the `api` group's limiter for this one
| route: twenty a minute per address rather than sixty, because this is the
| only anonymous read on the platform where a *wrong* answer is still an
| answer. Unknown tokens and purged ones share the same 404.
|
*/
Route::get('/invitations/{token}', InvitationShowController::class)
    ->middleware('throttle:invitation-lookup')
    ->name('invitations.show');

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

/*
|--------------------------------------------------------------------------
| Guest journey (G1)
|--------------------------------------------------------------------------
|
| Buying without an account, and asking to be forgotten afterwards.
|
| **Three credential regimes in one family, and the routing table is where they
| are visible.** Two routes are anonymous because they must be — a session has
| to be obtainable by somebody holding nothing, and an erasure request arrives
| from somebody with no account to sign into. Six carry `guest.session`, the
| capability-token counterpart to `auth:sanctum`: `X-Guest-Token` resolved into
| a live session, with one indistinguishable `401 guest.session_invalid` for
| unknown, expired, revoked and under-graded. One carries
| `guest.session:place_order`, the grade a proven contact point buys.
|
| The grade is a middleware parameter rather than a check inside the controller
| so that "this endpoint needs a verified contact" is readable beside the path.
| An order is a promise that somebody will be told when it is late, and a
| destination nobody proved is a promise made to a typo.
|
| **No `auth:sanctum`, no `db.context`, no `org.context` anywhere in this
| family.** A guest is a member of no organisation and holds no user, so there
| is no identity for the database session variables to carry and no membership
| for an organisation context to validate. `OrderPlacementService` runs the
| placement inside `SellerContext::during()`, which is where the seller's
| tenancy is established — by the service, from the cart, rather than by a
| header the caller chose.
|
| **`idempotency` runs after `guest.session`, and the order matters.**
| `EnforceIdempotency` keys a replay on the authenticated user or, failing that,
| on the guest customer account published by `guest.session`. Declared the other
| way round it would find neither and pass every guest checkout straight
| through, silently.
|
| `POST /guest/sessions` deliberately does **not** carry `idempotency`: a
| replayed session start would have to return the original plaintext token,
| which is not stored and cannot be reproduced. `POST /guest/convert` does not
| either — a repeated registration is refused by the unique email, which is a
| better answer than a replayed envelope claiming an account was made twice.
|
| Rate limiting is the `api` group's throttle (60/min per IP for an anonymous
| caller). The two anonymous routes here are the ones that most want a tighter
| bucket of their own; noted for the integrator rather than assumed.
|
*/

// ANONYMOUS. The only response in the platform that carries a plaintext guest
// token, and the only place it will ever exist — the row stores a digest. The
// IP and User-Agent are hashed in the controller from what the connection
// carried; neither is accepted in the body, because a caller who can choose
// their own fingerprint does not have one.
Route::post('/guest/sessions', GuestSessionStoreController::class)
    ->name('guest.sessions.store');

// `guest.session`. The session's own state, never the token. A dead token is
// answered by the middleware's 401, which is the useful answer: the client
// starts a new session rather than parsing a body that describes a session it
// may not use.
Route::get('/guest/session', GuestSessionShowController::class)
    ->middleware('guest.session')
    ->name('guest.session.show');

// `guest.session`. Issues the `guest_order` passcode against a destination the
// guest supplied. 202: a challenge is a message in flight, not a resource the
// caller may then read.
Route::post('/guest/contacts', GuestContactStoreController::class)
    ->middleware('guest.session')
    ->name('guest.contacts.store');

// `guest.session`. The passcode comes back and the session is promoted to
// `place_order`. The challenge is resolved scoped to the session's own customer
// account — anything else is a 404, because "that challenge exists but is not
// yours" only ever helps somebody it should not help.
Route::post('/guest/contacts/verify', GuestContactVerifyController::class)
    ->middleware('guest.session')
    ->name('guest.contacts.verify');

// `guest.session:place_order` then `idempotency`, in that order. The same body,
// the same `OrderPlacementService` and the same refusals as the authenticated
// `POST /orders`; what differs is only which credential got the caller here.
// The cart and the address are loaded scoped to the session's account.
Route::post('/guest/orders', GuestOrderStoreController::class)
    ->middleware(['guest.session:place_order', 'idempotency'])
    ->name('guest.orders.store');

// `guest.session`. Scoped to the session's account; every miss is a 404. A
// signed-URL alternative is deferred to the phase that owns customer messaging
// — see the controller docblock for why a second credential with a longer life
// and no revocation story is not worth minting in advance of the surface that
// needs it.
Route::get('/guest/orders/{order}', GuestOrderShowController::class)
    ->middleware('guest.session')
    ->name('guest.orders.show');

// `guest.session`. Registration and conversion in one transaction: a registered
// user whose guest account never converted, or a guest account pointed at a
// user that was rolled back, are both states nobody can repair. Validation is
// delegated wholesale to `CreateNewUser` rather than restated in a form
// request. The guest token is revoked by the conversion and stops working with
// this response.
Route::post('/guest/convert', GuestConvertController::class)
    ->middleware('guest.session')
    ->name('guest.convert');

// ANONYMOUS, necessarily. Always 202, always the same body, whether or not the
// address is known: `GuestDeletionAcknowledgement` is built entirely from the
// submitted value and from configuration, and `GuestDeletionEnumerationTest`
// asserts that on the whole serialised result.
Route::post('/guest/deletion-requests', GuestDeletionRequestStoreController::class)
    ->name('guest.deletion-requests.store');

// ANONYMOUS. Also always 202, with one indistinguishable refusal shape covering
// a wrong code, any code against an unknown address, an expired challenge and a
// locked-out contact. Enumeration resistance survives the second step or it was
// never there.
Route::post('/guest/deletion-requests/verify', GuestDeletionVerifyController::class)
    ->name('guest.deletion-requests.verify');

/*
|--------------------------------------------------------------------------
| Public marketplace (M1)
|--------------------------------------------------------------------------
|
| The consumer's read-only view of the catalogue: kitchens with their branches,
| delivery zones and operating weeks; published meals with their allergens,
| price and ordering calendar; published subscription plans.
|
| Anonymous, for the reason the public vocabularies above are: a marketplace a
| person has to sign in to browse is not a marketplace. Rate limiting is the
| `api` group's (60/min per IP for an anonymous caller).
|
| **Read-only, and structurally so.** There is no writer here and there will not
| be one: what a customer *does* — a cart, an order, a subscription — is C1 and
| S1, against their own tables and their own permissions. This family serves
| projections of rows other surfaces own.
|
| Every response goes through a PublicProjection presenter (master plan v2
| §4.8). No cost, margin, supplier, recipe line, cost snapshot, data-quality
| note, review reason or internal price-list identifier is representable in any
| shape these routes can return, and a Pest sweep asserts that across the whole
| anonymous surface with a seeded distinctive cost literal.
|
| `{kitchen}`, `{meal}` and `{plan}` accept an identifier or the row's own
| stable slug, the same convention the kitchen-admin routes use: a client that
| walked the list holds one, a human holding a link holds the other.
|
*/
Route::get('/marketplace/kitchens', PublicKitchenIndexController::class)
    ->name('marketplace.kitchens.index');
Route::get('/marketplace/kitchens/{kitchen}', PublicKitchenShowController::class)
    ->name('marketplace.kitchens.show');

Route::get('/marketplace/meals', PublicMealIndexController::class)
    ->name('marketplace.meals.index');
Route::get('/marketplace/meals/{meal}', PublicMealShowController::class)
    ->name('marketplace.meals.show');

// `meal-plans`, not `plans`: the consumer contract's path, and the one word that
// keeps a subscription plan distinguishable from a meal plan a dietitian writes
// (the planner's `/meal-plans` under an authenticated prefix is N1's, and the
// two never share a route because they never share a table).
Route::get('/marketplace/meal-plans', PublicMealPlanIndexController::class)
    ->name('marketplace.meal-plans.index');
Route::get('/marketplace/meal-plans/{plan}', PublicMealPlanShowController::class)
    ->name('marketplace.meal-plans.show');
