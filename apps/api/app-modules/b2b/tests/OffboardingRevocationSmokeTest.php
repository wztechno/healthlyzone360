<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\OffboardingStatus;
use Healthy360\B2b\Enums\OffboardingTrigger;
use Healthy360\B2b\Models\B2bApplicationContact;
use Healthy360\B2b\Services\OffboardingService;
use Healthy360\B2b\Services\OffboardingSignoff;
use Healthy360\B2b\Tests\Fixtures\B2bWorld;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Identity\Models\PersonalAccessToken;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Revocation takes the organisation's access, and only the organisation's
|--------------------------------------------------------------------------
|
| The one always-on net for B2's revocation (SPEED MODE; the wider suite is on
| the deferred list in the hand-over). It exists because the sole-membership
| token rule is invisible in review and expensive to get wrong in both
| directions: too broad and a contractor is signed out of three other
| companies because one of their clients left; too narrow and somebody whose
| only reason to have a token was an organisation that no longer exists keeps
| one indefinitely.
|
| Three people, deliberately:
|
|  - **sole** — this organisation was their only membership and they hold no
|    customer account. Their tokens go.
|  - **shared** — also a member elsewhere. Their tokens stay, and so does the
|    other membership.
|  - **shopper** — sole member here, but they also shop on the platform as a
|    consumer. Their tokens stay, because their cart is not their employer's.
|
| Plus the four consequences that make the wind-up real: the organisation
| closes, the agreement terminates, personal data is purged, and the legal
| entity is not.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);

    $this->world = B2bWorld::provisionedWorld();
    $this->organisation = $this->world['organisation'];
    $this->operator = B2bWorld::reviewer();
    $this->offboardings = app(OffboardingService::class);
});

it('revokes only this organisation, keeps a shared member signed in elsewhere, and closes the tenant', function (): void {
    $sole = User::factory()->create(['email' => 'sole@acme.test']);
    $shared = User::factory()->create(['email' => 'shared@contractor.test']);
    $shopper = User::factory()->create(['email' => 'shopper@acme.test']);

    B2bWorld::member($this->organisation, $sole);
    B2bWorld::member($this->organisation, $shared);
    B2bWorld::member($this->organisation, $shopper);

    // The shared member's other life: a membership in an unrelated
    // organisation that this offboarding has no business touching.
    $elsewhere = B2bWorld::organisation();
    $otherMembership = B2bWorld::member($elsewhere, $shared);

    // The shopper's other life: their own consumer account.
    CustomerAccount::factory()->create([
        'account_type' => CustomerAccountType::B2c,
        'user_id' => $shopper->getKey(),
    ]);

    foreach ([$sole, $shared, $shopper] as $user) {
        $user->createToken('phone');
    }

    $offboarding = $this->offboardings->start($this->organisation, OffboardingTrigger::ClientRequest, $this->operator);
    expect($offboarding->status)->toBe(OffboardingStatus::NoticeServed)
        // Copied from the agreement, not read through it: an amendment signed
        // next week must not shorten notice already served.
        ->and($offboarding->notice_period_days)->toBe(30);

    $offboarding = $this->offboardings->runSettlementChecks($offboarding, $this->operator);
    expect($offboarding->status)->toBe(OffboardingStatus::AwaitingSignoff);

    $challenge = B2bWorld::spentSignatoryChallenge($this->world['signatory']);

    $offboarding = $this->offboardings->signOff($offboarding, new OffboardingSignoff(
        signatoryName: 'A. Signatory',
        signatoryTitle: 'Managing Director',
        consentStatement: 'I confirm this organisation is to be offboarded.',
        otpChallengeId: (string) $challenge->getKey(),
    ), $this->world['signatory']);

    expect($offboarding->status)->toBe(OffboardingStatus::SignedOff);

    // QUEUE_CONNECTION is `sync` under test, so the job runs here.
    $offboarding = $this->offboardings->revokeAccess($offboarding, $this->operator);
    $offboarding->refresh();

    expect($offboarding->status)->toBe(OffboardingStatus::Completed)
        ->and($offboarding->memberships_revoked)->toBe(3)
        // One token deletion, not three. `shared` keeps theirs because they
        // are a member elsewhere; `shopper` keeps theirs because they hold a
        // customer account of their own.
        ->and($offboarding->tokens_deleted)->toBe(1);

    expect(PersonalAccessToken::query()->where('tokenable_id', $sole->getKey())->count())->toBe(0)
        ->and(PersonalAccessToken::query()->where('tokenable_id', $shared->getKey())->count())->toBe(1)
        ->and(PersonalAccessToken::query()->where('tokenable_id', $shopper->getKey())->count())->toBe(1);

    // The shared user's unrelated membership is untouched and still active —
    // the claim the whole rule exists to protect.
    $otherMembership->refresh();
    expect($otherMembership->status)->toBe(MembershipStatus::Active);

    $endedHere = OrganisationMembership::withoutTenancy()
        ->where('organisation_id', $this->organisation->getKey())
        ->pluck('status')
        ->unique()
        ->all();
    expect($endedHere)->toBe([MembershipStatus::Ended]);

    $this->organisation->refresh();
    $this->world['agreement']->refresh();

    expect($this->organisation->status)->toBe(OrganisationStatus::Closed)
        ->and($this->world['agreement']->status)->toBe(AgreementStatus::Terminated)
        ->and($this->world['agreement']->terminated_at)->not->toBeNull();
});

it('purges the people named on the application and keeps the legal entity', function (): void {
    $application = $this->world['application'];

    $contact = B2bApplicationContact::query()->create([
        'b2b_application_id' => $application->getKey(),
        'role' => 'primary',
        'name' => 'Rania Haddad',
        'title' => 'Office manager',
        'email' => 'rania@acme.test',
        'phone' => '+9613000000',
    ]);

    $legalName = $application->legal_name;
    $registration = $application->commercial_registration_number;

    $offboarding = $this->offboardings->start($this->organisation, OffboardingTrigger::ContractEnd, $this->operator);
    $offboarding = $this->offboardings->runSettlementChecks($offboarding, $this->operator);

    $challenge = B2bWorld::spentSignatoryChallenge($this->world['signatory']);
    $offboarding = $this->offboardings->signOff($offboarding, new OffboardingSignoff(
        signatoryName: 'A. Signatory',
        signatoryTitle: 'Managing Director',
        consentStatement: 'I confirm this organisation is to be offboarded.',
        otpChallengeId: (string) $challenge->getKey(),
    ), $this->world['signatory']);

    $this->offboardings->revokeAccess($offboarding, $this->operator);

    $contact->refresh();
    $application->refresh();

    expect($contact->name)->toBe('[purged]')
        ->and($contact->email)->toBeNull()
        ->and($contact->phone)->toBeNull()
        ->and($application->signatory_name)->toBeNull()
        ->and($application->signatory_email)->toBeNull()
        // Retained, and this is the point: a corporate record carries
        // retention obligations the people named on it do not.
        ->and($application->legal_name)->toBe($legalName)
        ->and($application->commercial_registration_number)->toBe($registration);
});
