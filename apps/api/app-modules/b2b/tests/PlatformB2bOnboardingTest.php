<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Services\OrganisationRoles;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\ApplicationContactRole;
use Healthy360\B2b\Enums\ApplicationStatus;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\B2bApplicationContact;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\B2b\Services\InvitationService;
use Healthy360\B2b\Tests\Fixtures\B2bWorld;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Support\Mail\NoticeMessage;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\SeedDatabaseOnce;

/*
|--------------------------------------------------------------------------
| The platform half of B2B onboarding, over HTTP
|--------------------------------------------------------------------------
|
| The routes that let a reviewer finish what an applicant starts: draft the
| agreement against a kitchen's negotiated list, send it, revise it, and —
| only once it is signed — provision, which makes the applicant the owner and
| emails everybody else an invitation.
|
*/

pest()->use(SeedDatabaseOnce::class);

beforeEach(function (): void {
    Mail::fake();

    $this->applicant = B2bWorld::applicant('owner-to-be@cedars.test');
    $this->platform = Organisation::query()->where('slug', 'healthy360-operations')->sole();
    $this->reviewer = User::query()->where('email', 'ops@healthy360.test')->sole();
    $this->kitchen = Organisation::query()->where('slug', 'verdant-kitchen')->sole();
    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => (string) $this->platform->getKey()];

    $this->application = B2bApplication::factory()->create(['applicant_user_id' => $this->applicant->getKey()]);
    $this->application->forceFill([
        'status' => ApplicationStatus::Approved,
        'submitted_at' => now()->subDay(),
        'decided_at' => now(),
    ])->save();

    $this->priceList = PriceList::factory()->active()->agreement()->create([
        'organisation_id' => $this->kitchen->getKey(),
        'currency_code' => 'USD',
    ]);

    onboardingActAs($this->reviewer);
});

/**
 * @return array<string, string>
 */
function onboardingIfMatch(int $lockVersion): array
{
    return ['If-Match' => '"'.$lockVersion.'"'];
}

/**
 * Change who is calling the way a request boundary would — the session store
 * outlives a request in tests, and `AuthenticateSession` logs out a caller whose
 * password hash differs from the last one's. See `b2bSmokeActAs()`.
 */
function onboardingActAs(User $user): void
{
    forgetResolvedGuards();
    app('session')->driver()->flush();
    app('auth')->guard()->setUser($user);
    app('auth')->shouldUse(null);
}

function onboardingError(TestResponse $response, string $code): void
{
    expect($response->json('error.code'))->toBe($code);
}

it('drafts, sends and revises an agreement, and keeps the draft from the applicant', function (): void {
    $id = $this->application->getKey();

    $drafted = $this->postJson("/api/v1/platform/b2b/applications/{$id}/agreements", [
        'title' => 'Master supply agreement',
        'payment_terms' => 'net_30',
    ], $this->headers)->assertCreated();

    $agreementId = $drafted->json('data.agreement.id');

    expect($drafted->json('data.agreement.status'))->toBe('draft')
        ->and($drafted->json('data.agreement.seller'))->toBeNull();

    // Sending without a seller list is refused, naming the field.
    $refused = $this->postJson("/api/v1/platform/b2b/agreements/{$agreementId}/send", [], $this->headers + onboardingIfMatch(0))
        ->assertStatus(422);
    expect($refused->json('error.details.fields'))->toHaveKey('price_list_id');

    // The currency follows the list.
    $updated = $this->patchJson("/api/v1/platform/b2b/agreements/{$agreementId}", [
        'price_list_id' => $this->priceList->getKey(),
        'credit_limit_minor' => 250000,
    ], $this->headers + onboardingIfMatch(0))->assertOk();

    expect($updated->json('data.agreement.currency_code'))->toBe('USD')
        ->and($updated->json('data.agreement.seller.organisation_name'))->toBe($this->kitchen->name);

    // A stale validator loses.
    $this->postJson("/api/v1/platform/b2b/agreements/{$agreementId}/send", [], $this->headers + onboardingIfMatch(0))
        ->assertStatus(409);
    onboardingActAs($this->reviewer);

    $sent = $this->postJson("/api/v1/platform/b2b/agreements/{$agreementId}/send", [], $this->headers + onboardingIfMatch(1))
        ->assertOk();

    expect($sent->json('data.agreement.status'))->toBe('pending_signature');
    Mail::assertQueued(NoticeMessage::class, fn (NoticeMessage $mail): bool => $mail->kind === 'b2b_agreement_sent' && $mail->hasTo('owner-to-be@cedars.test'));

    // Revising ends the version that was sent and opens the next as a draft.
    $revised = $this->postJson("/api/v1/platform/b2b/agreements/{$agreementId}/revise", [], $this->headers + onboardingIfMatch(2))
        ->assertCreated();

    expect($revised->json('data.agreement.version'))->toBe(2)
        ->and($revised->json('data.agreement.status'))->toBe('draft')
        ->and($revised->json('data.agreement.price_list_id'))->toBe($this->priceList->getKey())
        ->and(B2bAgreement::query()->find($agreementId)?->status)->toBe(AgreementStatus::Terminated);

    // The applicant sees what was put in front of them, never the new draft.
    onboardingActAs($this->applicant);
    $mine = $this->getJson("/api/v1/b2b/applications/{$id}/agreements", firstPartyHeaders())->assertOk();

    expect(array_column($mine->json('data'), 'status'))->toBe(['terminated']);
    $this->getJson("/api/v1/b2b/applications/{$id}/agreements/{$revised->json('data.agreement.id')}", firstPartyHeaders())
        ->assertNotFound();
});

