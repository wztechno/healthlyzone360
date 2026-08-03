<?php

declare(strict_types=1);

namespace Healthy360\B2b\Providers;

use Healthy360\B2b\Contracts\SellerOpenOrders;
use Healthy360\B2b\Services\NoSellerOpenOrders;
use Healthy360\B2b\Services\PendingB2bSignatoryQuery;
use Healthy360\Customers\Closure\Contracts\B2bSignatoryPresence;
use Illuminate\Support\ServiceProvider;

/**
 * The B2B module binds one thing, and B2 is why.
 *
 * Its services — `ApplicationService`, `KycDocumentService`,
 * `InvitationService`, `AgreementService`, and now `OffboardingService` and
 * `ExportService` — are constructor-injected concretes the container resolves
 * by autowiring. B1 published no port at all, on the grounds that an interface
 * with one implementation is indirection pretending to be a boundary.
 *
 * **B2 publishes exactly one, and it is a real boundary.**
 * `SellerOpenOrders` asks a question only the orders module can answer — "does
 * this organisation still have anything in flight as a buyer?" — and the
 * dependency edge runs Orders → B2B, so B2B cannot call across. The default
 * bound here is `NoSellerOpenOrders`, which answers *unavailable* rather than
 * *nothing outstanding*; `SettlementRegistry` turns that into a
 * `not_applicable` with a reason instead of a green tick. Integrator-2 rebinds
 * it to the orders implementation.
 *
 * The module's HTTP surface — the applicant's own application, the KYC
 * upload and download, the platform review queue, agreement signing,
 * provisioning and organisation invitations — is declared centrally in
 * `routes/api-v1.php` like every other family on the platform. This provider
 * still registers nothing.
 *
 * ## Seams B1 declared, and what closed them
 *
 * 1. **Provisioning.** Closed. `ProvisionApplication` creates the corporate
 *    organisation, opens the B2B customer account, stamps
 *    `b2b_applications.provisioned_organisation_id` and `customer_account_id`
 *    and the agreement's `organisation_id`, and issues the first invitations —
 *    all in one transaction behind a **required** `Idempotency-Key`, because a
 *    provisioned tenant cannot be un-provisioned.
 * 2. **The signatory OTP.** Closed, and it is the seam that most needed
 *    closing. `signature_otp_challenge_id` now carries a real foreign key with
 *    `ON DELETE RESTRICT`, and `AgreementService::sign()` demands a *consumed*
 *    `b2b_signatory` challenge belonging to the person signing. Evidence a
 *    purge job can delete is not evidence, and a flag a caller can assert is
 *    not a check.
 * 3. **`contact_points`.** Closed by widening the named CHECK additively
 *    (§4.9): `b2b_application_id` is the third owner kind, and it is how the
 *    signatory's nominated destination is recorded before any account exists.
 * 4. **Permissions.** Closed. Four platform codes for the review workflow —
 *    view, review, decide, provision — plus `kyc_document.view_platform`,
 *    which is deliberately narrower than the application read: working a queue
 *    is not by itself a reason to open somebody's passport photograph.
 * 5. **Row-level security.** Decided rather than closed.
 *    `organisation_invitations` gets **no** policy, and the reasoning is
 *    recorded in D-066 and in the invitation controllers: the accept path
 *    resolves by hashed token before the acceptor is a member of anything, so
 *    an org-match policy would fail closed on the one request the table exists
 *    to serve.
 *
 * ## What B2 closed, and what the integration wave closed after it
 *
 * Offboarding and record export are no longer table shells: `OffboardingService`
 * drives the nine-state wind-up, `RevokeBusinessAccess` removes access with the
 * sole-membership token rule, and `ExportService` builds, hands over and takes
 * back the bundles. The **HTTP surface** B2 left open — routes, OpenAPI paths,
 * the permission codes and the error codes — is declared centrally in
 * `routes/api-v1.php` and `PermissionRegistry` like every other family, so this
 * provider still registers no routes.
 *
 * Both bindings B2 left to the integrator are made:
 *
 * 1. `SellerOpenOrders` → `BuyerOpenOrderQuery`, bound in
 *    `OrdersServiceProvider` over the null default registered below.
 * 2. J2's `B2bSignatoryPresence` → `PendingB2bSignatoryQuery`, bound below. B2
 *    wrote its note against a working name for that port; the reconciliation is
 *    on the B2B side, exactly as its note instructed, so the customers
 *    interface is untouched.
 */
class B2bServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // `bindIf`, not `bind`: the orders module's provider may already have
        // registered the real implementation, and a default that overwrote it
        // would silently disarm the one settlement check that works.
        $this->app->bindIf(SellerOpenOrders::class, NoSellerOpenOrders::class);

        // `bind`, not `bindIf`, and the asymmetry with the line above is
        // deliberate. There the default *is* this module's, so it must not
        // clobber a better answer; here the default belongs to the customers
        // module and is registered with `bindIf` precisely so that whichever
        // module can genuinely answer wins. A `bindIf` on both sides would make
        // the winner depend on provider order, which is how a closure screen
        // comes to report "no B2B module" in a deployment that plainly has one.
        $this->app->bind(B2bSignatoryPresence::class, PendingB2bSignatoryQuery::class);
    }

    public function boot(): void {}
}
