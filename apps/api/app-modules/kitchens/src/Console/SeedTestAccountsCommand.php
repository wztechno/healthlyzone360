<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\ApplicationStatus;
use Healthy360\B2b\Enums\PaymentTerms;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Customers\Services\CustomerAccountLifecycle;
use Healthy360\Customers\Services\CustomerAccountNumbers;
use Healthy360\Customers\Services\CustomerAddressService;
use Healthy360\Customers\Services\DietaryProfileService;
use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Delivery\Services\ZoneWindowService;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Verification\Enums\OtpChallengeStatus;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Services\OtpCodeHasher;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;

/**
 * Two working test logins on one kitchen: a consumer who can check out, and a corporate buyer who
 * can place a wholesale order under a signed agreement.
 *
 * Modelled on `DemoCustomerSeeder` (B2C) and `B2bProgrammesDemoSeeder` (B2B), but pointed at a real
 * imported kitchen rather than the demo world, and written for a deployed test instance: no
 * factories (the droplet installs `--no-dev`, so there is no faker), the same environment
 * allowlist as the other `kitchen:*` commands, and both halves of the tenant context around every
 * organisation-scoped write.
 *
 * What it puts in place, creating only what is absent:
 *
 * - a **delivery zone** covering one area, when the kitchen serves none — both checkouts need an
 *   address somebody delivers to;
 * - the four **delivery windows** `morning` / `midday` / `afternoon` / `evening` (Breakfast, Lunch,
 *   Snack, Dinner), active, with English and Arabic names, and offered in every zone of the kitchen
 *   (placement refuses a window its zone does not offer);
 * - **B2C** `customer@healthzone360.test`: the consumer account `POST /customer-account` opens, a
 *   verified login email, a default address in the served area, a dietary declaration and the
 *   required consents, then activated through the lifecycle service;
 * - **B2B** `buyer@corp.healthzone360.test`: a corporate organisation it owns, an active `b2b`
 *   account with a default address, an approved application, an active signed agreement (with the
 *   click-wrap evidence and a spent signatory challenge the CHECK constraints demand), an empty
 *   agreement-scoped price list on the kitchen linked to its `wholesale` channel — so the buyer
 *   pays the wholesale tariff until somebody negotiates a price — and a programme.
 *
 * Idempotent: every write is keyed on a natural key and leaves an existing row alone, so a second
 * run changes nothing. Both logins use the well-known password `password`.
 */
final class SeedTestAccountsCommand extends Command
{
    use RunsInsideOneKitchen;

    private const string DEFAULT_ORGANISATION_SLUG = 'healthzone360-kitchen';

    private const string PASSWORD = 'password';

    private const string CUSTOMER_EMAIL = 'customer@healthzone360.test';

    private const string BUYER_EMAIL = 'buyer@corp.healthzone360.test';

    private const string BUYER_SLUG = 'healthzone360-test-corporate';

    private const string BUYER_NAME = 'HealthZone Test Corporate';

    private const string WHOLESALE_CHANNEL = 'wholesale';

    /** Used only when the kitchen serves no area yet. */
    private const string AREA_COUNTRY = 'LB';

    private const string AREA_CODE = 'antelias';

    private const string ZONE_CODE = 'test-accounts';

    /** Code => [English, Arabic, starts, ends, display order]. Times apply only to a new window. */
    private const array WINDOWS = [
        'morning' => ['Breakfast', 'فطور', '07:00:00', '10:00:00', 1],
        'midday' => ['Lunch', 'غداء', '11:00:00', '14:00:00', 2],
        'afternoon' => ['Snack', 'وجبة خفيفة', '15:00:00', '17:00:00', 3],
        'evening' => ['Dinner', 'عشاء', '18:00:00', '21:00:00', 4],
    ];

    protected $signature = 'kitchen:seed-test-accounts
        {--org= : The kitchen organisation slug (defaults to healthzone360-kitchen)}';

    protected $description = 'Create a checkout-ready B2C customer and a B2B buyer with a signed agreement on one kitchen (idempotent).';

