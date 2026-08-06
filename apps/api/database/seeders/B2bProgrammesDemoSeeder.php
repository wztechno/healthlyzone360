<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\ApplicationStatus;
use Healthy360\B2b\Enums\PaymentTerms;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Identity\Services\ContactValueHasher;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Verification\Database\Factories\OtpChallengeFactory;
use Healthy360\Verification\Enums\OtpChallengeStatus;
use Healthy360\Verification\Enums\OtpPurpose;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;

/**
 * Synthetic corporate programme under a signed Acme ↔ Verdant agreement (B11).
 *
 * Idempotent firstOrCreate / updateOrCreate throughout. Local and testing only.
 */
class B2bProgrammesDemoSeeder extends Seeder
{
    private const string DEMO_PASSWORD = 'password';

    public function run(): void
    {
        if (! App::environment(['local', 'testing'])) {
            Log::warning('B2bProgrammesDemoSeeder skipped: demo B2B data is seeded in local and testing environments only.');

            return;
        }

        $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->first();

        if ($verdant === null) {
            Log::warning('B2bProgrammesDemoSeeder skipped: the demonstration kitchen (verdant-kitchen) has not been seeded yet.');

            return;
        }

        $wholesale = SalesChannel::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('code', 'wholesale')
            ->first();

        $meal = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('item_type', CatalogueItemType::Meal->value)
            ->where('slug', 'grilled-chicken-freekeh')
            ->first()
            ?? CatalogueItem::withoutTenancy()
                ->where('organisation_id', $verdant->getKey())
                ->where('item_type', CatalogueItemType::Meal->value)
                ->orderBy('created_at')
                ->first();

        if ($wholesale === null || $meal === null) {
            Log::warning('B2bProgrammesDemoSeeder skipped: Verdant wholesale channel or demo meal is missing.');

            return;
        }

        $type = OrganisationType::query()->where('code', 'corporate_customer')->first();

        if ($type === null) {
            Log::warning('B2bProgrammesDemoSeeder skipped: organisation type corporate_customer is not seeded.');

            return;
        }

        $signatory = User::query()->firstOrNew(['email' => 'buyer@acme-wellness.test']);
        $signatory->password = Hash::make(self::DEMO_PASSWORD);
        $signatory->email_verified_at = now();
        $signatory->save();

        UserProfile::query()->updateOrCreate(
            ['user_id' => $signatory->getKey()],
            [
                'given_name' => 'Sara',
                'family_name' => 'Haddad',
                'preferred_language_code' => 'en',
                'country_code' => 'AE',
                'timezone' => 'Asia/Dubai',
                'numbering_system' => 'latn',
                'created_by' => $signatory->getKey(),
            ],
        );

        $buyer = Organisation::query()->updateOrCreate(
            ['slug' => 'acme-wellness'],
            [
                'organisation_type_id' => $type->getKey(),
                'name' => 'Acme Wellness',
                'country_code' => 'AE',
                'default_currency_code' => 'USD',
                'default_language_code' => 'en',
                'status' => OrganisationStatus::Active,
                'created_by' => $signatory->getKey(),
            ],
        );

        $membership = OrganisationMembership::withoutTenancy()->updateOrCreate(
            [
                'organisation_id' => $buyer->getKey(),
                'user_id' => $signatory->getKey(),
            ],
            [
                'branch_id' => null,
                'status' => MembershipStatus::Active,
                'joined_at' => now(),
                'created_by' => $signatory->getKey(),
            ],
        );

        $ownerRole = Role::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('code', 'organisation_owner')
            ->first();

        if ($ownerRole !== null) {
            MembershipRole::withoutTenancy()->updateOrCreate(
                [
                    'membership_id' => $membership->getKey(),
                    'role_id' => $ownerRole->getKey(),
                ],
                [
                    'organisation_id' => $buyer->getKey(),
                    'created_by' => $signatory->getKey(),
                ],
            );
        }

        ContactPoint::query()->firstOrCreate(
            [
                'user_id' => $signatory->getKey(),
                'value_hash' => app(ContactValueHasher::class)->hash($signatory->email),
            ],
            [
                'channel' => ContactChannel::Email,
                'value_normalised' => $signatory->email,
                'is_login_identity' => true,
                'verified_at' => now(),
            ],
        );

        $account = CustomerAccount::query()
            ->where('organisation_id', $buyer->getKey())
            ->where('account_type', CustomerAccountType::B2b)
            ->first();

        if ($account === null) {
            $account = CustomerAccount::factory()->create([
                'organisation_id' => $buyer->getKey(),
                'account_type' => CustomerAccountType::B2b,
                'user_id' => null,
                'status' => CustomerAccountStatus::Active,
                'activated_at' => now(),
                'provisional_expires_at' => null,
            ]);
        }

        $application = B2bApplication::query()->firstOrCreate(
            ['provisioned_organisation_id' => $buyer->getKey()],
            [
                'reference' => 'B2B-DEMO-ACME',
                'applicant_user_id' => $signatory->getKey(),
                'status' => ApplicationStatus::Approved,
                'legal_name' => 'Acme Wellness LLC',
                'country_code' => 'AE',
                'commercial_registration_number' => 'ACME-DEMO-001',
                'commercial_registration_normalised' => 'ACMEDEMO001',
                'signatory_name' => 'Sara Haddad',
                'signatory_title' => 'Procurement lead',
                'signatory_email' => $signatory->email,
                'requested_payment_terms' => PaymentTerms::Net30,
                'completed_sections' => [],
                'submitted_at' => now()->subMonths(7),
                'decided_at' => now()->subMonths(6),
                'customer_account_id' => $account->getKey(),
                'lock_version' => 0,
            ],
        );

        $agreementList = PriceList::withoutTenancy()->updateOrCreate(
            [
                'organisation_id' => $verdant->getKey(),
                'code' => 'acme-agreement-usd',
            ],
            [
                'currency_code' => 'USD',
                'customer_scope' => CustomerScope::Agreement,
                'status' => PriceListStatus::Active,
                'name_en' => 'Acme agreement tariff',
                'name_ar' => 'تعريفة أكمي',
                'lock_version' => 0,
            ],
        );

        ChannelPriceList::withoutTenancy()->firstOrCreate(
            [
                'sales_channel_id' => $wholesale->getKey(),
                'price_list_id' => $agreementList->getKey(),
            ],
            [
                'organisation_id' => $verdant->getKey(),
                'priority' => 0,
                'created_by' => $signatory->getKey(),
            ],
        );

        PriceListItem::withoutTenancy()->firstOrCreate(
            [
                'price_list_id' => $agreementList->getKey(),
                'catalogue_item_id' => $meal->getKey(),
                'catalogue_item_variant_id' => null,
            ],
            [
                'organisation_id' => $verdant->getKey(),
                'unit_amount_minor' => 1800,
                'price_status' => PriceStatus::Confirmed,
                'effective_from' => now()->startOfDay(),
            ],
        );

        $existingAgreement = B2bAgreement::query()
            ->where('organisation_id', $buyer->getKey())
            ->where('b2b_application_id', $application->getKey())
            ->first();

        if ($existingAgreement === null) {
            $contact = ContactPoint::query()->where('user_id', $signatory->getKey())->firstOrFail();
            $challenge = OtpChallengeFactory::new()->forContact($contact)->create([
                'purpose' => OtpPurpose::B2bSignatory,
                'status' => OtpChallengeStatus::Verified,
                'verified_at' => now()->subMonths(6),
                'finished_at' => now()->subMonths(6),
            ]);

            $agreement = B2bAgreement::query()->create([
                'organisation_id' => $buyer->getKey(),
                'b2b_application_id' => $application->getKey(),
                'title' => 'Acme Wellness master supply agreement',
                'version' => 1,
                'status' => AgreementStatus::Active,
                'notice_period_days' => 30,
                'signatory_user_id' => $signatory->getKey(),
                'signatory_name' => 'Sara Haddad',
                'signatory_title' => 'Procurement lead',
                'signature_document_sha256' => hash('sha256', 'acme-master-supply-v1'),
                'signature_consent_statement' => 'I accept these terms on behalf of Acme Wellness.',
                'signature_otp_challenge_id' => $challenge->getKey(),
                'signed_at' => now()->subMonths(6),
                'activated_at' => now()->subMonths(6),
                'price_list_id' => $agreementList->getKey(),
                'currency_code' => 'USD',
                'minimum_order_minor' => 1000,
                'lock_version' => 0,
            ]);
        } else {
            $agreement = $existingAgreement;
            if ($agreement->price_list_id === null) {
                $agreement->forceFill([
                    'price_list_id' => $agreementList->getKey(),
                    'currency_code' => 'USD',
                    'minimum_order_minor' => 1000,
                    'status' => AgreementStatus::Active,
                ])->save();
            }
        }

        CorporateProgramme::withoutTenancy()->firstOrCreate(
            [
                'organisation_id' => $buyer->getKey(),
                'code' => 'acme-employee-meals',
            ],
            [
                'kitchen_organisation_id' => $verdant->getKey(),
                'b2b_agreement_id' => $agreement->getKey(),
                'name_en' => 'Acme employee meals',
                'name_ar' => 'وجبات موظفي أكمي',
                'description' => 'Negotiated workplace lunch programme with Verdant Kitchen.',
                'status' => 'active',
                'lock_version' => 0,
                'created_by' => $signatory->getKey(),
            ],
        );
    }
}
