<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\ApplicationSection;
use Healthy360\B2b\Enums\ApplicationStatus;
use Healthy360\B2b\Enums\DocumentKind;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\KycDocument;
use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\B2b\Services\AgreementService;
use Healthy360\B2b\Tests\Fixtures\B2bWorld;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationType;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| The B2B HTTP surface, end to end
|--------------------------------------------------------------------------
|
| ApplicationStateMachineTest proves the workflow through the service, and
| KycDocumentStorageTest proves the bytes go somewhere private. Neither of them
| sends a request, which means neither of them proves that the *wiring* holds:
| the routes, the two-gate platform middleware, `If-Match`, `Idempotency-Key`,
| multipart uploads, the envelope, and the fact that provisioning creates a
| tenant exactly once however many times it is called.
|
| That is this file's job, and it is a smoke test rather than a second copy of
| the domain suites: one long named path plus the five refusals that would be
| catastrophic if they silently stopped happening.
|
*/

beforeEach(function (): void {
    // The full seed, for the same reason AllergenClassApiTest takes it: the
    // platform-operator organisation and the bespoke role carrying the
    // platform permission codes are the only supported way to hold
    // `b2b_application.*_platform`, and DemoTenantSeeder is where that grant
    // is expressed. A test that hand-built the grant would be asserting
    // against its own fixture rather than against the platform's.
    $this->seed();

    Storage::fake('private');

    $this->applicant = B2bWorld::applicant();

    $this->platform = Organisation::query()->where('slug', 'healthy360-operations')->sole();
    $this->reviewer = User::query()->where('email', 'ops@healthy360.test')->sole();

    // Two gates on every platform route: the selected organisation must *be*
    // the platform operator, and the member must hold the code.
    $this->platformHeaders = firstPartyHeaders() + ['X-Organisation-Id' => (string) $this->platform->getKey()];

    $this->corporateCustomer = OrganisationType::query()->where('code', 'corporate_customer')->sole();
});

/**
 * Every success in this API is `{data, meta.correlation_id}` (conventions.md),
 * and a response that carries the right payload under the wrong envelope is a
 * client-side outage nobody notices until integration.
 */
function b2bSmokeEnvelope(TestResponse $response): TestResponse
{
    expect($response->json('data'))->toBeArray()
        ->and($response->json('meta.correlation_id'))->toBeString()->not->toBe('');

    return $response;
}

/**
 * Every failure is `{error: {code, message, details, correlation_id}}`. The
 * correlation identifier is the half that matters in support: an error a user
 * cannot quote back is an error nobody can find in the logs.
 */
function b2bSmokeError(TestResponse $response, string $code): TestResponse
{
    $error = $response->json('error');

    expect($error)->toBeArray()
        ->and($error)->toHaveKeys(['code', 'message', 'details', 'correlation_id'])
        ->and($error['code'])->toBe($code)
        ->and($error['message'])->toBeString()->not->toBe('')
        ->and($error['correlation_id'])->toBeString()->not->toBe('');

    return $response;
}

/**
 * @return array<string, string>
 */
function b2bSmokeIfMatch(int $lockVersion): array
{
    return ['If-Match' => '"'.$lockVersion.'"'];
}

/**
 * Change who is calling, the way a deployed request boundary would.
 *
 * **Two things have to be forgotten, and the house helper only covers one.**
 * `forgetResolvedGuards()` drops the guard cached from the previous request.
 * The session store is the other half: it is a singleton for the whole test
 * process and `Store::loadSession()` merges into whatever it already held, so
 * `password_hash_web` from the previous caller survives the next request — and
 * `Sanctum\AuthenticateSession` then compares the new caller against it and
 * logs them straight back out with a 401. Tests that swap between two
 * `User::factory()` users never meet this, because the factory reuses one hash
 * for every user it makes; this file swaps an applicant for a *seeded*
 * reviewer, whose hash is genuinely different.
 *
 * That middleware is right and the production behaviour is the one we want —
 * a session belongs to the person who opened it. What is wrong is a test
 * pretending one session serves two people.
 */
function b2bSmokeActAs(User $user): void
{
    forgetResolvedGuards();

    app('session')->driver()->flush();

    app('auth')->guard()->setUser($user);
    app('auth')->shouldUse(null);
}

/**
 * An application already carrying the decision provisioning demands, written
 * straight to the row because the point of the test using it is what happens
 * *at* `/provision` rather than how the application got there.
 */
