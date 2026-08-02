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
 * There are no routes here either, deliberately. B1's HTTP surface, its
 * OpenAPI paths, its error codes and its permission codes are wired by the
 * integrator wave, so this module ships the domain and nothing that would
 * collide with another agent's edits to the shared spec and route files.
 *
 * ## Seams the integrator closes
 *
 * 1. **Provisioning.** Approval records the decision; it does not create the
 *    corporate organisation, the customer account, the memberships or the
 *    first invitations. That is one idempotent transaction spanning
 *    Organisations, Customers and AccessControl.
 *    `b2b_applications` needs `provisioned_organisation_id` and
 *    `customer_account_id` (both nullable, both added by that wave — they are
 *    excluded here rather than added empty, so no column exists that a reader
 *    could mistake for wired-up behaviour); `b2b_agreements` needs
 *    `organisation_id` alongside its application anchor.
 * 2. **The signatory OTP.** `b2b_agreements.signature_otp_challenge_id` is a
 *    nullable uuid with no foreign key, and `AgreementService::sign()`
 *    verifies nothing. The integrator adds the constraint against
 *    `otp_challenges` and the challenge check.
 * 3. **`contact_points`.** J1's exactly-one-owner CHECK is named
 *    `contact_points_owner_check` precisely so it can be widened for
 *    `b2b_application_id`. B1 does not widen it: the applicant's contacts are
 *    unverified claims about their own staff (see
 *    `b2b_application_contacts`), and they become contact points at
 *    provisioning, not before.
 * 4. **Permissions.** Every service method takes an explicit authorised actor
 *    and trusts the caller. B1's platform permission codes and the middleware
 *    that enforces them belong to the permission wave.
 * 5. **Row-level security.** No B1 table takes a PostgreSQL policy, and
 *    `organisation_invitations` is the one that should — see its migration for
 *    why the policy has to arrive with the accept endpoint rather than before
 *    it.
 */
class B2bServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void {}
}
