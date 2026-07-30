<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Concerns\PasswordValidationRules;
use App\Models\User;
use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Identity\Models\UserProfile;
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
        private readonly Request $request,
    ) {}

    /**
     * Validate and create a newly registered user.
     *
     * Account, person data and consent are one atomic act: names live on the
     * user profile (identity module), and accepting the terms and the privacy
     * notice writes consent_grants rows against the current version of each
     * definition. A half-registered identity — an account with no profile, or
     * a profile with no recorded consent — must never be observable.
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

            $this->consents->grant($user, ConsentLedger::REGISTRATION_CODES, $this->channel());

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
