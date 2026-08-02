<?php

declare(strict_types=1);

use Healthy360\B2b\Enums\ApplicationSection;
use Healthy360\B2b\Enums\ApplicationStatus;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Services\ApplicationService;
use Healthy360\B2b\Tests\Fixtures\B2bWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Api\Exceptions\ApiException;

/*
|--------------------------------------------------------------------------
| The application workflow does what it says
|--------------------------------------------------------------------------
|
| The second always-on net for B1 (SPEED MODE). Five claims:
|
|  1. The legal path runs end to end.
|  2. An illegal move is refused, loudly, naming what would have been legal.
|  3. Submission is decided by the server from the data present — including
|     the required *documents* — not by the applicant's progress claim.
|  4. A section PATCH refuses a field it does not own rather than dropping it.
|  5. A duplicate registration surfaces and never blocks.
|
*/

beforeEach(function (): void {
    // Countries and currencies: an application names the country its
    // registration was issued in, and that is a foreign key into the platform
    // reference tables rather than a free-text field.
    $this->seed(ReferenceDataSeeder::class);

    $this->applicant = B2bWorld::applicant();
    $this->reviewer = B2bWorld::reviewer();
    $this->service = app(ApplicationService::class);
});

it('runs the whole legal path from draft to approved', function (): void {
    $application = B2bWorld::readyApplication($this->applicant);

    $this->service->submit($application, $this->applicant);
    expect($application->status)->toBe(ApplicationStatus::Submitted)
        ->and($application->submitted_at)->not->toBeNull();

    $this->service->startReview($application, $this->reviewer);
    expect($application->status)->toBe(ApplicationStatus::InReview);

    $this->service->requestInformation($application, $this->reviewer, 'Your trade licence has expired.', [ApplicationSection::Company]);
    expect($application->status)->toBe(ApplicationStatus::InfoRequested)
        ->and($application->information_requested_sections)->toBe(['company']);

    // The applicant answers and it rejoins the queue as submitted — not
    // straight back to in_review, because whether a reviewer picks it up again
    // is the reviewer's decision.
    $this->service->updateSection($application, ApplicationSection::Company, ['legal_name' => 'Cedars Catering SAL'], $this->applicant);
    $this->service->submit($application, $this->applicant);
    expect($application->status)->toBe(ApplicationStatus::Submitted)
        ->and($application->information_request)->toBeNull();

    $this->service->approve($application, $this->reviewer, 'Registration and ID both check out.');

    expect($application->status)->toBe(ApplicationStatus::Approved)
        ->and($application->decided_at)->not->toBeNull()
        ->and($application->status->isTerminal())->toBeTrue();
});

it('refuses an illegal transition and says what would have been legal', function (): void {
    $application = B2bApplication::factory()->declined()->create(['applicant_user_id' => $this->applicant->getKey()]);

    try {
        $this->service->startReview($application, $this->reviewer);
        $this->fail('A declined application should not be reviewable.');
    } catch (ApiException $exception) {
        expect($exception->errorCode->value)->toBe('resource.conflict')
            ->and($exception->details['status'])->toBe('declined')
            ->and($exception->details['requested_status'])->toBe('in_review')
            ->and($exception->details['allowed_transitions'])->toBe([]);
    }

    expect($application->fresh()?->status)->toBe(ApplicationStatus::Declined);
});

it('decides completeness itself, and reports every gap at once', function (): void {
    // The applicant claims every section is done. The server does not care —
    // `completed_sections` is a progress claim, not a check — and the required
    // documents are checked too, because a wizard checklist is not something
    // an API client has.
    $application = B2bApplication::factory()->empty()->create([
        'applicant_user_id' => $this->applicant->getKey(),
        'completed_sections' => ['company', 'signatory', 'trade_terms', 'logistics'],
    ]);

    try {
        $this->service->submit($application, $this->applicant);
        $this->fail('An empty application should not be submittable.');
    } catch (ApiException $exception) {
        expect($exception->errorCode->value)->toBe('validation.failed')
            ->and($exception->details['missing_fields'])->toContain('legal_name', 'signatory_name', 'requested_payment_terms')
            ->and($exception->details['missing_documents'])->toBe(['commercial_registration', 'signatory_identification']);
    }

    expect($application->fresh()?->status)->toBe(ApplicationStatus::Draft);
});

it('refuses a field the named section does not own rather than dropping it', function (): void {
    $application = B2bApplication::factory()->create(['applicant_user_id' => $this->applicant->getKey()]);

    $write = fn () => $this->service->updateSection(
        $application,
        ApplicationSection::Logistics,
        ['legal_name' => 'Somebody Else SAL'],
        $this->applicant,
    );

    expect($write)->toThrow(ApiException::class);

    // The point of refusing rather than ignoring: nothing was written, and the
    // client was told so.
    expect($application->fresh()?->legal_name)->not->toBe('Somebody Else SAL');
});

it('surfaces a matching registration without blocking the application', function (): void {
    $other = B2bApplication::factory()->declined()->create([
        'applicant_user_id' => B2bWorld::applicant('earlier@b2b.test')->getKey(),
        'commercial_registration_number' => 'CR-1234/56',
        'commercial_registration_normalised' => 'CR123456',
    ]);

    $application = B2bWorld::readyApplication($this->applicant);

    // The same registration, punctuated differently — which is exactly how it
    // arrives when two people type it from the same certificate.
    $this->service->updateSection(
        $application,
        ApplicationSection::Company,
        ['commercial_registration_number' => 'cr 1234 56'],
        $this->applicant,
    );

    expect($application->commercial_registration_normalised)->toBe('CR123456');

    $matches = $this->service->duplicateMatches($application);

    expect($matches)->toHaveCount(1)
        ->and($matches[0]->getKey())->toBe($other->getKey());

    // Surfaced, never acted on: submission goes through, and the reviewer
    // decides what the match means.
    $this->service->submit($application, $this->applicant);

    expect($application->status)->toBe(ApplicationStatus::Submitted)
        ->and($application->duplicate_of_application_id)->toBeNull();
});
