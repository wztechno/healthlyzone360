<?php

declare(strict_types=1);

namespace Healthy360\B2b\Tests\Fixtures;

use App\Models\User;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\ApplicationStatus;
use Healthy360\B2b\Enums\DocumentKind;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\KycDocument;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactValueHasher;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\Verification\Database\Factories\OtpChallengeFactory;
use Healthy360\Verification\Enums\OtpChallengeStatus;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Services\OtpCodeHasher;
use Illuminate\Http\UploadedFile;
use RuntimeException;

/**
 * The world the B2B suites are set in.
 *
 * A fixture class rather than Pest helper functions, for the reason
 * `DeliveryWorld` and `PricingWorld` give: Pest loads every test file in the
 * suite into one process, so two files declaring the same helper function
 * would be a fatal redeclaration rather than a test failure.
 *
 * B1 noted that there was no organisation plumbing here, and that this was the
 * shape of the phase: an application exists precisely because its applicant
 * has no organisation yet. **B2 is the phase where that stops being true** —
 * an offboarding acts on a provisioned tenant — so `provisionedWorld()` builds
 * the far end of the same story: an organisation of type `corporate_customer`,
 * an approved application linked to it, an active agreement with a named
 * signatory, and the memberships an offboarding has to end.
 */
final class B2bWorld
{
    public static function applicant(string $email = 'applicant@b2b.test'): User
    {
        return User::factory()->create(['email' => $email]);
    }

    public static function reviewer(string $email = 'reviewer@b2b.test'): User
    {
        return User::factory()->create(['email' => $email]);
    }

    /**
     * A draft carrying every required field and both required documents —
     * everything the server checks at submission, so a test asserting a
     * transition is not really asserting a validator.
     */
    public static function readyApplication(User $applicant): B2bApplication
    {
        /** @var B2bApplication $application */
        $application = B2bApplication::factory()->create(['applicant_user_id' => $applicant->getKey()]);

        foreach (DocumentKind::requiredForB2bSubmission() as $kind) {
            KycDocument::factory()->forApplication($application)->ofKind($kind)->create();
        }

        return $application;
    }

    /**
     * An upload whose leading bytes really are a PDF's.
     *
     * `UploadedFile::fake()->create()` writes a file of the requested length
     * filled with nothing, which the sniffer correctly refuses — useful for
     * the refusal case and useless for the acceptance one. This writes a real
     * signature.
     */
    public static function pdfUpload(string $name = 'registration.pdf', string $declaredMime = 'application/pdf'): UploadedFile
    {
        return self::upload($name, "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", $declaredMime);
    }

    /**
     * A file claiming to be a PDF whose bytes are a Windows executable's. The
     * mislabelled upload the sniffer exists for.
     */
    public static function disguisedExecutable(string $name = 'registration.pdf'): UploadedFile
    {
        return self::upload($name, "MZ\x90\x00\x03\x00\x00\x00This is not a PDF.", 'application/pdf');
    }

