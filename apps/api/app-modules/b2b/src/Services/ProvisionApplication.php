<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\ApplicationContactRole;
use Healthy360\B2b\Enums\ApplicationStatus;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\B2bApplicationContact;
use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Services\CustomerAccountNumbers;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Models\Country;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Random\RandomException;

/**
 * Turning an approval into a tenant: the one transaction that makes a company
 * real.
 *
 * Approval is a judgement and this is its consequence, and the two are
 * deliberately separate acts behind separate permissions
 * (`b2b_application.decide_platform`, `b2b_application.provision_platform`).
 * An approval can be revisited; a provisioned organisation cannot be
 * un-provisioned, because the moment it exists people can be invited into it
 * and rows can be written under it.
 *
 * ## One transaction, and a replay is safe
 *
 * Everything below happens inside a single `DB::transaction`, over a row lock
 * on the application. A second call finds `provisioned_organisation_id`
 * already set and **returns the existing records rather than refusing**. That
 * is the behaviour a retry needs: the endpoint additionally demands an
 * `Idempotency-Key`, but a key only protects an identical repeat of the same
 * HTTP request, and a reviewer who clicked twice from two tabs has two
 * requests. The database's partial unique indexes on
 * `provisioned_organisation_id` and `customer_account_id` are the floor under
 * both.
 *
 * ## What is created, and what deliberately is not
 *
 * 1. **An `Organisation`** of type `corporate_customer`, `active`. The name is
 *    the legal name the applicant gave, and the slug is derived from it and
 *    made unique — never chosen by the applicant, because a slug is an
 *    addressable, effectively permanent identifier and letting an unvetted
 *    form claim one invites squatting on a competitor's name.
 * 2. **A `CustomerAccount`** of type `b2b`, origin `b2b_provisioning`. Written
 *    here rather than through `CustomerAccountLifecycle`, **because that class
 *    has no B2B opener and its `activate()` cannot be made to work for one**:
 *    the activation evaluator asks D2C questions — a verified email on a
 *    *user*, a served delivery address, an answered allergy declaration — and
 *    a corporate account has no user to answer them. Routing through it would
 *    leave every provisioned buyer stuck in `provisional`, unable to trade,
 *    with nothing in the platform able to move them. The row is therefore
 *    created directly, satisfying by hand every CHECK the table states:
 *    `account_type = 'b2b'` with `organisation_id` present (the b2b shape
 *    check), `status = 'active'` with `activated_at` set (the activated-at
 *    check), and an `origin` from the declared vocabulary. The account is
 *    opened **active** rather than provisional on the authority of the
 *    approval itself — `CustomerAccountType::usesSelfServiceActivation()`
 *    already says a B2B account is activated by this transaction, "which has
 *    its own gates (KYC, agreement, credit)", and the approval is that gate.
 * 3. **The links back.** `b2b_applications.provisioned_organisation_id` and
 *    `.customer_account_id` are stamped together — the table's CHECK requires
 *    both or neither — and every agreement on the application takes the new
 *    `organisation_id`. Every version, not only the one in force: a superseded
 *    draft is no less that company's than the active one, and the
 *    `(organisation_id, status)` index exists to list them together.
 * 4. **Invitations**, one per named contact that has an email.
 *
 * **No memberships are created.** `InvitationService::accept()` says so on its
 * own result object, and this service does not quietly disagree: a membership
 * is granted when a named person signs in and accepts, not when a reviewer
 * clicks provision. Creating memberships here would mean minting access for
 * addresses nobody has proved control of — the exact failure the invitation
 * token exists to prevent.
 *
 * ## The role a contact is invited into
 *
 * The `primary` contact — or the `signatory` where no primary was named —
 * becomes `organisation_owner`; everybody else becomes `member`. Somebody has
 * to be able to invite colleagues and manage the new organisation on day one,
 * and the primary contact is the company's own nomination for who that is.
 * Everybody else gets the narrowest template role there is, because a billing
 * clerk listed on a form has not asked for administrative authority and
 * handing it out by default is how an organisation acquires four owners.
 *
 * An address that is not a valid email is **skipped and counted** rather than
 * aborting the transaction. `InvitationService::issue()` applies exactly the
 * same `filter_var` test, so nothing that passes here can be refused there;
 * and the alternative — rolling the whole provisioning back over a typo in a
 * billing contact — would strand an approved company behind a field its
 * applicant can no longer edit. The skip is recorded on the audit event, so it
 * is visible rather than silent.
 *
 * ## Why the database session is switched for one insert
 *
 * `customer_accounts` carries a row-level-security policy whose `WITH CHECK`
 * admits a row only if it belongs to the session's user or to the session's
 * organisation. During provisioning the session is the reviewer inside the
 * *platform operator* organisation, and the row being written belongs to the
 * customer's brand-new one, so the policy would — correctly — refuse it. The
 * insert therefore runs inside `DatabaseTenantContext::during()`, which
 * declares the new organisation for exactly that statement and restores the
 * reviewer's context afterwards whatever happens. It is the documented,
 * explicit counterpart of `withoutTenancy()`; the alternative would be
 * weakening a policy that is right, for one caller that is exceptional.
 */