function b2bSmokeApprovedApplication(User $applicant): B2bApplication
{
    /** @var B2bApplication $application */
    $application = B2bApplication::factory()->create(['applicant_user_id' => $applicant->getKey()]);

    // Both timestamps: the table's CHECKs refuse an approved row without them.
    $application->forceFill([
        'status' => ApplicationStatus::Approved,
        'submitted_at' => now()->subDay(),
        'decided_at' => now(),
    ])->save();

    return $application;
}

/**
 * An upload whose leading bytes really are a PDF's and whose *remaining* bytes
 * are unique to the kind it is being posted as.
 *
 * `B2bWorld::pdfUpload()` writes one fixed body, which is right for the storage
 * suite and wrong here: `KycDocumentService::store()` treats the same digest
 * against the same owner as one document and returns the existing row, kind and
 * all. Two required documents carrying identical bytes would therefore collapse
 * into one and submission would refuse the pack — a real trap, and not one this
 * test should walk into while claiming to have uploaded two.
 */
function b2bSmokePdf(DocumentKind $kind): UploadedFile
{
    return UploadedFile::fake()->createWithContent(
        $kind->value.'.pdf',
        "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Subject (".$kind->value.") >>\nendobj\n%%EOF\n",
    );
}

/**
 * Every string anywhere in a decoded body, however deep.
 *
 * @return list<string>
 */
function b2bSmokeStrings(mixed $value): array
{
    if (is_string($value)) {
        return [$value];
    }

    if (! is_array($value)) {
        return [];
    }

    $strings = [];

    foreach ($value as $item) {
        foreach (b2bSmokeStrings($item) as $string) {
            $strings[] = $string;
        }
    }

    return $strings;
}