    public function handle(
        DatabaseTenantContext $database,
        CustomerAccountLifecycle $lifecycle,
        CustomerAddressService $addresses,
        DietaryProfileService $dietary,
        ConsentLedger $consents,
        ContactPointRegistry $contacts,
        CustomerAccountNumbers $accountNumbers,
        OtpCodeHasher $codes,
    ): int {
        if ($this->refusesThisEnvironment('kitchen:seed-test-accounts')) {
            return self::FAILURE;
        }

        $slug = $this->stringOption('org') ?? self::DEFAULT_ORGANISATION_SLUG;
        $kitchen = Organisation::query()->where('slug', $slug)->first();

        if (! $kitchen instanceof Organisation) {
            $this->components->error(sprintf('No organisation with the slug "%s" exists. Run kitchen:import-v6 first, or name one with --org.', $slug));

            return self::FAILURE;
        }

        $corporateType = OrganisationType::query()->where('code', 'corporate_customer')->first();
        $ownerRole = Role::withoutTenancy()->whereNull('organisation_id')->where('code', 'organisation_owner')->first();

        if (! $corporateType instanceof OrganisationType || ! $ownerRole instanceof Role) {
            $this->components->error('The corporate_customer organisation type or the organisation_owner role is not seeded.');

            return self::FAILURE;
        }

        $currency = (string) $kitchen->default_currency_code;

        /** @var array{area: string, wholesale: SalesChannel|null} $kitchenSide */
        $kitchenSide = $this->insideOrganisation($kitchen, function (string $organisationId) use ($currency): array {
            $this->windows($organisationId);
            $area = $this->servedArea($organisationId, $currency);
            $this->offerWindowsEverywhere($organisationId);

            return [
                'area' => $area,
                'wholesale' => SalesChannel::withoutTenancy()
                    ->where('organisation_id', $organisationId)
                    ->where('code', self::WHOLESALE_CHANNEL)
                    ->first(),
            ];
        });
        $areaId = $kitchenSide['area'];

        // ── B2C ─────────────────────────────────────────────────────────────────────────────────
        $customer = $this->user(self::CUSTOMER_EMAIL, 'Carla', 'Customer');
        $this->verifiedLogin($contacts, $customer);

        $database->asUser((string) $customer->getKey(), function () use ($customer, $areaId, $lifecycle, $addresses, $dietary, $consents): void {
            $account = $lifecycle->openConsumerAccount($customer, CustomerAccountOrigin::SelfService);
            $this->address($addresses, $account, $areaId, 'Home', 'Antelias main road, building 12', $customer);

            if (! CustomerDietaryProfile::query()->where('customer_account_id', $account->getKey())->whereNotNull('declared_at')->exists()) {
                $dietary->declare(account: $account, allergens: [], actorUserId: (string) $customer->getKey());
            }

            $consents->grant($customer, $consents->requiredCodesFor('d2c'), 'web');

            $account->refresh();

            if ($account->status !== CustomerAccountStatus::Active) {
                $lifecycle->activate($account, (string) $customer->getKey());
            }
        });

        // ── B2B ─────────────────────────────────────────────────────────────────────────────────
        $wholesale = $kitchenSide['wholesale'];

        if (! $wholesale instanceof SalesChannel) {
            $this->components->warn(sprintf('The kitchen has no "%s" channel, so no B2B buyer was set up.', self::WHOLESALE_CHANNEL));
            $this->logins(withBuyer: false);

            return self::SUCCESS;
        }

        $buyer = $this->user(self::BUYER_EMAIL, 'Bilal', 'Buyer');
        $buyerContact = $this->verifiedLogin($contacts, $buyer);
        $database->asUser((string) $buyer->getKey(), fn () => $consents->grant($buyer, $consents->requiredCodesFor('b2b'), 'web'));

        $company = Organisation::query()->firstOrCreate(
            ['slug' => self::BUYER_SLUG],
            [
                'organisation_type_id' => $corporateType->getKey(),
                'name' => self::BUYER_NAME,
                'country_code' => $kitchen->country_code,
                'default_currency_code' => $currency,
                'default_language_code' => 'en',
                'status' => OrganisationStatus::Active,
                'created_by' => $buyer->getKey(),
            ],
        );
        $companyId = (string) $company->getKey();

        $account = $database->during((string) $buyer->getKey(), $companyId, null, function () use ($company, $companyId, $buyer, $ownerRole, $accountNumbers, $addresses, $areaId): CustomerAccount {
            $membership = OrganisationMembership::withoutTenancy()->firstOrCreate(
                ['organisation_id' => $companyId, 'user_id' => $buyer->getKey()],
                ['branch_id' => null, 'status' => MembershipStatus::Active, 'joined_at' => now(), 'created_by' => $buyer->getKey()],
            );

            if ($membership->status !== MembershipStatus::Active) {
                $membership->forceFill(['status' => MembershipStatus::Active])->save();
            }

            MembershipRole::withoutTenancy()->firstOrCreate(
                ['membership_id' => $membership->getKey(), 'role_id' => $ownerRole->getKey()],
                ['organisation_id' => $companyId, 'created_by' => $buyer->getKey()],
            );

            $account = CustomerAccount::query()
                ->where('organisation_id', $companyId)
                ->where('account_type', CustomerAccountType::B2b)
                ->first()
                ?? CustomerAccount::query()->create([
                    'account_number' => $accountNumbers->next(),
                    'account_type' => CustomerAccountType::B2b,
                    'user_id' => null,
                    'organisation_id' => $companyId,
                    'status' => CustomerAccountStatus::Active,
                    'origin' => CustomerAccountOrigin::B2bProvisioning,
                    'display_name' => $company->name,
                    'preferred_language_code' => $company->default_language_code,
                    'country_code' => $company->country_code,
                    'activated_at' => now(),
                    'last_activity_at' => now(),
                    'provisional_expires_at' => null,
                    'created_by' => $buyer->getKey(),
                ]);

            $this->address($addresses, $account, $areaId, 'Office', 'Antelias highway, tower B, floor 3', $buyer);

            return $account;
        });

        $application = B2bApplication::query()->firstOrCreate(
            ['provisioned_organisation_id' => $companyId],
            [
                'reference' => 'B2B-TEST-HZ360',
                'applicant_user_id' => $buyer->getKey(),
                'status' => ApplicationStatus::Approved,
                'legal_name' => self::BUYER_NAME.' SAL',
                'country_code' => $company->country_code,
                'commercial_registration_number' => 'HZ360-TEST-001',
                'commercial_registration_normalised' => 'HZ360TEST001',
                'signatory_name' => 'Bilal Buyer',
                'signatory_title' => 'Procurement lead',
                'signatory_email' => $buyer->email,
                'requested_payment_terms' => PaymentTerms::Net30,
                'completed_sections' => [],
                'submitted_at' => now()->subMonth(),
                'decided_at' => now()->subMonth(),
                'customer_account_id' => $account->getKey(),
                'lock_version' => 0,
            ],
        );

        $tariff = $this->insideOrganisation($kitchen, function (string $organisationId) use ($wholesale, $currency, $buyer): PriceList {
            $tariff = PriceList::withoutTenancy()->firstOrCreate(
                ['organisation_id' => $organisationId, 'code' => self::BUYER_SLUG.'-agreement'],
                [
                    'currency_code' => $currency,
                    'customer_scope' => CustomerScope::Agreement,
                    'status' => PriceListStatus::Active,
                    'name_en' => self::BUYER_NAME.' agreement tariff',
                    'name_ar' => 'تعريفة اتفاقية الشركة التجريبية',
                    'lock_version' => 0,
                ],
            );

            ChannelPriceList::withoutTenancy()->firstOrCreate(
                ['sales_channel_id' => $wholesale->getKey(), 'price_list_id' => $tariff->getKey()],
                ['organisation_id' => $organisationId, 'priority' => 0, 'created_by' => $buyer->getKey()],
            );

            return $tariff;
        });

        $database->during((string) $buyer->getKey(), $companyId, null, function () use ($kitchen, $companyId, $application, $buyer, $buyerContact, $tariff, $currency, $codes): void {
            $agreement = B2bAgreement::query()
                ->where('organisation_id', $companyId)
                ->where('b2b_application_id', $application->getKey())
                ->first();

            if (! $agreement instanceof B2bAgreement) {
                $signedAt = now()->subMonth();

                // A signature needs proof the signatory was present (the CHECK on
                // `signature_otp_challenge_id`), so a spent challenge is written beside it.
                $challenge = OtpChallenge::query()->create([
                    'contact_point_id' => $buyerContact->getKey(),
                    'user_id' => $buyer->getKey(),
                    'customer_account_id' => null,
                    'purpose' => OtpPurpose::B2bSignatory,
                    'channel' => OtpChannel::Email,
                    'destination_masked' => 'b•••@corp.healthzone360.test',
                    'code_hash' => $codes->hash(bin2hex(random_bytes(8))),
                    'status' => OtpChallengeStatus::Verified,
                    'attempts' => 1,
                    'max_attempts' => 3,
                    'resend_count' => 0,
                    'max_resends' => 3,
                    'expires_at' => $signedAt->copy()->addMinutes(5),
                    'last_sent_at' => $signedAt,
                    'verified_at' => $signedAt,
                    'finished_at' => $signedAt,
                ]);

                $agreement = B2bAgreement::query()->create([
                    'organisation_id' => $companyId,
                    'b2b_application_id' => $application->getKey(),
                    'title' => self::BUYER_NAME.' test supply agreement',
                    'version' => 1,
                    'status' => AgreementStatus::Active,
                    'notice_period_days' => 30,
                    'signatory_user_id' => $buyer->getKey(),
                    'signatory_name' => 'Bilal Buyer',
                    'signatory_title' => 'Procurement lead',
                    'signature_document_sha256' => hash('sha256', self::BUYER_SLUG.'-supply-v1'),
                    'signature_consent_statement' => 'I accept these terms on behalf of '.self::BUYER_NAME.'.',
                    'signature_otp_challenge_id' => $challenge->getKey(),
                    'signed_at' => $signedAt,
                    'activated_at' => $signedAt,
                    'price_list_id' => $tariff->getKey(),
                    'currency_code' => $currency,
                    'lock_version' => 0,
                ]);
            }

            CorporateProgramme::withoutTenancy()->firstOrCreate(
                ['organisation_id' => $companyId, 'code' => 'test-employee-meals'],
                [
                    'kitchen_organisation_id' => $kitchen->getKey(),
                    'b2b_agreement_id' => $agreement->getKey(),
                    'name_en' => 'Test employee meals',
                    'name_ar' => 'وجبات الموظفين التجريبية',
                    'description' => 'Workplace meals for testing wholesale checkout.',
                    'status' => 'active',
                    'lock_version' => 0,
                    'created_by' => $buyer->getKey(),
                ],
            );
        });

        $this->logins(withBuyer: true);

        return self::SUCCESS;
    }

