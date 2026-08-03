<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Concerns\PasswordValidationRules;
use App\Models\User;
use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Services\CustomerAccountLifecycle;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Identity\Services\ContactPointRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Laravel\Fortify\Contracts\CreatesNewUsers;

class CreateNewUser implements CreatesNewUsers
{
    use PasswordValidationRules;

    public function __construct(
        private readonly ConsentLedger $consents,
        private readonly ContactPointRegistry $contacts,
        private readonly CustomerAccountLifecycle $accounts,
        private readonly Request $request,
    ) {}

    /**
     * Validate and create a newly registered user.
     *
     * Account, person data, the login contact point and consent are one atomic
     * act: names live on the user profile (identity module), and accepting the
     * terms and the privacy notice writes consent_grants rows against the
     * current version of each definition. A half-registered identity — an
     * account with no profile, or a profile with no recorded consent — must
     * never be observable.
     *
     * **The login contact point is written here and only here** (master plan
     * v2 §4.10). `users.email` remains the authentication identity; the
     * contact row is its notification mirror, carrying the verification state
     * and the destination an OTP goes to. Writing it inside the same
     * transaction is what makes "one write path" true: an account can never
     * exist without its mirror, so nothing downstream has to cope with the
     * mirror being absent. It is created *unverified* — registration proves an
     * address exists in a form, not that the person holds it; the `Verified`
     * listener stamps it when the signed link or the passcode settles that.
     *
     * **`account_type` is optional, and `b2c` opens the customer account here**
     * (J1). Registration is shared: a kitchen's chef and a consumer create an
     * identity through the same endpoint, and a chef must not acquire an
     * onboarding checklist they will never complete. So the consumer account is
     * asked for rather than assumed, by the one client that knows which journey
     * the person is in.
     *
     * When it is asked for, it is opened **inside this transaction** for the
     * same reason as the contact point: a registration that half-succeeded — an
     * identity with no account, or an account with no consent — must never be
     * observable, and a consumer client that had to make a second call would
     * have a window in which it was. The lifecycle converges on the existing row
     * rather than colliding with it, so a retried registration still produces
     * one account.
     *
     * The account is opened `provisional`, never active. Nothing here satisfies
     * an activation requirement — the address is unverified, no address exists,
     * the allergy question is unanswered — and the evaluator is the only thing
     * that may decide otherwise.
     *
     * @param  array<string, string>  $input
     */
    public function create(array $input): User
    {
        $validated = Validator::make($input, [
            'email' => ['required', 'string', 'email', 'max:255', Rule::unique(User::class)],
            'password' => $this->passwordRules(),
            'given_name' => ['required', 'string', 'max:255'],
            'family_name' => ['required', 'string', 'max:255'],
            'preferred_language_code' => ['sometimes', 'string', 'size:2', Rule::exists('languages', 'code')->where('is_active', true)],
            'country_code' => ['nullable', 'string', 'size:2', Rule::exists('countries', 'code')],
            'timezone' => ['sometimes', 'string', 'max:64', 'timezone'],
            'accepts_terms' => ['accepted'],
            'accepts_privacy' => ['accepted'],

            // `b2c` is the only value J1 accepts. `b2b` accounts are
            // provisioned against an organisation by an approved application
            // (B1) and a guest account is opened by the guest journey (G1);
            // neither is something a registration form may declare itself into.
            'account_type' => ['nullable', 'string', 'in:'.CustomerAccountType::B2c->value],
        ], attributes: [
            'accepts_terms' => 'terms of service',
            'accepts_privacy' => 'privacy notice',
        ])->validate();

        return DB::transaction(function () use ($validated): User {
            $user = User::create([
                'email' => $validated['email'],
                'password' => $validated['password'],
            ]);

            UserProfile::query()->create([
                'user_id' => $user->getKey(),
                'given_name' => $validated['given_name'],
                'family_name' => $validated['family_name'],
                'preferred_language_code' => $validated['preferred_language_code'] ?? 'en',
                'country_code' => $validated['country_code'] ?? null,
                'timezone' => $validated['timezone'] ?? 'UTC',
                'numbering_system' => 'latn',
                'created_by' => $user->getKey(),
            ]);

            $this->contacts->rememberForUser(
                user: $user,
                channel: ContactChannel::Email,
                value: $validated['email'],
                isLoginIdentity: true,
                isPrimary: true,
                source: 'registration',
            );

            $this->consents->grant($user, ConsentLedger::REGISTRATION_CODES, $this->channel());

            if (($validated['account_type'] ?? null) === CustomerAccountType::B2c->value) {
                $this->accounts->openConsumerAccount($user);
            }

            return $user;
        });
    }

    /**
     * The channel a consent was collected through, taken from the declared
     * client platform. Diagnostic only — it never influences authorisation.
     */
    private function channel(): string
    {
        $platform = strtolower((string) $this->request->header('X-Client-Platform'));

        return in_array($platform, ['ios', 'android'], true) ? $platform : 'web';
    }
}