it('walks an application from a blank draft to a provisioned tenant, and answers a replay from the tenant it already made', function (): void {
    $this->actingAs($this->applicant);

    // 1. The draft. No body: a draft is a container, and everything arrives
    //    through the section PATCHes.
    $created = b2bSmokeEnvelope(
        $this->postJson('/api/v1/b2b/applications', [], firstPartyHeaders())->assertCreated()
    );

    $id = $created->json('data.application.id');
    $version = $created->json('data.application.lock_version');

    expect($created->json('data.application.status'))->toBe('draft')
        ->and($created->headers->get('ETag'))->toBe('"'.$version.'"');

    // 2. The three sections submission requires, filled from the enum's own
    //    answer about what "required" means rather than from a list typed here
    //    that would go on passing after a field was added.
    $answers = [
        'legal_name' => 'Cedars Catering SAL',
        'country_code' => 'LB',
        'commercial_registration_number' => 'CR-1234/56',
        'signatory_name' => 'Nadia Haddad',
        'signatory_title' => 'Managing Director',
        'signatory_email' => 'nadia@cedars.test',
        'requested_payment_terms' => 'net_30',
    ];

    foreach (ApplicationSection::requiredForSubmission() as $section) {
        $payload = [];

        foreach ($section->requiredFields() as $field) {
            expect($answers)->toHaveKey($field);

            $payload[$field] = $answers[$field];
        }

        $saved = b2bSmokeEnvelope(
            $this->patchJson(
                "/api/v1/b2b/applications/{$id}/sections/{$section->value}",
                $payload,
                firstPartyHeaders() + b2bSmokeIfMatch($version),
            )->assertOk()
        );

        // The validator moves on every write, so the next PATCH has to carry
        // the version this one produced. A test that reused the first ETag
        // would be asserting that `If-Match` is not enforced.
        expect($saved->json('data.application.lock_version'))->toBeGreaterThan($version);

        $version = $saved->json('data.application.lock_version');
    }

    // The people the company names. Provisioning invites them, so without this
    // the tenant is created with nobody able to enter it — and `PUT` carries no
    // `If-Match` because a set replaced whole in one transaction has no
    // half-list for a validator to protect.
    b2bSmokeEnvelope(
        $this->putJson("/api/v1/b2b/applications/{$id}/contacts", [
            'contacts' => [
                ['role' => 'primary', 'name' => 'Nadia Haddad', 'title' => 'Managing Director', 'email' => 'nadia@cedars.test'],
                ['role' => 'billing', 'name' => 'Rami Khoury', 'email' => 'accounts@cedars.test'],
            ],
        ], firstPartyHeaders())->assertOk()
    );

    // 3. The document pack — the one multipart endpoint in the family. The
    //    service sniffs the leading bytes, so the fixture writes a real PDF
    //    signature rather than a file of the right length.
    $documents = [];

    foreach (DocumentKind::requiredForB2bSubmission() as $kind) {
        $uploaded = b2bSmokeEnvelope(
            $this->post("/api/v1/b2b/applications/{$id}/documents", [
                'file' => b2bSmokePdf($kind),
                'document_kind' => $kind->value,
            ], firstPartyHeaders() + ['Accept' => 'application/json'])->assertCreated()
        );

        expect($uploaded->json('data.document.document_kind'))->toBe($kind->value);

        $documents[] = $uploaded->json('data.document.id');
    }

    expect($documents)->toHaveCount(2);

    // 4. The reviewer's verdict on each file, under both stacked codes.
    b2bSmokeActAs($this->reviewer);

    foreach ($documents as $documentId) {
        $reviewed = b2bSmokeEnvelope(
            $this->postJson("/api/v1/platform/b2b/documents/{$documentId}/review", ['verdict' => 'accepted'], $this->platformHeaders)->assertOk()
        );

        expect($reviewed->json('data.document.review_status'))->toBe('accepted');
    }

    // 5. Send it.
    b2bSmokeActAs($this->applicant);

    $submitted = b2bSmokeEnvelope(
        $this->postJson("/api/v1/b2b/applications/{$id}/submit", [], firstPartyHeaders() + b2bSmokeIfMatch($version))->assertOk()
    );

    expect($submitted->json('data.application.status'))->toBe('submitted');

    $version = $submitted->json('data.application.lock_version');

    // 6. Claim, then approve. Two permissions, two acts.
    b2bSmokeActAs($this->reviewer);

    $claimed = b2bSmokeEnvelope(
        $this->postJson("/api/v1/platform/b2b/applications/{$id}/claim", [], $this->platformHeaders + b2bSmokeIfMatch($version))->assertOk()
    );

    expect($claimed->json('data.application.status'))->toBe('in_review')
        ->and($claimed->json('data.application.reviewed_by'))->toBe((string) $this->reviewer->getKey());

    $version = $claimed->json('data.application.lock_version');

    $approved = b2bSmokeEnvelope(
        $this->postJson("/api/v1/platform/b2b/applications/{$id}/approve", [
            'internal_note' => 'Registration and identity both check out.',
            'applicant_message' => 'Welcome aboard.',
        ], $this->platformHeaders + b2bSmokeIfMatch($version))->assertOk()
    );

    expect($approved->json('data.application.status'))->toBe('approved')
        // Approval decides and creates nothing. The links are still empty.
        ->and($approved->json('data.application.provisioned_organisation_id'))->toBeNull()
        ->and($approved->json('data.application.customer_account_id'))->toBeNull();

    // 7. Provision — 200 rather than 201, because several records were created
    //    and no one of them is *the* thing this endpoint made.
    //
    // The demo seed already stands up a corporate customer of its own, so "no
    // second tenant" is a claim about the delta this flow produces, not about
    // the table's absolute count. Baseline it here — approval created nothing
    // (asserted above) — and the whole provision/replay/reuse sequence must move
    // it by exactly one.
    $corporateCustomersBefore = Organisation::query()
        ->where('organisation_type_id', $this->corporateCustomer->getKey())
        ->count();

    $key = 'provision-'.Str::uuid()->toString();

    $provisioned = b2bSmokeEnvelope(
        $this->postJson(
            "/api/v1/platform/b2b/applications/{$id}/provision",
            [],
            $this->platformHeaders + ['Idempotency-Key' => $key],
        )->assertOk()
    );

    $organisationId = $provisioned->json('data.organisation.id');
    $accountId = $provisioned->json('data.customer_account.id');

    expect($provisioned->json('data.organisation.type'))->toBe('corporate_customer')
        ->and($provisioned->json('data.organisation.name'))->toBe('Cedars Catering SAL')
        ->and($provisioned->json('data.organisation.status'))->toBe('active')
        ->and($provisioned->json('data.customer_account.account_type'))->toBe('b2b')
        ->and($provisioned->json('data.customer_account.status'))->toBe('active')
        ->and($provisioned->json('data.customer_account.organisation_id'))->toBe($organisationId)
        // One per reachable contact, so the company can actually get in.
        ->and($provisioned->json('data.invitations_issued'))->toBeGreaterThanOrEqual(1)
        // The links are stamped together — the table's CHECK says they move
        // together — and the response reports the row it just wrote.
        ->and($provisioned->json('data.application.provisioned_organisation_id'))->toBe($organisationId)
        ->and($provisioned->json('data.application.customer_account_id'))->toBe($accountId)
        ->and($provisioned->headers->get('Idempotency-Replayed'))->toBeNull();

    expect(Organisation::query()->whereKey($organisationId)->exists())->toBeTrue()
        ->and(CustomerAccount::query()->whereKey($accountId)->where('organisation_id', $organisationId)->exists())->toBeTrue()
        ->and(OrganisationInvitation::query()->where('organisation_id', $organisationId)->count())
        ->toBe($provisioned->json('data.invitations_issued'));

    $application = B2bApplication::query()->whereKey($id)->sole();

    expect($application->getAttribute('provisioned_organisation_id'))->toBe($organisationId)
        ->and($application->getAttribute('customer_account_id'))->toBe($accountId);

    // 8. The replay. Same key, same body, same path — so the middleware answers
    //    from the stored envelope and the command never runs a second time.
    $replay = b2bSmokeEnvelope(
        $this->postJson(
            "/api/v1/platform/b2b/applications/{$id}/provision",
            [],
            $this->platformHeaders + ['Idempotency-Key' => $key],
        )->assertOk()
    );

    expect($replay->headers->get('Idempotency-Replayed'))->toBe('true')
        ->and($replay->json('data.organisation.id'))->toBe($organisationId)
        ->and($replay->json('data.customer_account.id'))->toBe($accountId);

    // The claim the whole mechanism exists to make: no second tenant.
    expect(Organisation::query()->where('organisation_type_id', $this->corporateCustomer->getKey())->count())->toBe($corporateCustomersBefore + 1)
        ->and(CustomerAccount::query()->where('organisation_id', $organisationId)->count())->toBe(1);

    // 9. The same key against a *different* application. `fingerprint()` hashes
    //    METHOD|path|body and the path names the application, so this is
    //    genuinely "same key, different request" — and the key is scoped by the
    //    route *name*, which is identical for both, so the two collide exactly
    //    where they should. No separate different-body case is needed.
    $other = b2bSmokeApprovedApplication(B2bWorld::applicant('second@b2b.test'));

    $reused = $this->postJson(
        "/api/v1/platform/b2b/applications/{$other->getKey()}/provision",
        [],
        $this->platformHeaders + ['Idempotency-Key' => $key],
    )->assertStatus(409);

    b2bSmokeError($reused, 'request.idempotency_key_reused');

    // Refused before the controller ran: still just the one this flow made.
    expect(Organisation::query()->where('organisation_type_id', $this->corporateCustomer->getKey())->count())->toBe($corporateCustomersBefore + 1)
        ->and($other->fresh()?->getAttribute('provisioned_organisation_id'))->toBeNull();
});