it('refuses an agreement for an application that is not approved, and a second one beside a live one', function (): void {
    $submitted = B2bApplication::factory()->create(['applicant_user_id' => $this->applicant->getKey()]);

    $response = $this->postJson("/api/v1/platform/b2b/applications/{$submitted->getKey()}/agreements", ['title' => 'Too early'], $this->headers)
        ->assertStatus(409);
    onboardingError($response, 'b2b.application_state_invalid');

    $this->postJson("/api/v1/platform/b2b/applications/{$this->application->getKey()}/agreements", ['title' => 'First'], $this->headers)
        ->assertCreated();

    $this->postJson("/api/v1/platform/b2b/applications/{$this->application->getKey()}/agreements", ['title' => 'Second'], $this->headers)
        ->assertStatus(409);
});

it('refuses a list in another currency, and a list already pricing another company', function (): void {
    $euro = PriceList::factory()->active()->agreement()->create(['organisation_id' => $this->kitchen->getKey(), 'currency_code' => 'EUR']);

    $mismatch = $this->postJson("/api/v1/platform/b2b/applications/{$this->application->getKey()}/agreements", [
        'title' => 'Supply',
        'currency_code' => 'USD',
        'price_list_id' => $euro->getKey(),
    ], $this->headers)->assertStatus(422);
    expect($mismatch->json('error.details.fields'))->toHaveKey('price_list_id');

    $other = B2bApplication::factory()->create(['applicant_user_id' => B2bWorld::applicant('other@cedars.test')->getKey()]);
    B2bAgreement::factory()->create(['b2b_application_id' => $other->getKey(), 'price_list_id' => $this->priceList->getKey()]);

    $taken = $this->postJson("/api/v1/platform/b2b/applications/{$this->application->getKey()}/agreements", [
        'title' => 'Supply',
        'price_list_id' => $this->priceList->getKey(),
    ], $this->headers)->assertStatus(422);
    expect($taken->json('error.details.fields'))->toHaveKey('price_list_id');

    // The picker says which list is taken, and by whom.
    $lists = collect($this->getJson('/api/v1/platform/b2b/seller-price-lists', $this->headers)->assertOk()->json('data'));

    expect($lists->firstWhere('id', $this->priceList->getKey())['bound_to_application_id'])->toBe($other->getKey())
        ->and($lists->firstWhere('id', $euro->getKey())['bound_to_application_id'])->toBeNull()
        ->and($lists->firstWhere('id', $euro->getKey())['organisation_name'])->toBe($this->kitchen->name);
});

it('refuses to provision before the agreement is signed', function (): void {
    $response = $this->postJson(
        "/api/v1/platform/b2b/applications/{$this->application->getKey()}/provision",
        [],
        $this->headers + ['Idempotency-Key' => Str::uuid()->toString()],
    );

    onboardingError($response, 'b2b.application_state_invalid');
    expect($this->application->fresh()?->getAttribute('provisioned_organisation_id'))->toBeNull();
});