    /**
     * An area this kitchen delivers to — an existing active zone's first, or one new zone's.
     */
    private function servedArea(string $organisationId, string $currency): string
    {
        $zoneIds = DeliveryZone::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', DeliveryZoneStatus::Active)
            ->pluck('id');

        $served = DeliveryZoneArea::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('delivery_zone_id', $zoneIds)
            ->orderBy('created_at')
            ->orderBy('id')
            ->value('delivery_area_id');

        if ($served !== null) {
            return (string) $served;
        }

        $area = DeliveryArea::query()->firstOrCreate(
            ['country_code' => self::AREA_COUNTRY, 'code' => self::AREA_CODE],
            ['name_en' => 'Antelias', 'name_ar' => 'أنطلياس', 'region' => null, 'display_order' => 0, 'is_active' => true],
        );

        $zone = DeliveryZone::withoutTenancy()->firstOrCreate(
            ['organisation_id' => $organisationId, 'code' => self::ZONE_CODE],
            [
                'branch_id' => null,
                'name_en' => 'Test delivery zone',
                'name_ar' => 'منطقة توصيل تجريبية',
                'currency_code' => $currency,
                'delivery_fee_minor' => 300,
                'minimum_order_minor' => null,
                'estimated_minutes' => 45,
                'status' => DeliveryZoneStatus::Active,
                'lock_version' => 0,
            ],
        );

        if ($zone->status !== DeliveryZoneStatus::Active) {
            $zone->forceFill(['status' => DeliveryZoneStatus::Active])->save();
        }

        DeliveryZoneArea::withoutTenancy()->firstOrCreate(
            ['delivery_zone_id' => $zone->getKey(), 'delivery_area_id' => $area->getKey()],
            ['organisation_id' => $organisationId, 'branch_id' => null],
        );

        $this->components->info(sprintf('Created delivery zone "%s" covering %s.', self::ZONE_CODE, $area->name_en));

        return (string) $area->getKey();
    }

