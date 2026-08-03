<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\B2b\Enums\ApplicationContactRole;
use Healthy360\B2b\Enums\ApplicationSection;
use Healthy360\B2b\Enums\ApplicationStatus;
use Healthy360\B2b\Enums\DocumentKind;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\B2bApplicationContact;
use Healthy360\B2b\Models\B2bApplicationLocation;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;
use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Support\Facades\DB;

/**
 * The whole life of a B2B application: filling it in, sending it, and what a
 * reviewer does with it.
 *
 * ## The state machine
 *
 * `ApplicationStatus` owns the transition table; this service owns the effects
 * of each move — the timestamps, the audit event, the fields that reopen.
 * Every transition goes through one private method, so there is exactly one
 * place a state can change and exactly one place that can be wrong. An illegal
 * move is `409 b2b.application_state_invalid` naming both states and the moves
 * that *are* legal, never a silent no-op: a client that asked to approve an
 * already-declined application has a bug, and hiding it makes the bug somebody
 * else's. The dedicated code replaced the generic `resource.conflict` when the
 * HTTP surface landed — a reviewer's console has to distinguish "somebody got
 * there first" from "that is not a move this application can make", and those
 * are different screens.
 *
 * ## Section PATCH semantics
 *
 * A write names a section and carries only that section's fields.
 * Anything else is **refused**, not ignored — a payload containing
 * `legal_name` sent to the logistics step is a client that believes it saved
 * something, and dropping it quietly turns a five-minute bug into a support
 * ticket about vanishing data. The refusal says which section owns the field,
 * because that is the thing the client needs to know.
 *
 * In `info_requested` the writable set narrows to the sections the reviewer
 * named. That is the difference between "we need your trade terms again" and
 * reopening the whole form for editing while it sits in a queue.
 *
 * ## Submission
 *
 * **The server decides what complete means.** `completed_sections` is the
 * applicant's own progress claim and is never consulted here; readiness is
 * computed from the data actually present, in the spirit of §4.7's
 * readiness-evaluator-not-stored-state rule. Two things are checked: the
 * required fields of the required sections, and the required *document kinds*
 * (`DocumentKind::requiredForB2bSubmission()`), because a checklist enforced
 * only in a wizard is a checklist an API client does not have.
 *
 * Both failures come back in one response — `details.missing_fields` and
 * `details.missing_documents` — rather than one at a time. An applicant should
 * learn everything that is wrong in one round trip. The *code* is
 * `422 b2b.documents_incomplete` when anything is missing from the document
 * checklist and `422 validation.failed` when only form fields are, because
 * fixing a missing certificate is a different journey from fixing a blank
 * field and a client should not have to read a details bag to know which
 * screen to open.
 *
 * ## Duplicates
 *
 * Matching on the normalised commercial-registration and tax numbers
 * **surfaces, and never decides**. A second application against the same
 * registration is routine — a first attempt declined for something fixable, a
 * franchise group, a lapsed licence renewed — and auto-rejecting it would make
 * the platform's convenience the customer's problem. The matches are recorded
 * on the submission audit event and read by the reviewer surface;
 * `markDuplicateOf()` is a human confirming one.
 *
 * ## Authorisation
 *
 * Every method takes an explicit actor and **the caller must already have
 * authorised it** — B1's platform permission codes are the integrator's
 * (master plan v2 §4.16). What this service does enforce is ownership, which
 * is a fact rather than a policy: an applicant may only touch the application
 * they filed.
 */
