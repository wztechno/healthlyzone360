<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Customers\Enums\AllergenSeverity;
use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Services\CustomerAccountLifecycle;
use Healthy360\Customers\Services\CustomerAddressService;
use Healthy360\Customers\Services\DietaryProfileService;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Log;

/**
 * One consumer, end to end.
 *
 * Nour is the D2C counterpart to the staff personas in `DemoTenantSeeder`: a
 * person with a verified email, an unverified phone, an address in an area
 * Verdant Kitchen actually delivers to, a declared allergy and every required
 * consent — which together are exactly the five conditions
 * `AccountActivationEvaluator` checks. The account is then activated **through
 * the lifecycle service**, not by writing `status = active`, so the seeder
 * proves the evaluator rather than bypassing it. If a requirement is ever
 * added and the demo data does not satisfy it, this seeder stops activating
 * and says why, which is the point.
 *
 * **The phone is deliberately left unverified.** SMS has no provider and its
 * driver writes to a log file (A-011), so a verified demo phone would be a
 * fiction — and it would hide the fact that the production activation path is
 * email-only. The unverified row is the honest state and the one every real
 * account will be in until a provider is integrated.
 *
 * Guarded to local and testing, like the tenant personas it accompanies: these
 * accounts share one well-known password and must never reach a deployed
 * environment.
 */
class DemoCustomerSeeder extends Seeder
{
    private const string DEMO_PASSWORD = 'password';

    private const string EMAIL = 'nour@healthy360.test';

    /**
     * The area Verdant's organisation-wide zone claims (see
     * `DemoTenantSeeder::seedVerdantDelivery`). Named rather than picked at
     * random, because the whole point of the persona is an address somebody
     * can actually deliver to.
     */
    private const string AREA_CODE = 'ae-demo-al-quoz';

    public function __construct(
        private readonly ContactPointRegistry $contacts,
        private readonly CustomerAccountLifecycle $lifecycle,
        private readonly CustomerAddressService $addresses,
        private readonly DietaryProfileService $dietary,
        private readonly ConsentLedger $consents,
    ) {}

    public function run(): void
    {
        if (! App::environment(['local', 'testing'])) {
            Log::warning('DemoCustomerSeeder skipped: demo customers are seeded in local and testing environments only.');

            return;
        }

        $area = DeliveryArea::query()->where('code', self::AREA_CODE)->first();

        if (! $area instanceof DeliveryArea) {
            Log::warning('DemoCustomerSeeder skipped: the demo delivery area is absent, so there is nowhere deliverable to put the address.', [
                'area_code' => self::AREA_CODE,
            ]);

            return;
        }

        $user = $this->user();
        $account = $this->lifecycle->openConsumerAccount($user, CustomerAccountOrigin::SelfService, 'Nour Haddad');

        $login = $this->contacts->rememberForUser(
            user: $user,
            channel: ContactChannel::Email,
            value: self::EMAIL,
            isLoginIdentity: true,
            isPrimary: true,
            source: 'registration',
        );

        // The login mirror is stamped by the `Verified` listener in the real
        // flow, and a seeded account never fires that event. Written here — and
        // necessarily *after* the contact exists — so the two halves of the
        // §4.10 rule agree rather than the demo data sitting in a state no real
        // account can reach.
        $this->contacts->markVerified($login);

        // Present but unverified — see the class comment.
        $this->contacts->rememberForUser(
            user: $user,
            channel: ContactChannel::Phone,
            value: '+971500000101',
            isPrimary: true,
            label: 'Mobile',
        );

        $this->address($account, $area->getKey(), $user);

        $this->dietary->declare(
            account: $account,
            allergens: [
                ['allergen_code' => 'sesame', 'severity' => AllergenSeverity::Allergy->value],
            ],
            exclusions: [
                ['kind' => 'dislike', 'free_text' => 'Coriander'],
            ],
            actorUserId: (string) $user->getKey(),
        );

        $this->consents->grant($user, $this->consents->requiredCodesFor('d2c'), 'web');

        $this->activate($account);
    }

    private function user(): User
    {
        $user = User::query()->firstOrNew(['email' => self::EMAIL]);
        $user->password = self::DEMO_PASSWORD;
        $user->email_verified_at = now();
        $user->save();

        UserProfile::query()->updateOrCreate(
            ['user_id' => $user->getKey()],
            [
                'given_name' => 'Nour',
                'family_name' => 'Haddad',
                'preferred_language_code' => 'ar',
                'country_code' => 'AE',
                'timezone' => 'Asia/Dubai',
                'numbering_system' => 'latn',
                'created_by' => $user->getKey(),
            ],
        );

        return $user;
    }

    private function address(CustomerAccount $account, string $areaId, User $user): void
    {
        $existing = $account->addresses()->where('address_type', CustomerAddressType::Delivery)->exists();

        if ($existing) {
            return;
        }

        $this->addresses->add(
            account: $account,
            type: CustomerAddressType::Delivery,
            deliveryAreaId: $areaId,
            attributes: [
                'label' => 'Home',
                'line_one' => 'Street 8, Al Quoz Industrial 3',
                'building' => 'Olive Court',
                'floor' => '4',
                'apartment' => '402',
                'is_default' => true,
            ],
            actorUserId: (string) $user->getKey(),
        );
    }

    /**
     * Activate through the evaluator, and say so loudly if it refuses.
     *
     * A seeder that forced the status would make the demo data prove nothing —
     * and would hide a broken activation rule behind a green seed.
     */
    private function activate(CustomerAccount $account): void
    {
        $account->refresh();

        // The login contact was verified after the account was opened, so the
        // evaluator is re-asked here rather than earlier.
        $this->lifecycle->touch($account);

        try {
            $this->lifecycle->activate($account, (string) $account->user_id);
        } catch (\Throwable $exception) {
            Log::warning('DemoCustomerSeeder could not activate the demo customer account.', [
                'customer_account_id' => (string) $account->getKey(),
                'reason' => $exception->getMessage(),
            ]);
        }
    }
}
