<?php

declare(strict_types=1);

namespace Healthy360\B2b\Database\Factories;

use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<OrganisationInvitation>
 */
class OrganisationInvitationFactory extends Factory
{
    /** @var class-string<OrganisationInvitation> */
    protected $model = OrganisationInvitation::class;

    /**
     * The token this factory hashes is thrown away, exactly as the service
     * throws its own away. A test that needs a usable token issues one through
     * `InvitationService` rather than reaching behind it.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $email = fake()->unique()->safeEmail();

        return [
            'organisation_id' => Organisation::factory(),
            'branch_id' => null,
            'email' => $email,
            'email_normalised' => mb_strtolower($email),
            'role_code' => 'commercial_manager',
            'token_hash' => hash('sha256', Str::random(40)),
            'expires_at' => now()->addDays(7),
        ];
    }

    public function expired(): self
    {
        return $this->state(fn (): array => ['expires_at' => now()->subDays(40)]);
    }
}