it('refuses to send an application whose document pack is short, and names the kind that is missing', function (): void {
    // The factory fills every field submission requires, so the only thing
    // wrong here is the pack — which is what makes the *code* meaningful.
    $application = B2bApplication::factory()->create(['applicant_user_id' => $this->applicant->getKey()]);

    KycDocument::factory()->forApplication($application)->ofKind(DocumentKind::CommercialRegistration)->create();

    $this->actingAs($this->applicant);

    $response = $this->postJson(
        "/api/v1/b2b/applications/{$application->getKey()}/submit",
        [],
        firstPartyHeaders() + b2bSmokeIfMatch($application->lock_version),
    )->assertStatus(422);

    b2bSmokeError($response, 'b2b.documents_incomplete');

    // A missing document has its own code because it is a different act to fix,
    // and both lists travel either way so nothing is hidden by the choice.
    expect($response->json('error.details.missing_documents'))->toBe(['signatory_identification'])
        ->and($response->json('error.details.missing_fields'))->toBe([])
        ->and($application->fresh()?->status)->toBe(ApplicationStatus::Draft);
});

it('refuses to provision without an idempotency key, because a tenant cannot be un-created', function (): void {
    $application = b2bSmokeApprovedApplication($this->applicant);

    $this->actingAs($this->reviewer);

    // The demo seed stands up a corporate customer of its own, so "no tenant was
    // made" is that this count does not move, not that it is zero.
    $corporateCustomersBefore = Organisation::query()
        ->where('organisation_type_id', $this->corporateCustomer->getKey())
        ->count();

    // The `idempotency` middleware only enforces semantics when a key is
    // present, so an endpoint that must never run twice by accident has to
    // demand one itself. This is the assertion that the controller does.
    $response = $this->postJson(
        "/api/v1/platform/b2b/applications/{$application->getKey()}/provision",
        [],
        $this->platformHeaders,
    )->assertStatus(400);

    b2bSmokeError($response, 'request.invalid');

    expect($response->json('error.details.header'))->toBe('Idempotency-Key')
        ->and(Organisation::query()->where('organisation_type_id', $this->corporateCustomer->getKey())->count())->toBe($corporateCustomersBefore)
        ->and($application->fresh()?->getAttribute('provisioned_organisation_id'))->toBeNull();
});