    /**
     * The four meal windows, active and named. Hours and order are set only on a new window, so a
     * kitchen that has tuned its own is not overwritten.
     */
    private function windows(string $organisationId): void
    {
        foreach (self::WINDOWS as $code => [$nameEn, $nameAr, $startsAt, $endsAt, $displayOrder]) {
            $window = DeliveryWindow::withoutTenancy()->firstOrNew(['organisation_id' => $organisationId, 'code' => $code]);

            if (! $window->exists) {
                $window->forceFill(['starts_at' => $startsAt, 'ends_at' => $endsAt, 'weekdays' => [], 'display_order' => $displayOrder]);
            }

            $window->forceFill(['name_en' => $nameEn, 'name_ar' => $nameAr, 'is_active' => true])->save();
        }
    }

    /**
     * The four windows in every zone of the kitchen, so both test checkouts can name one. Additive
     * and idempotent; no other window's assignments are touched.
     */
    private function offerWindowsEverywhere(string $organisationId): void
    {
        /** @var list<string> $windowIds */
        $windowIds = DeliveryWindow::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('code', array_keys(self::WINDOWS))
            ->pluck('id')
            ->all();

        app(ZoneWindowService::class)->assignAll($organisationId, $windowIds);
    }

    private function user(string $email, string $givenName, string $familyName): User
    {
        $user = User::query()->firstOrNew(['email' => $email]);

        // Re-hashing an unchanged password would rewrite the row on every run.
        if (! $user->exists || ! Hash::check(self::PASSWORD, (string) $user->password)) {
            $user->password = self::PASSWORD;
        }

        $user->email_verified_at ??= now();
        $user->save();

        UserProfile::query()->firstOrCreate(
            ['user_id' => $user->getKey()],
            ['given_name' => $givenName, 'family_name' => $familyName, 'preferred_language_code' => 'en', 'country_code' => self::AREA_COUNTRY],
        );

        return $user;
    }