    /**
     * A provisioned corporate customer, ready to be offboarded.
     *
     * Everything `OffboardingService::start()` insists on: the organisation is
     * of type `corporate_customer`, and there is an **active** agreement
     * carrying a notice period and a signatory the platform can reach. The
     * agreement's `signatory_user_id` is the signatory user, because that is
     * whose passcode a sign-off demands — not the operator's.
     *
     * @return array{
     *     organisation: Organisation,
     *     application: B2bApplication,
     *     agreement: B2bAgreement,
     *     signatory: User,
     *     account: CustomerAccount
     * }
     */
    public static function provisionedWorld(?User $signatory = null, int $noticePeriodDays = 30): array
    {
        $signatory ??= User::factory()->create(['email' => 'signatory@acme.test']);

        $type = OrganisationType::query()->firstOrCreate(
            ['code' => 'corporate_customer'],
            ['name_en' => 'Corporate customer', 'name_ar' => 'عميل مؤسسي', 'is_active' => true],
        );

        $organisation = self::organisation(['organisation_type_id' => $type->getKey()]);

        /** @var CustomerAccount $account */
        $account = CustomerAccount::factory()->create([
            'account_type' => CustomerAccountType::B2b,
            'user_id' => null,
            'organisation_id' => $organisation->getKey(),
            'status' => CustomerAccountStatus::Active,
            'activated_at' => now(),
            'provisional_expires_at' => null,
        ]);

        /** @var B2bApplication $application */
        $application = B2bApplication::factory()->create([
            'status' => ApplicationStatus::Approved,
            'submitted_at' => now()->subMonths(7),
            'decided_at' => now(),
            'provisioned_organisation_id' => $organisation->getKey(),
            'customer_account_id' => $account->getKey(),
        ]);

        ContactPoint::factory()->verified()->create([
            'user_id' => $signatory->getKey(),
            'value_normalised' => $signatory->email,
            'value_hash' => app(ContactValueHasher::class)->hash($signatory->email),
            'is_login_identity' => true,
        ]);

        // An active agreement carries complete click-wrap evidence — four
        // columns and a spent challenge, all of them enforced by CHECKs. The
        // fixture satisfies them by hand rather than driving `AgreementService`
        // through a full signing, because what these tests assert is what
        // happens at the *other* end of the relationship.
        $signingChallenge = self::spentSignatoryChallenge($signatory);

        /** @var B2bAgreement $agreement */
        $agreement = B2bAgreement::factory()->create([
            'b2b_application_id' => $application->getKey(),
            'organisation_id' => $organisation->getKey(),
            'status' => AgreementStatus::Active,
            'notice_period_days' => $noticePeriodDays,
            'signatory_user_id' => $signatory->getKey(),
            'signatory_name' => 'A. Signatory',
            'signatory_title' => 'Managing Director',
            'signature_document_sha256' => hash('sha256', 'master-supply-agreement-v1'),
            'signature_consent_statement' => 'I accept these terms on behalf of the company.',
            'signature_otp_challenge_id' => $signingChallenge->getKey(),
            'signed_at' => now()->subMonths(6),
            'activated_at' => now()->subMonths(6),
        ]);

        return [
            'organisation' => $organisation,
            'application' => $application,
            'agreement' => $agreement,
            'signatory' => $signatory,
            'account' => $account,
        ];
    }

    /**
     * An organisation whose reference codes are the seeded ones.
     *
     * `OrganisationFactory` builds its country, currency and language through
     * their own factories, which invent codes at random. That is right for a
     * suite with no reference data and wrong for one that seeds it — a random
     * two-letter code collides with a real ISO row sooner than intuition
     * suggests, and the failure looks like a bug in the test under assertion.
     *
     * @param  array<string, mixed>  $attributes
     */
    public static function organisation(array $attributes = []): Organisation
    {
        /** @var Organisation $organisation */
        $organisation = Organisation::factory()->create($attributes + [
            'country_code' => 'LB',
            'default_currency_code' => 'USD',
            'default_language_code' => 'en',
        ]);

        return $organisation;
    }

    public static function member(Organisation $organisation, User $user): OrganisationMembership
    {
        /** @var OrganisationMembership $membership */
        $membership = OrganisationMembership::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'user_id' => $user->getKey(),
        ]);

        return $membership;
    }

    /**
     * A `b2b_signatory` challenge already spent by this person.
     *
     * Built directly rather than issued and verified through `OtpService`,
     * because what a sign-off test is asserting is what the *service* does
     * with a proven challenge, not that the OTP framework works — which the
     * verification suite already pins.
     */
    public static function spentSignatoryChallenge(User $signatory): OtpChallenge
    {
        $contact = ContactPoint::query()->where('user_id', $signatory->getKey())->firstOrFail();

        /** @var OtpChallenge $challenge */
        $challenge = OtpChallenge::factory()->forContact($contact)->create([
            'purpose' => OtpPurpose::B2bSignatory,
            'status' => OtpChallengeStatus::Verified,
            'verified_at' => now(),
            'finished_at' => now(),
            'code_hash' => app(OtpCodeHasher::class)->hash(OtpChallengeFactory::CODE),
        ]);

        return $challenge;
    }

    private static function upload(string $name, string $contents, string $declaredMime): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'b2b');

        if ($path === false) {
            throw new RuntimeException('A temporary file could not be created for the fixture upload.');
        }

        file_put_contents($path, $contents);

        // `$test: true` so the constructor does not insist the file arrived
        // through a real upload.
        return new UploadedFile($path, $name, $declaredMime, null, true);
    }
}