it('refuses a signature that no passcode stands behind', function (): void {
    $application = B2bApplication::factory()->create(['applicant_user_id' => $this->applicant->getKey()]);

    $agreements = app(AgreementService::class);
    $agreement = $agreements->draft($application, 'Supply agreement', ['payment_terms' => 'net_30'], $this->applicant);
    $agreements->sendForSignature($agreement, $this->applicant);

    $this->actingAs($this->applicant);

    // A challenge identifier that names nothing. The lookup is by owner *and*
    // purpose before any code is compared, so this refusal costs the real
    // signatory none of their three attempts — and it says only that it did
    // not work, never which of the conditions failed.
    $response = $this->postJson(
        "/api/v1/b2b/applications/{$application->getKey()}/agreements/{$agreement->getKey()}/sign",
        [
            'challenge_id' => Str::uuid()->toString(),
            'code' => '123456',
            'signatory_name' => 'Nadia Haddad',
            'signatory_title' => 'Managing Director',
            'document_sha256' => hash('sha256', 'the exact bytes the signatory was shown'),
            'consent_statement' => 'I accept these terms on behalf of the company.',
        ],
        firstPartyHeaders(),
    )->assertForbidden();

    b2bSmokeError($response, 'b2b.signatory_required');

    $unsigned = $agreement->fresh();

    expect($unsigned?->status)->toBe(AgreementStatus::PendingSignature)
        ->and($unsigned?->signed_at)->toBeNull()
        ->and($unsigned?->signatory_user_id)->toBeNull();
});

it('answers a stranger reading another company application with 404 rather than 403', function (): void {
    $application = B2bApplication::factory()->create(['applicant_user_id' => $this->applicant->getKey()]);

    $this->actingAs(B2bWorld::applicant('stranger@b2b.test'));

    // 403 would confirm the identifier names a real application, which turns
    // the identifier into a probe for which companies have applied.
    $response = $this->getJson("/api/v1/b2b/applications/{$application->getKey()}", firstPartyHeaders())
        ->assertNotFound();

    b2bSmokeError($response, 'resource.not_found');
});

it('issues an invitation without ever putting the token in the response', function (): void {
    $kitchen = Organisation::query()->where('slug', 'verdant-kitchen')->sole();
    $owner = User::query()->where('email', 'owner@verdant.test')->sole();

    $this->actingAs($owner);

    $response = b2bSmokeEnvelope(
        $this->postJson("/api/v1/organisations/{$kitchen->getKey()}/invitations", [
            'email' => 'buyer@cedars.test',
            'role_code' => 'member',
            'message' => 'Join us on Healthy360.',
        ], firstPartyHeaders() + ['X-Organisation-Id' => (string) $kitchen->getKey()])->assertCreated()
    );

    $invitation = OrganisationInvitation::query()->whereKey($response->json('data.invitation.id'))->sole();

    expect($response->json('data.invitation.status'))->toBe('live')
        ->and($response->json('data.invitation'))->not->toHaveKey('token')
        ->and($response->json('data.invitation'))->not->toHaveKey('token_hash')
        ->and((string) json_encode($response->json()))->not->toContain($invitation->token_hash);

    // Stronger than "there is no `token` key". The plaintext is thirty-two
    // random characters and could hide inside any string on the wire, so every
    // string in the body is hashed the way `InvitationService` hashes the token
    // and compared with what was stored. None of them is it — which is what
    // makes "the platform cannot resend the original" true rather than
    // intended.
    foreach (b2bSmokeStrings($response->json()) as $value) {
        expect(hash('sha256', $value))->not->toBe($invitation->token_hash);
    }
});