    /**
     * The login email as a verified contact — what the `Verified` listener stamps in the real flow.
     */
    private function verifiedLogin(ContactPointRegistry $contacts, User $user): ContactPoint
    {
        $login = $contacts->rememberForUser(
            user: $user,
            channel: ContactChannel::Email,
            value: (string) $user->email,
            isLoginIdentity: true,
            isPrimary: true,
            source: 'registration',
        );

        return $contacts->markVerified($login);
    }

    private function address(CustomerAddressService $addresses, CustomerAccount $account, string $areaId, string $label, string $line, User $actor): void
    {
        $exists = CustomerAddress::query()
            ->where('customer_account_id', $account->getKey())
            ->where('address_type', CustomerAddressType::Delivery)
            ->where('delivery_area_id', $areaId)
            ->exists();

        if ($exists) {
            return;
        }

        $addresses->add(
            account: $account,
            type: CustomerAddressType::Delivery,
            deliveryAreaId: $areaId,
            attributes: ['label' => $label, 'line_one' => $line, 'is_default' => true],
            actorUserId: (string) $actor->getKey(),
        );
    }

    private function logins(bool $withBuyer): void
    {
        $rows = [['B2C customer', self::CUSTOMER_EMAIL, self::PASSWORD]];

        if ($withBuyer) {
            $rows[] = ['B2B buyer ('.self::BUYER_NAME.')', self::BUYER_EMAIL, self::PASSWORD];
        }

        $this->line('');
        $this->table(['Login', 'Email', 'Password'], $rows);
    }
}