it('makes the applicant the owner on provision and emails every other contact an invitation', function (): void {
    foreach ([
        [ApplicationContactRole::Primary, 'owner-to-be@cedars.test'],
        [ApplicationContactRole::Billing, 'accounts@cedars.test'],
        [ApplicationContactRole::Operations, 'kitchen@cedars.test'],
    ] as [$role, $email]) {
        B2bApplicationContact::query()->create([
            'b2b_application_id' => $this->application->getKey(),
            'role' => $role,
            'name' => 'Contact '.$role->value,
            'email' => $email,
        ]);
    }

    B2bWorld::signedAgreement($this->application, $this->applicant, ['price_list_id' => $this->priceList->getKey()]);

    $provisioned = $this->postJson(
        "/api/v1/platform/b2b/applications/{$this->application->getKey()}/provision",
        [],
        $this->headers + ['Idempotency-Key' => Str::uuid()->toString()],
    )->assertOk();

    $organisationId = $provisioned->json('data.organisation.id');

    // The applicant's own address is not invited: they are already the owner.
    expect($provisioned->json('data.owner_membership_created'))->toBeTrue()
        ->and($provisioned->json('data.invitations_issued'))->toBe(2);

    $membership = OrganisationMembership::withoutTenancy()
        ->where('organisation_id', $organisationId)
        ->where('user_id', $this->applicant->getKey())
        ->sole();
    $ownerRole = Role::withoutTenancy()->where('organisation_id', $organisationId)->where('code', 'organisation_owner')->sole();

    expect(MembershipRole::withoutTenancy()->where('membership_id', $membership->getKey())->where('role_id', $ownerRole->getKey())->exists())->toBeTrue();

    // The company buys through a programme with the kitchen behind its list.
    $programme = CorporateProgramme::withoutTenancy()->where('organisation_id', $organisationId)->sole();
    expect($programme->kitchen_organisation_id)->toBe((string) $this->kitchen->getKey())
        ->and($programme->status)->toBe('active');

    Mail::assertQueued(NoticeMessage::class, fn (NoticeMessage $mail): bool => $mail->kind === 'b2b_invitation' && $mail->hasTo('accounts@cedars.test') && str_contains((string) $mail->actionUrl, '/invitations/'));
    Mail::assertQueued(NoticeMessage::class, fn (NoticeMessage $mail): bool => $mail->kind === 'b2b_invitation' && $mail->hasTo('kitchen@cedars.test'));
    Mail::assertNotQueued(NoticeMessage::class, fn (NoticeMessage $mail): bool => $mail->kind === 'b2b_invitation' && $mail->hasTo('owner-to-be@cedars.test'));
    Mail::assertQueued(NoticeMessage::class, fn (NoticeMessage $mail): bool => $mail->kind === 'b2b_application_provisioned');

    // The reviewer sees who was invited, and can send a fresh link.
    $invitations = $this->getJson("/api/v1/platform/b2b/applications/{$this->application->getKey()}/invitations", $this->headers)
        ->assertOk()
        ->json('data');

    expect(array_column($invitations, 'email'))->toEqualCanonicalizing(['accounts@cedars.test', 'kitchen@cedars.test'])
        // The applicant owns it; billing and operations are not promoted to a
        // second owner because the primary contact was the applicant.
        ->and(array_unique(array_column($invitations, 'role_code')))->toBe(['member']);

    $first = $invitations[0];

    $resent = $this->postJson(
        "/api/v1/platform/b2b/applications/{$this->application->getKey()}/invitations/{$first['id']}/resend",
        [],
        $this->headers,
    )->assertCreated();

    expect($resent->json('data.invitation.status'))->toBe('live')
        ->and($resent->json('data.invitation.id'))->not->toBe($first['id'])
        ->and(OrganisationInvitation::query()->find($first['id'])?->revoked_at)->not->toBeNull();
});

it('tells the applicant what is still missing, and an invitee where they are going', function (): void {
    $draft = B2bApplication::factory()->create(['applicant_user_id' => $this->applicant->getKey(), 'legal_name' => null]);

    onboardingActAs($this->applicant);

    $shown = $this->getJson("/api/v1/b2b/applications/{$draft->getKey()}", firstPartyHeaders())->assertOk();

    expect($shown->json('data.missing_fields'))->toContain('legal_name')
        ->and($shown->json('data.missing_documents'))->toContain('commercial_registration');

    $world = B2bWorld::provisionedWorld();
    // The fixture organisation is written directly, so it has none of the
    // roles provisioning gives every organisation.
    app(OrganisationRoles::class)->provision((string) $world['organisation']->getKey());
    $issued = app(InvitationService::class)->issue($world['organisation'], 'buyer@acme.test', 'member', $this->reviewer);

    $public = $this->getJson('/api/v1/invitations/'.$issued->token, firstPartyHeaders())->assertOk();

    expect($public->json('data.invitation.organisation.type'))->toBe('corporate_customer');
});