final readonly class ApplicationService
{
    public function __construct(
        private IdentifierService $identifiers,
        private KycDocumentService $documents,
        private AuditRecorder $audit,
    ) {}

    /**
     * Begin an application. One live application per person — the partial
     * unique index says so and this says why.
     *
     * @throws ApiException
     */
    public function startDraft(User $applicant): B2bApplication
    {
        $live = B2bApplication::query()
            ->where('applicant_user_id', $applicant->getKey())
            ->whereIn('status', $this->liveStatusValues())
            ->first();

        if ($live instanceof B2bApplication) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'You already have an application in progress.',
                ['b2b_application_id' => (string) $live->getKey(), 'status' => $live->status->value],
            );
        }

        $application = new B2bApplication;
        $application->reference = $this->generateReference();
        $application->applicant_user_id = (string) $applicant->getKey();
        $application->status = ApplicationStatus::Draft;
        $application->completed_sections = [];
        $application->lock_version = 0;
        $application->created_by = (string) $applicant->getKey();
        $application->updated_by = (string) $applicant->getKey();
        $application->save();

        $this->audit->record(
            'b2b.application_started',
            actorUserId: (string) $applicant->getKey(),
            subjectType: 'b2b_application',
            subjectId: (string) $application->getKey(),
            metadata: ['reference' => $application->reference],
        );

        return $application;
    }

    /**
     * Write one section.
     *
     * @param  array<string, mixed>  $payload
     *
     * @throws ApiException
     */
    public function updateSection(
        B2bApplication $application,
        ApplicationSection $section,
        array $payload,
        User $actor,
        ?int $expectedLockVersion = null,
    ): B2bApplication {
        $this->assertApplicant($application, $actor);
        $this->assertSectionWritable($application, $section);

        $allowed = $section->fields();
        $changes = [];

        foreach ($payload as $field => $value) {
            if (! in_array($field, $allowed, true)) {
                $owner = ApplicationSection::owning($field);

                throw $this->invalid(
                    $field,
                    $owner instanceof ApplicationSection
                        ? "This field belongs to the {$owner->value} section, not {$section->value}."
                        : 'This is not a field on a B2B application.',
                );
            }

            $changes[$field] = is_string($value) ? $this->trimmedOrNull($value) : $value;
        }

        if ($changes === []) {
            return $application;
        }

        // The registration numbers carry a normalised twin, and it is written
        // here rather than by a model mutator so that the one place a number
        // can change is the one place its match key changes with it.
        if (array_key_exists('commercial_registration_number', $changes)) {
            $changes['commercial_registration_normalised'] = $this->normaliseRegistration($changes['commercial_registration_number']);
        }

        if (array_key_exists('tax_registration_number', $changes)) {
            $changes['tax_registration_normalised'] = $this->normaliseRegistration($changes['tax_registration_number']);
        }

        $changes['completed_sections'] = $this->withSectionMarked($application, $section);
        $changes['updated_by'] = (string) $actor->getKey();

        $this->write($application, $changes, $expectedLockVersion);

        $this->audit->record(
            'b2b.application_section_updated',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'b2b_application',
            subjectId: (string) $application->getKey(),
            metadata: [
                'section' => $section->value,
                'changed_fields' => array_values(array_diff(array_keys($changes), ['updated_by', 'completed_sections'])),
            ],
        );

        return $application;
    }

    /**
     * Replace the named contacts wholesale.
     *
     * A replace rather than a merge, for the reason every other set-valued
     * resource in the platform uses one: a client that removed a row has to be
     * able to say so, and a PATCH that only ever adds cannot express a
     * deletion.
     *
     * The element shape is `array<string, mixed>` rather than a named shape on
     * purpose: this is a client payload, and describing it as already
     * well-formed would make the validation below look redundant to a reader
     * and to a static analyser.
     *
     * @param  list<array<string, mixed>>  $contacts
     *
     * @throws ApiException
     */
    public function replaceContacts(B2bApplication $application, array $contacts, User $actor): B2bApplication
    {
        $this->assertApplicant($application, $actor);
        $this->assertEditable($application);

        $prepared = [];

        foreach ($contacts as $index => $contact) {
            $role = ApplicationContactRole::tryFrom((string) ($contact['role'] ?? ''));

            if (! $role instanceof ApplicationContactRole) {
                throw $this->invalid("contacts.{$index}.role", 'A contact is the primary, billing, operations or signatory one.');
            }

            if (array_key_exists($role->value, $prepared)) {
                throw $this->invalid("contacts.{$index}.role", "There can only be one {$role->value} contact.");
            }

            $name = $this->trimmedOrNull((string) ($contact['name'] ?? ''));
            $email = $this->trimmedOrNull((string) ($contact['email'] ?? ''));
            $phone = $this->trimmedOrNull((string) ($contact['phone'] ?? ''));

            if ($name === null) {
                throw $this->invalid("contacts.{$index}.name", 'A contact needs a name.');
            }

            if ($email === null && $phone === null) {
                throw $this->invalid("contacts.{$index}.email", 'A contact needs an email address or a phone number — otherwise nobody can reach them.');
            }

            $prepared[$role->value] = [
                'role' => $role->value,
                'name' => $name,
                'title' => $this->trimmedOrNull((string) ($contact['title'] ?? '')),
                'email' => $email,
                'phone' => $phone,
                'notes' => $this->trimmedOrNull((string) ($contact['notes'] ?? '')),
            ];
        }

        DB::transaction(function () use ($application, $prepared): void {
            B2bApplicationContact::query()->where('b2b_application_id', $application->getKey())->delete();

            foreach ($prepared as $attributes) {
                $contact = new B2bApplicationContact;
                $contact->forceFill($attributes);
                $contact->b2b_application_id = (string) $application->getKey();
                $contact->save();
            }
        });

        $this->audit->record(
            'b2b.application_contacts_replaced',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'b2b_application',
            subjectId: (string) $application->getKey(),
            metadata: ['contact_count' => count($prepared), 'roles' => array_keys($prepared)],
        );

        return $application;
    }

    /**
     * Replace the delivery and billing locations wholesale.
     *
     * @param  list<array<string, mixed>>  $locations
     *
     * @throws ApiException
     */
    public function replaceLocations(B2bApplication $application, array $locations, User $actor): B2bApplication
    {
        $this->assertApplicant($application, $actor);
        $this->assertEditable($application);

        $prepared = [];
        $primaries = 0;
        $billing = 0;

        foreach ($locations as $index => $location) {
            $label = $this->trimmedOrNull((string) ($location['label'] ?? ''));
            $line1 = $this->trimmedOrNull((string) ($location['address_line1'] ?? ''));

            if ($label === null) {
                throw $this->invalid("locations.{$index}.label", 'A location needs a name people will recognise.');
            }

            if ($line1 === null) {
                throw $this->invalid("locations.{$index}.address_line1", 'A location needs a street address.');
            }

            $isPrimary = (bool) ($location['is_primary'] ?? false);
            $isBilling = (bool) ($location['is_billing_address'] ?? false);
            $primaries += $isPrimary ? 1 : 0;
            $billing += $isBilling ? 1 : 0;

            $prepared[] = [
                'label' => $label,
                'delivery_area_id' => $this->trimmedOrNull((string) ($location['delivery_area_id'] ?? '')),
                'address_line1' => $line1,
                'address_line2' => $this->trimmedOrNull((string) ($location['address_line2'] ?? '')),
                'city' => $this->trimmedOrNull((string) ($location['city'] ?? '')),
                'country_code' => $this->upperOrNull($location['country_code'] ?? null),
                'contact_name' => $this->trimmedOrNull((string) ($location['contact_name'] ?? '')),
                'contact_phone' => $this->trimmedOrNull((string) ($location['contact_phone'] ?? '')),
                'delivery_notes' => $this->trimmedOrNull((string) ($location['delivery_notes'] ?? '')),
                'is_primary' => $isPrimary,
                'is_billing_address' => $isBilling,
                'expected_headcount' => $this->positiveOrNull($location['expected_headcount'] ?? null),
            ];
        }

        if ($primaries > 1) {
            throw $this->invalid('locations', 'Only one location can be the main delivery address.');
        }

        if ($billing > 1) {
            throw $this->invalid('locations', 'Only one location can be the billing address.');
        }

        DB::transaction(function () use ($application, $prepared): void {
            B2bApplicationLocation::query()->where('b2b_application_id', $application->getKey())->delete();

            foreach ($prepared as $attributes) {
                $location = new B2bApplicationLocation;
                $location->forceFill($attributes);
                $location->b2b_application_id = (string) $application->getKey();
                $location->save();
            }
        });

        $this->audit->record(
            'b2b.application_locations_replaced',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'b2b_application',
            subjectId: (string) $application->getKey(),
            metadata: ['location_count' => count($prepared)],
        );

        return $application;
    }

    /**
     * Send it. Everything missing comes back at once.
     *
     * @throws ApiException
     */
    public function submit(B2bApplication $application, User $actor, ?int $expectedLockVersion = null): B2bApplication
    {
        $this->assertApplicant($application, $actor);

        $missingFields = $this->missingRequiredFields($application);
        $missingDocuments = $this->missingRequiredDocuments($application);

        if ($missingFields !== [] || $missingDocuments !== []) {
            // Two failures, two codes, one payload. A missing *document* has
            // its own code because it is a different act to fix — go and find
            // a certificate, photograph it, come back — and a client that
            // wants to send the applicant to the upload step rather than to
            // the form has to be able to tell the two apart without parsing a
            // details bag. Both lists travel either way, so nothing is hidden
            // by the choice of code.
            throw new ApiException(
                $missingDocuments === [] ? ErrorCode::ValidationFailed : ErrorCode::B2bDocumentsIncomplete,
                'This application is not complete enough to send yet.',
                [
                    'missing_fields' => $missingFields,
                    'missing_documents' => $missingDocuments,
                ],
            );
        }

        $duplicates = $this->duplicateMatches($application);

        $this->transition($application, ApplicationStatus::Submitted, $actor, [
            'submitted_at' => CarbonImmutable::now(),
            'information_request' => null,
            'information_requested_sections' => null,
        ], $expectedLockVersion, [
            // Surfaced on the event, never acted on. The reviewer decides.
            'duplicate_match_count' => count($duplicates),
            'duplicate_application_ids' => array_map(static fn (B2bApplication $match): string => (string) $match->getKey(), $duplicates),
        ]);

        return $application;
    }

    /**
     * A reviewer picks it up.
     *
     * @throws ApiException
     */
    public function startReview(B2bApplication $application, User $reviewer, ?int $expectedLockVersion = null): B2bApplication
    {
        return $this->transition($application, ApplicationStatus::InReview, $reviewer, [
            'review_started_at' => CarbonImmutable::now(),
            'reviewed_by' => (string) $reviewer->getKey(),
        ], $expectedLockVersion);
    }

    /**
     * Hand it back for named sections, keeping its place in the queue.
     *
     * @param  list<ApplicationSection>  $sections
     *
     * @throws ApiException
     */
    public function requestInformation(
        B2bApplication $application,
        User $reviewer,
        string $request,
        array $sections = [],
        ?int $expectedLockVersion = null,
    ): B2bApplication {
        $message = trim($request);

        if ($message === '') {
            throw $this->invalid('information_request', 'An information request has to say what is needed.');
        }

        $named = array_values(array_unique(array_map(
            static fn (ApplicationSection $section): string => $section->value,
            $sections,
        )));

        return $this->transition($application, ApplicationStatus::InfoRequested, $reviewer, [
            'information_requested_at' => CarbonImmutable::now(),
            'information_request' => $message,
            'information_requested_sections' => $named,
            'reviewed_by' => (string) $reviewer->getKey(),
        ], $expectedLockVersion, ['sections' => $named]);
    }

    /**
     * Approve it.
     *
     * **Provisioning is not here, and its absence is deliberate.** Creating
     * the corporate organisation, the customer account, the memberships and
     * the first invitations is one idempotent transaction that spans this
     * module, Organisations, Customers and AccessControl, and it belongs to the
     * integrator wave that owns those seams (see the module docblock). What
     * approval does in B1 is record the decision — which is the part that must
     * be true whatever provisioning later does with it.
     *
     * @throws ApiException
     */
    public function approve(
        B2bApplication $application,
        User $reviewer,
        ?string $internalNote = null,
        ?string $applicantMessage = null,
        ?int $expectedLockVersion = null,
    ): B2bApplication {
        return $this->transition($application, ApplicationStatus::Approved, $reviewer, [
            'decided_at' => CarbonImmutable::now(),
            'reviewed_by' => (string) $reviewer->getKey(),
            'decision_note' => $this->trimmedOrNull($internalNote ?? ''),
            'applicant_message' => $this->trimmedOrNull($applicantMessage ?? ''),
        ], $expectedLockVersion);
    }

    /**
     * Decline it, with a reason the applicant is actually shown.
     *
     * @throws ApiException
     */
    public function decline(
        B2bApplication $application,
        User $reviewer,
        string $applicantMessage,
        ?string $internalNote = null,
        ?int $expectedLockVersion = null,
    ): B2bApplication {
        $message = trim($applicantMessage);

        if ($message === '') {
            throw $this->invalid('applicant_message', 'A decline has to tell the applicant something. An unexplained refusal is not a decision they can act on.');
        }

        return $this->transition($application, ApplicationStatus::Declined, $reviewer, [
            'decided_at' => CarbonImmutable::now(),
            'reviewed_by' => (string) $reviewer->getKey(),
            'applicant_message' => $message,
            'decision_note' => $this->trimmedOrNull($internalNote ?? ''),
        ], $expectedLockVersion);
    }

    /**
     * The applicant's own exit — distinct from a decline, and countable
     * separately for that reason.
     *
     * @throws ApiException
     */
    public function withdraw(B2bApplication $application, User $actor, ?int $expectedLockVersion = null): B2bApplication
    {
        $this->assertApplicant($application, $actor);

        return $this->transition($application, ApplicationStatus::Withdrawn, $actor, [
            'withdrawn_at' => CarbonImmutable::now(),
        ], $expectedLockVersion);
    }

    /**
     * Other applications claiming the same registration or tax number.
     *
     * Read by the reviewer surface. Never acted on automatically.
     *
     * @return list<B2bApplication>
     */
    public function duplicateMatches(B2bApplication $application): array
    {
        $commercial = $application->commercial_registration_normalised;
        $tax = $application->tax_registration_normalised;

        if ($commercial === null && $tax === null) {
            return [];
        }

        return array_values(B2bApplication::query()
            ->whereKeyNot($application->getKey())
            ->where(function ($query) use ($commercial, $tax): void {
                if ($commercial !== null && $commercial !== '') {
                    $query->orWhere('commercial_registration_normalised', $commercial);
                }

                if ($tax !== null && $tax !== '') {
                    $query->orWhere('tax_registration_normalised', $tax);
                }
            })
            ->orderByDesc('created_at')
            ->get()
            ->all());
    }

    /**
     * A human confirming that two applications are the same company.
     *
     * @throws ApiException
     */
    public function markDuplicateOf(B2bApplication $application, B2bApplication $original, User $reviewer): B2bApplication
    {
        if ($application->is($original)) {
            throw $this->invalid('duplicate_of_application_id', 'An application cannot be a duplicate of itself.');
        }

        $application->duplicate_of_application_id = (string) $original->getKey();
        $application->updated_by = (string) $reviewer->getKey();
        $application->save();

        $this->audit->record(
            'b2b.application_marked_duplicate',
            actorUserId: (string) $reviewer->getKey(),
            subjectType: 'b2b_application',
            subjectId: (string) $application->getKey(),
            metadata: ['duplicate_of_application_id' => (string) $original->getKey()],
        );

        return $application;
    }

    /**
     * The required fields the application does not have — the server's own
     * definition of complete, never the applicant's `completed_sections`.
     *
     * @return list<string>
     */
    public function missingRequiredFields(B2bApplication $application): array
    {
        $missing = [];

        foreach (ApplicationSection::requiredForSubmission() as $section) {
            foreach ($section->requiredFields() as $field) {
                $value = $application->getAttribute($field);

                if ($value === null || (is_string($value) && trim($value) === '')) {
                    $missing[] = $field;
                }
            }
        }

        return $missing;
    }

    /**
     * The document kinds the application still owes.
     *
     * A rejected or superseded document does not count; a pending one does,
     * because review happens after submission and requiring an accepted
     * document to submit would be a loop with no entrance.
     *
     * @return list<string>
     */
    public function missingRequiredDocuments(B2bApplication $application): array
    {
        $held = [];

        foreach ($this->documents->currentDocuments(DocumentOwner::application($application)) as $document) {
            $held[$document->document_kind->value] = true;
        }

        $missing = [];

        foreach (DocumentKind::requiredForB2bSubmission() as $kind) {
            if (! array_key_exists($kind->value, $held)) {
                $missing[] = $kind->value;
            }
        }

        return $missing;
    }

    /**
     * The one place a status changes.
     *
     * @param  array<string, mixed>  $changes
     * @param  array<string, scalar|list<scalar>|null>  $metadata
     *
     * @throws ApiException
     */
    private function transition(
        B2bApplication $application,
        ApplicationStatus $next,
        User $actor,
        array $changes,
        ?int $expectedLockVersion,
        array $metadata = [],
    ): B2bApplication {
        $current = $application->status;

        if (! $current->canTransitionTo($next)) {
            throw new ApiException(
                ErrorCode::B2bApplicationStateInvalid,
                "An application that is {$current->value} cannot become {$next->value}.",
                [
                    'status' => $current->value,
                    'requested_status' => $next->value,
                    'allowed_transitions' => array_map(
                        static fn (ApplicationStatus $status): string => $status->value,
                        $current->allowedTransitions(),
                    ),
                    'current_lock_version' => $application->lock_version,
                ],
            );
        }

        $changes['status'] = $next->value;
        $changes['updated_by'] = (string) $actor->getKey();

        $this->write($application, $changes, $expectedLockVersion);

        $this->audit->record(
            'b2b.application_'.$next->value,
            actorUserId: (string) $actor->getKey(),
            subjectType: 'b2b_application',
            subjectId: (string) $application->getKey(),
            metadata: $metadata + [
                'from_status' => $current->value,
                'to_status' => $next->value,
                'reference' => $application->reference,
            ],
        );

        return $application;
    }

    /**
     * The conditional update `If-Match` rests on. A null expectation means the
     * caller is not using optimistic locking on this route — the applicant's
     * own wizard does not, because there is exactly one editor.
     *
     * @param  array<string, mixed>  $changes
     *
     * @throws StaleLockVersion
     */
    private function write(B2bApplication $application, array $changes, ?int $expectedLockVersion): void
    {
        $query = B2bApplication::query()->whereKey($application->getKey());

        if ($expectedLockVersion !== null) {
            $query->where('lock_version', $expectedLockVersion);
        }

        // A query-builder update bypasses the model's casts, so the two jsonb
        // columns have to be encoded here. Doing the compare-and-swap as a
        // single conditional UPDATE is the point of this method — reading the
        // model and saving it back would open the race `If-Match` exists to
        // close — so the encoding travels with it rather than the other way
        // round.
        foreach ($changes as $column => $value) {
            if (is_array($value)) {
                $changes[$column] = json_encode($value);
            }
        }

        $affected = $query->update($changes + [
            'lock_version' => DB::raw('lock_version + 1'),
            'updated_at' => now(),
        ]);

        if ($affected === 0) {
            $current = B2bApplication::query()->whereKey($application->getKey())->value('lock_version');

            throw new StaleLockVersion(is_numeric($current) ? (int) $current : ($expectedLockVersion ?? 0));
        }

        $application->refresh();
    }

    /**
     * @throws ApiException
     */
    private function assertApplicant(B2bApplication $application, User $actor): void
    {
        if ($application->applicant_user_id !== (string) $actor->getKey()) {
            // Not a permission check — an ownership one. Whether this actor
            // may act on B2B applications at all is the caller's business;
            // whether this is *their* application is a fact.
            throw new ApiException(
                ErrorCode::ResourceNotFound,
                'The requested resource does not exist.',
            );
        }
    }

    /**
     * @throws ApiException
     */
    private function assertEditable(B2bApplication $application): void
    {
        if (! $application->status->isEditableByApplicant()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This application is with our team and cannot be changed right now.',
                ['status' => $application->status->value, 'current_lock_version' => $application->lock_version],
            );
        }
    }

    /**
     * @throws ApiException
     */
    private function assertSectionWritable(B2bApplication $application, ApplicationSection $section): void
    {
        $this->assertEditable($application);

        $writable = $application->writableSections();

        if (! in_array($section, $writable, true)) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'We only asked you to revisit: '.implode(', ', array_map(
                    static fn (ApplicationSection $open): string => $open->value,
                    $writable,
                )).'.',
                [
                    'status' => $application->status->value,
                    'writable_sections' => array_map(
                        static fn (ApplicationSection $open): string => $open->value,
                        $writable,
                    ),
                ],
            );
        }
    }

    /**
     * @return list<string>
     */
    private function withSectionMarked(B2bApplication $application, ApplicationSection $section): array
    {
        $completed = $application->completed_sections;
        $completed[] = $section->value;

        return array_values(array_unique($completed));
    }

    /**
     * Alphanumerics only, uppercased. Registration numbers are written with
     * spaces, dashes and slashes that vary between the form, the certificate
     * and the reviewer's notes; matching on the raw string would find nothing
     * and matching on a fuzzier normalisation would find everything.
     */
    private function normaliseRegistration(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $stripped = preg_replace('/[^A-Za-z0-9]/', '', $value) ?? '';

        return $stripped === '' ? null : mb_strtoupper($stripped);
    }

    /**
     * A reference a person can read over the phone. Uniqueness is the index's
     * job; the retry is here so a collision is a hiccup rather than a 500.
     */
    private function generateReference(): string
    {
        $prefix = (string) config('b2b.applications.reference_prefix', 'B2B');
        $year = CarbonImmutable::now()->format('Y');

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $suffix = mb_strtoupper(mb_substr(str_replace('-', '', $this->identifiers->generate()), -8));
            $reference = "{$prefix}-{$year}-{$suffix}";

            if (! B2bApplication::query()->where('reference', $reference)->exists()) {
                return $reference;
            }
        }

        throw new ApiException(ErrorCode::ServerInternalError, 'A reference could not be allocated.');
    }

    /**
     * @return list<string>
     */
    private function liveStatusValues(): array
    {
        return array_values(array_map(
            static fn (ApplicationStatus $status): string => $status->value,
            array_filter(ApplicationStatus::cases(), static fn (ApplicationStatus $status): bool => $status->isLive()),
        ));
    }

    private function trimmedOrNull(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function upperOrNull(mixed $value): ?string
    {
        $trimmed = is_string($value) ? trim($value) : '';

        return $trimmed === '' ? null : mb_strtoupper($trimmed);
    }

    private function positiveOrNull(mixed $value): ?int
    {
        return is_int($value) && $value > 0 ? $value : null;
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
