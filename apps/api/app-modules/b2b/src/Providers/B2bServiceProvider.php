<?php

declare(strict_types=1);

namespace Healthy360\B2b\Providers;

use Illuminate\Support\ServiceProvider;

/**
 * The B2B module binds nothing.
 *
 * Its four services — `ApplicationService`, `KycDocumentService`,
 * `InvitationService`, `AgreementService` — are constructor-injected concretes
 * the container resolves by autowiring, and the module publishes no port for
 * another module to implement. That is the same shape Delivery uses and for
 * the same reason: an interface with one implementation is indirection
 * pretending to be a boundary.
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
 * What is still genuinely absent is B2's: offboarding and record export are
 * table shells with no service and no surface.
 */
class B2bServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void {}
}