final readonly class ProvisionApplication
{
    /**
     * The template role the company's nominated contact is invited into.
     */
    private const string OWNER_ROLE = 'organisation_owner';

    /**
     * The template role every other named contact is invited into.
     */
    private const string MEMBER_ROLE = 'member';

    public function __construct(
        private InvitationService $invitations,
        private CustomerAccountNumbers $accountNumbers,
        private DatabaseTenantContext $database,
        private AuditRecorder $audit,
    ) {}

    /**
     * @return array{organisation: Organisation, customerAccount: CustomerAccount, agreement: B2bAgreement|null, invitations: int}
     *
     * @throws ApiException
     * @throws RandomException
     */
    public function provision(B2bApplication $application, User $actor): array
    {
        return DB::transaction(function () use ($application, $actor): array {
            $locked = B2bApplication::query()->whereKey($application->getKey())->lockForUpdate()->first();

            if (! $locked instanceof B2bApplication) {
                throw new ApiException(ErrorCode::ResourceNotFound);
            }

            $replay = $this->alreadyProvisioned($locked);

            if ($replay !== null) {
                return $replay;
            }

            if ($locked->status !== ApplicationStatus::Approved) {
                throw new ApiException(
                    ErrorCode::B2bApplicationStateInvalid,
                    'Only an approved application can be provisioned.',
                    [
                        'status' => $locked->status->value,
                        'required_status' => ApplicationStatus::Approved->value,
                        'current_lock_version' => $locked->lock_version,
                    ],
                );
            }

            $organisation = $this->createOrganisation($locked, $actor);
            $account = $this->openCustomerAccount($organisation, $actor);

            $locked->forceFill([
                'provisioned_organisation_id' => (string) $organisation->getKey(),
                'customer_account_id' => (string) $account->getKey(),
                'updated_by' => (string) $actor->getKey(),
                'lock_version' => $locked->lock_version + 1,
            ])->save();

            $agreement = $this->anchorAgreements($locked, $organisation);
            $invited = $this->inviteContacts($locked, $organisation, $actor);

            $this->audit->record(
                'b2b.application_provisioned',
                actorUserId: (string) $actor->getKey(),
                subjectType: 'b2b_application',
                subjectId: (string) $locked->getKey(),
                metadata: [
                    'reference' => $locked->reference,
                    'organisation_id' => (string) $organisation->getKey(),
                    'organisation_slug' => $organisation->slug,
                    'customer_account_id' => (string) $account->getKey(),
                    'agreement_id' => $agreement instanceof B2bAgreement ? (string) $agreement->getKey() : null,
                    'invitations_issued' => $invited['issued'],
                    // Named `invitations_skipped` rather than anything ending
                    // in `_code`: the audit recorder's redaction list matches
                    // `code` as a substring and would blank the value
                    // (OQ-036, R-019).
                    'invitations_skipped' => $invited['skipped'],
                ],
            );

            return [
                'organisation' => $organisation,
                'customerAccount' => $account,
                'agreement' => $agreement,
                'invitations' => $invited['issued'],
            ];
        });
    }

    /**
     * The records a replayed provision returns.
     *
     * Null when the application has never been provisioned. When it has, both
     * links are present — the table's CHECK says they move together — so a
     * missing record here is corruption rather than a state to tolerate, and
     * it fails loudly.
     *
     * @return array{organisation: Organisation, customerAccount: CustomerAccount, agreement: B2bAgreement|null, invitations: int}|null
     *
     * @throws ApiException
     */
    private function alreadyProvisioned(B2bApplication $application): ?array
    {
        $organisationId = $this->stamped($application, 'provisioned_organisation_id');

        if ($organisationId === null) {
            return null;
        }

        $accountId = $this->stamped($application, 'customer_account_id');
        $organisation = Organisation::query()->whereKey($organisationId)->first();
        $account = $accountId === null
            ? null
            : $this->database->during(null, $organisationId, null, static fn (): ?CustomerAccount => CustomerAccount::query()->whereKey($accountId)->first());

        if (! $organisation instanceof Organisation || ! $account instanceof CustomerAccount) {
            throw new ApiException(
                ErrorCode::ServerInternalError,
                'This application is marked provisioned but its records cannot be read.',
            );
        }

        return [
            'organisation' => $organisation,
            'customerAccount' => $account,
            'agreement' => $this->activeAgreement($application),
            // Nothing was issued *by this call*, and reporting the historical
            // count would let a caller mistake a replay for fresh work.
            'invitations' => 0,
        ];
    }

    /**
     * @throws ApiException
     */
    private function createOrganisation(B2bApplication $application, User $actor): Organisation
    {
        $type = OrganisationType::query()->where('code', 'corporate_customer')->first();

        if (! $type instanceof OrganisationType) {
            throw new ApiException(
                ErrorCode::ServerInternalError,
                'The corporate customer organisation type is missing from the platform vocabulary.',
            );
        }

        $name = $this->companyName($application);
        $country = $application->country_code;

        if ($country === null || trim($country) === '') {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'This application does not say which country the company is registered in.',
                ['fields' => ['country_code' => ['A company cannot be provisioned without a country.']]],
            );
        }

        $organisation = new Organisation;
        $organisation->organisation_type_id = (string) $type->getKey();
        $organisation->name = $name;
        $organisation->slug = $this->uniqueSlug($name, $application->reference);
        $organisation->country_code = mb_strtoupper($country);
        $organisation->default_currency_code = $this->currency($application, mb_strtoupper($country));
        $organisation->default_language_code = $this->language($application);
        $organisation->status = OrganisationStatus::Active;
        $organisation->created_by = (string) $actor->getKey();
        $organisation->save();

        return $organisation;
    }

    /**
     * @throws RandomException
     */
    private function openCustomerAccount(Organisation $organisation, User $actor): CustomerAccount
    {
        $number = $this->accountNumbers->next();
        $now = CarbonImmutable::now();

        return $this->database->during(
            (string) $actor->getKey(),
            (string) $organisation->getKey(),
            null,
            static fn (): CustomerAccount => CustomerAccount::query()->create([
                'account_number' => $number,
                'account_type' => CustomerAccountType::B2b,
                'user_id' => null,
                'organisation_id' => $organisation->getKey(),
                'status' => CustomerAccountStatus::Active,
                'origin' => CustomerAccountOrigin::B2bProvisioning,
                'display_name' => $organisation->name,
                'preferred_language_code' => $organisation->default_language_code,
                'country_code' => $organisation->country_code,
                'activated_at' => $now,
                'last_activity_at' => $now,
                // Deliberately null. `provisional_expires_at` is the abandonment
                // window for an account somebody started and walked away from;
                // a provisioned corporate account is never abandoned in that
                // sense, and `CustomerAccountOrigin::B2bProvisioning` is not
                // purgeable anyway. A date here would be a deadline nothing
                // acts on.
                'provisional_expires_at' => null,
                'created_by' => $actor->getKey(),
                'updated_by' => $actor->getKey(),
            ]),
        );
    }

    /**
     * Stamp the organisation onto every version of the company's agreement,
     * and hand back the one in force.
     */
    private function anchorAgreements(B2bApplication $application, Organisation $organisation): ?B2bAgreement
    {
        B2bAgreement::query()
            ->where('b2b_application_id', $application->getKey())
            ->update([
                'organisation_id' => $organisation->getKey(),
                'updated_at' => now(),
            ]);

        return $this->activeAgreement($application);
    }

    private function activeAgreement(B2bApplication $application): ?B2bAgreement
    {
        return B2bAgreement::query()
            ->where('b2b_application_id', $application->getKey())
            ->where('status', AgreementStatus::Active->value)
            ->orderByDesc('version')
            ->first();
    }

    /**
     * @return array{issued: int, skipped: int}
     *
     * @throws ApiException
     */
    private function inviteContacts(B2bApplication $application, Organisation $organisation, User $actor): array
    {
        $contacts = B2bApplicationContact::query()
            ->where('b2b_application_id', $application->getKey())
            ->get();

        /** @var array<string, string> $reachable role value => email */
        $reachable = [];
        $skipped = 0;

        foreach ($contacts as $contact) {
            $email = $contact->email === null ? '' : trim($contact->email);

            if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                $skipped++;

                continue;
            }

            $reachable[$contact->role->value] = $email;
        }

        $owner = $this->ownerRoleAmong($reachable);
        $issued = 0;

        foreach ($reachable as $role => $email) {
            $this->invitations->issue(
                $organisation,
                $email,
                $role === $owner ? self::OWNER_ROLE : self::MEMBER_ROLE,
                $actor,
                null,
                'Your company has been approved to buy on Healthy360. Accept this invitation to take up your place.',
            );

            $issued++;
        }

        return ['issued' => $issued, 'skipped' => $skipped];
    }

    /**
     * Which reachable contact becomes the new organisation's owner.
     *
     * A precedence rather than a single nomination, because the alternative is
     * an organisation with no administrator at all: a company that named only
     * a billing contact would otherwise be provisioned with four members and
     * nobody able to invite a fifth. The order is the order of who speaks for
     * the company — its named counterparty, then the person who signed, then
     * whoever handles the money, then operations — and one of them always wins
     * when the list is non-empty.
     *
     * @param  array<string, string>  $reachable
     */
    private function ownerRoleAmong(array $reachable): ?string
    {
        foreach ([
            ApplicationContactRole::Primary,
            ApplicationContactRole::Signatory,
            ApplicationContactRole::Billing,
            ApplicationContactRole::Operations,
        ] as $role) {
            if (array_key_exists($role->value, $reachable)) {
                return $role->value;
            }
        }

        return null;
    }

    /**
     * The company's name, in the order of what a human would recognise.
     */
    private function companyName(B2bApplication $application): string
    {
        foreach ([$application->legal_name, $application->trading_name, $application->legal_name_ar] as $candidate) {
            if (is_string($candidate) && trim($candidate) !== '') {
                return mb_substr(trim($candidate), 0, 255);
            }
        }

        return $application->reference;
    }

    /**
     * A unique, server-authored slug.
     *
     * `Str::slug` returns the empty string for a name written entirely in a
     * non-Latin script, which is a real case here — an applicant may give only
     * `legal_name_ar`. The application reference is the fallback because it is
     * already unique, already printable and already the thing a support call
     * starts with.
     *
     * @throws ApiException
     */
    private function uniqueSlug(string $name, string $reference): string
    {
        $base = Str::slug($name);

        if ($base === '') {
            $base = Str::slug($reference);
        }

        $base = mb_substr($base, 0, 200);
        $candidate = $base;

        for ($suffix = 2; $suffix < 50; $suffix++) {
            if (! Organisation::query()->where('slug', $candidate)->exists()) {
                return $candidate;
            }

            $candidate = $base.'-'.$suffix;
        }

        throw new ApiException(
            ErrorCode::ServerInternalError,
            'A unique organisation slug could not be allocated.',
        );
    }

    /**
     * What the new tenant trades in: what the applicant asked for, or failing
     * that what their country uses.
     *
     * @throws ApiException
     */
    private function currency(B2bApplication $application, string $countryCode): string
    {
        $requested = $application->currency_code;

        if (is_string($requested) && trim($requested) !== '') {
            return mb_strtoupper(trim($requested));
        }

        $country = Country::query()->whereKey($countryCode)->first();
        $fallback = $country?->default_currency_code;

        if (! is_string($fallback) || trim($fallback) === '') {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'This application does not say what currency it trades in, and its country has no default.',
                ['fields' => ['currency_code' => ['A currency is needed before an organisation can be created.']]],
            );
        }

        return mb_strtoupper($fallback);
    }

    /**
     * The new tenant's default language: the applicant's own, because they are
     * the person who will read the first screens.
     */
    private function language(B2bApplication $application): string
    {
        $profile = UserProfile::query()->where('user_id', $application->applicant_user_id)->first();
        $preferred = $profile?->preferred_language_code;

        if (is_string($preferred) && trim($preferred) !== '') {
            return mb_strtolower(trim($preferred));
        }

        $configured = config('app.locale', 'en');

        return is_string($configured) && $configured !== '' ? mb_strtolower($configured) : 'en';
    }

    private function stamped(B2bApplication $application, string $attribute): ?string
    {
        $value = $application->getAttribute($attribute);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
