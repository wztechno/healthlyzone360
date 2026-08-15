<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| Organisation and branch context middleware
|--------------------------------------------------------------------------
|
| Client-supplied X-Organisation-Id and X-Branch-Id headers are never trusted
| without server-side validation (plan §9). The two probe routes below exist
| only for this file: they are the smallest possible thing the middleware can
| protect, and they echo back the context the middleware resolved.
|
*/

beforeEach(function (): void {
    Route::middleware('org.context')->get('/testing/tenancy/organisation', fn () => response()->json([
        'data' => ['organisation_id' => app(TenantContext::class)->organisationId()],
    ]));

    Route::middleware(['org.context', 'branch.context'])->get('/testing/tenancy/branch', fn () => response()->json([
        'data' => ['branch_id' => app(TenantContext::class)->branchId()],
    ]));

    $this->organisation = Organisation::factory()->create();
    $this->branch = OrganisationBranch::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    $this->user = User::factory()->create();
    $this->membership = OrganisationMembership::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'user_id' => $this->user->getKey(),
    ]);
});

it('resolves the organisation context for an active member', function (): void {
    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/organisation', ['X-Organisation-Id' => $this->organisation->getKey()])
        ->assertOk()
        ->assertJsonPath('data.organisation_id', $this->organisation->getKey());
});

it('rejects a request without an organisation header', function (): void {
    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/organisation')
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'context.organisation_required');
});

it('rejects an organisation the user is not a member of', function (): void {
    $other = Organisation::factory()->create();

    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/organisation', ['X-Organisation-Id' => $other->getKey()])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'context.organisation_forbidden');
});

it('rejects an unknown organisation identifier without revealing that it does not exist', function (): void {
    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/organisation', ['X-Organisation-Id' => (string) Str::uuid7()])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'context.organisation_forbidden');
});

it('rejects a malformed organisation identifier', function (): void {
    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/organisation', ['X-Organisation-Id' => 'not-a-uuid'])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'context.organisation_forbidden');
});

it('rejects an unauthenticated request', function (): void {
    $this->getJson('/testing/tenancy/organisation', ['X-Organisation-Id' => $this->organisation->getKey()])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'context.organisation_forbidden');
});

it('rejects a membership that is not active', function (string $state): void {
    $this->membership->forceFill(['status' => $state])->save();

    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/organisation', ['X-Organisation-Id' => $this->organisation->getKey()])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'context.organisation_forbidden');
})->with(['invited', 'suspended', 'ended']);

it('resolves a branch belonging to the organisation', function (): void {
    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/branch', [
            'X-Organisation-Id' => $this->organisation->getKey(),
            'X-Branch-Id' => $this->branch->getKey(),
        ])
        ->assertOk()
        ->assertJsonPath('data.branch_id', $this->branch->getKey());
});

it('rejects a branch belonging to another organisation', function (): void {
    $foreign = OrganisationBranch::factory()->create([
        'organisation_id' => Organisation::factory()->create()->getKey(),
    ]);

    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/branch', [
            'X-Organisation-Id' => $this->organisation->getKey(),
            'X-Branch-Id' => $foreign->getKey(),
        ])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'context.branch_out_of_scope');
});

it('rejects a closed branch', function (): void {
    $closed = OrganisationBranch::factory()->closed()->create([
        'organisation_id' => $this->organisation->getKey(),
    ]);

    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/branch', [
            'X-Organisation-Id' => $this->organisation->getKey(),
            'X-Branch-Id' => $closed->getKey(),
        ])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'context.branch_out_of_scope');
});

it('rejects a branch outside a branch-scoped membership', function (): void {
    $other = OrganisationBranch::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    $this->membership->forceFill(['branch_id' => $this->branch->getKey()])->save();

    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/branch', [
            'X-Organisation-Id' => $this->organisation->getKey(),
            'X-Branch-Id' => $other->getKey(),
        ])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'context.branch_out_of_scope');
});

it('defaults a branch-scoped membership to its own branch when no header is sent', function (): void {
    $this->membership->forceFill(['branch_id' => $this->branch->getKey()])->save();

    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/branch', ['X-Organisation-Id' => $this->organisation->getKey()])
        ->assertOk()
        ->assertJsonPath('data.branch_id', $this->branch->getKey());
});

it('defaults an organisation-wide membership to the sole active branch when no header is sent', function (): void {
    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/branch', ['X-Organisation-Id' => $this->organisation->getKey()])
        ->assertOk()
        ->assertJsonPath('data.branch_id', $this->branch->getKey());
});

it('leaves an organisation-wide membership without a branch when the organisation has more than one active branch', function (): void {
    OrganisationBranch::factory()->create(['organisation_id' => $this->organisation->getKey()]);

    $this->actingAs($this->user)
        ->getJson('/testing/tenancy/branch', ['X-Organisation-Id' => $this->organisation->getKey()])
        ->assertOk()
        ->assertJsonPath('data.branch_id', null);
});
