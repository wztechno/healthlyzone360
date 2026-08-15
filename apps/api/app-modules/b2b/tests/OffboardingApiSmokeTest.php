<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\B2b\Contracts\SellerOpenOrders;
use Healthy360\B2b\Enums\OffboardingStatus;
use Healthy360\B2b\Enums\OffboardingTrigger;
use Healthy360\B2b\Enums\RecordExportStatus;
use Healthy360\B2b\Enums\SettlementStatus;
use Healthy360\B2b\Jobs\RevokeBusinessAccess;
use Healthy360\B2b\Models\B2bOffboarding;
use Healthy360\B2b\Models\RecordExport;
use Healthy360\B2b\Tests\Fixtures\B2bWorld;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| The corporate wind-up, over HTTP
|--------------------------------------------------------------------------
|
| `SettlementWaiverSmokeTest` proves the settlement rules through the service
| and `OffboardingRevocationSmokeTest` proves the revocation job. Neither sends
| a request, so neither proves the *wiring*: the routes, the two-gate platform
| middleware, the second permission stacked on the waiver, the third stacked on
| the exports, `Idempotency-Key` on the one irreversible step, and the fact that
| a signatory passcode is what sign-off turns on rather than a permission.
|
| That is this file's job. One long named path — start, check, waive, sign off,
| revoke, archive — plus the export handover and the two refusals that would be
| catastrophic if they silently stopped happening: an operator signing a company
| out on their own authority, and a bundle downloaded with no stated reason.
|
| SPEED MODE: one smoke per route family, per the wave protocol.
|
*/

beforeEach(function (): void {
    // The full seed, for the reason the B1 smoke takes it: the
    // platform-operator organisation and the bespoke role carrying the platform
    // codes are the only supported way to hold `b2b_offboarding.*_platform`, and
    // the demo seeder is where that grant is expressed. A test that hand-built
    // the grant would be asserting against its own fixture.
    $this->seed();

    Storage::fake('private');

    $this->platform = Organisation::query()->where('slug', 'healthy360-operations')->sole();
    $this->operator = User::query()->where('email', 'ops@healthy360.test')->sole();

    // Two gates on every route here: the selected organisation must *be* the
    // platform operator, and the member must hold the code.
    $this->platformHeaders = firstPartyHeaders() + ['X-Organisation-Id' => (string) $this->platform->getKey()];

    $this->world = B2bWorld::provisionedWorld();
});

it('walks a company out: notice, checks, waiver, sign-off, revocation and archive', function (): void {
    $this->actingAs($this->operator);

    // ---------------------------------------------------------------- notice

    $started = $this->postJson('/api/v1/platform/b2b/offboardings', [
        'organisation_id' => (string) $this->world['organisation']->getKey(),
        'trigger' => OffboardingTrigger::NonRenewal->value,
        'reason_note' => 'The agreement lapses at the end of the quarter.',
    ], $this->platformHeaders)
        ->assertCreated()
        ->assertJsonPath('data.offboarding.status', OffboardingStatus::NoticeServed->value)
        ->assertJsonPath('data.offboarding.trigger', OffboardingTrigger::NonRenewal->value)
        // Copied onto the row from the agreement, never read back through it, so
        // an amendment signed next week cannot shorten notice already served.
        ->assertJsonPath('data.offboarding.notice_period_days', 30)
        ->assertJsonPath('data.offboarding.settlement.status', SettlementStatus::Pending->value);

    $id = $started->json('data.offboarding.id');

    expect($started->json('data.offboarding.effective_on'))->toBe(now()->addDays(30)->toDateString())
        ->and($started->json('data.offboarding.allowed_transitions'))
        ->toBe(['settlement_pending', 'cancelled']);

    // A second wind-up for the same company is refused with a sentence rather
    // than a constraint violation.
    $this->postJson('/api/v1/platform/b2b/offboardings', [
        'organisation_id' => (string) $this->world['organisation']->getKey(),
        'trigger' => OffboardingTrigger::Termination->value,
    ], $this->platformHeaders)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'offboarding.refused')
        ->assertJsonPath('error.details.reason', 'offboarding.already_in_flight');

    // ------------------------------------------------------------ settlement

    $checked = $this->postJson("/api/v1/platform/b2b/offboardings/{$id}/settlement-checks", [], $this->platformHeaders)
        ->assertOk();

    $outcomes = collect($checked->json('data.offboarding.settlement.checks'))->keyBy('check');

    // The honesty the whole registry exists for reaches the wire in both
    // directions. A check that a module now answers says what it found: the
    // payments module binds a real invoicing lookup, so `outstanding_invoices`
    // runs and — nothing being uncaptured for this company — says `clear`, with
    // an explanatory `detail` rather than the `reason` a gap carries.
    expect($outcomes)->toHaveCount(4)
        ->and($outcomes['outstanding_invoices']['outcome'])->toBe('clear')
        ->and($outcomes['outstanding_invoices']['detail'])->toBeString()
        // And a check no module answers yet still says so, with a machine reason
        // rather than showing a green tick: `credit_balance` is `not_applicable`
        // because payments tracks intents, not drawn credit against limits.
        ->and($outcomes['credit_balance']['outcome'])->toBe('not_applicable')
        ->and($outcomes['credit_balance']['reason'])->toBeString()
        // And the one the integration wave made real answers for itself.
        ->and($outcomes['open_orders']['outcome'])->toBe('clear');

    // Nothing is outstanding for this company, so the same call moved it on.
    // The waiver has its own case below, because a waiver is only legal from
    // `settlement_pending` and a wind-up with nothing to waive cannot reach it.
    expect($checked->json('data.offboarding.status'))->toBe(OffboardingStatus::AwaitingSignoff->value);

    // -------------------------------------------------------------- sign-off

    $this->postJson("/api/v1/platform/b2b/offboardings/{$id}/signoff-challenges", [], $this->platformHeaders)
        ->assertStatus(202)
        ->assertJsonPath('data.challenge.purpose', 'b2b_signatory')
        // Masked, and server-authored. An operator learning the signatory's full
        // address from this response would learn it from a screen that has no
        // reason to show it.
        ->assertJsonStructure(['data' => ['challenge' => ['challenge_id', 'destination_masked', 'expires_at']]]);

    // **The refusal that matters most in this file.** The operator holds every
    // permission on the route and still cannot sign the company out: sign-off
    // turns on a consumed `b2b_signatory` challenge belonging to the caller, and
    // they hold none.
    $this->postJson("/api/v1/platform/b2b/offboardings/{$id}/signoff", [
        'signatory_name' => 'A. Signatory',
        'signatory_title' => 'Managing Director',
        'consent_statement' => 'I accept that the agreement ends.',
        'otp_challenge_id' => (string) Str::uuid7(),
    ], $this->platformHeaders)
        ->assertForbidden()
        ->assertJsonPath('error.code', 'b2b.signatory_required');

    // The signatory signs for themselves, with a passcode they have spent.
    $signatory = $this->world['signatory'];
    $challenge = B2bWorld::spentSignatoryChallenge($signatory);

    B2bWorld::member($this->platform, $signatory);
    grantPlatformOffboardingRole($signatory);

    offboardingSmokeActAs($signatory);

    $signed = $this->postJson("/api/v1/platform/b2b/offboardings/{$id}/signoff", [
        'signatory_name' => 'A. Signatory',
        'signatory_title' => 'Managing Director',
        'consent_statement' => 'I accept that the agreement ends.',
        'document_sha256' => hash('sha256', 'wind-up-statement-v1'),
        'otp_challenge_id' => (string) $challenge->getKey(),
    ], $this->platformHeaders)
        ->assertOk()
        ->assertJsonPath('data.offboarding.status', OffboardingStatus::SignedOff->value)
        ->assertJsonPath('data.offboarding.signoff.signatory_title', 'Managing Director');

    // The corroboration hashes are stored and never served.
    expect($signed->json('data.offboarding.signoff'))->not->toHaveKey('ip_hash')
        ->and($signed->json('data.offboarding.signoff'))->not->toHaveKey('user_agent_hash')
        ->and(B2bOffboarding::query()->findOrFail($id)->signoff_ip_hash)->not->toBeNull();

    // ------------------------------------------------------------ revocation

    offboardingSmokeActAs($this->operator);

    // **The queue is faked here, and the reason is the shape of the endpoint
    // rather than a convenience.** `RevokeBusinessAccess` hands straight on to
    // `archive()`, so under this suite's `sync` queue the one request would run
    // the whole remainder of the wind-up and the archive endpoint would be
    // unreachable — always answering `409` from `completed`. Faking it leaves
    // the wind-up where a real deployment leaves it between the request and the
    // worker, which is the state the archive endpoint exists to be called from
    // when the job's own attempt failed. `OffboardingRevocationSmokeTest` runs
    // the job itself.
    Queue::fake();

    $key = (string) Str::uuid7();

    $this->postJson(
        "/api/v1/platform/b2b/offboardings/{$id}/revoke-access",
        [],
        $this->platformHeaders + ['Idempotency-Key' => $key],
    )
        // 202: the transition is written here and the work is a retryable job.
        ->assertStatus(202)
        ->assertJsonPath('data.offboarding.status', OffboardingStatus::Revoking->value)
        // The counts are still null. They fill in when the worker gets there,
        // which is what makes a `GET` of the wind-up worth having.
        ->assertJsonPath('data.offboarding.revocation.memberships_revoked', null);

    Queue::assertPushed(RevokeBusinessAccess::class, 1);

    // The replay repeats the original envelope rather than dispatching again.
    $this->postJson(
        "/api/v1/platform/b2b/offboardings/{$id}/revoke-access",
        [],
        $this->platformHeaders + ['Idempotency-Key' => $key],
    )
        ->assertStatus(202)
        ->assertHeader('Idempotency-Replayed', 'true');

    Queue::assertPushed(RevokeBusinessAccess::class, 1);

    // --------------------------------------------------------------- archive

    $archived = $this->postJson("/api/v1/platform/b2b/offboardings/{$id}/archive", [], $this->platformHeaders)
        ->assertOk()
        ->assertJsonPath('data.offboarding.status', OffboardingStatus::Completed->value)
        // Said out loud rather than inferred from the summary's silence.
        ->assertJsonPath('data.offboarding.archive.legal_entity_retained', true);

    expect($archived->json('data.offboarding.archive.summary'))->toBeArray();

    // The legal entity survives the purge, which is the half that is easy to
    // get wrong in the other direction.
    expect(Organisation::query()->whereKey($this->world['organisation']->getKey())->exists())->toBeTrue();

    // Cancelling is no longer on the table, and the refusal says what is.
    $this->postJson("/api/v1/platform/b2b/offboardings/{$id}/cancel", [
        'reason' => 'We changed our minds about all of this.',
    ], $this->platformHeaders)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'offboarding.refused');
});

it('lets the second permission set an outstanding position aside, and files it as a waiver', function (): void {
    // A company with food in flight. Stubbed rather than placed, because a real
    // order needs a *seller* with a channel and a tariff, and what this case is
    // about is the authority rather than the arithmetic — the named path above
    // already proves the real check answers for itself.
    $this->app->bind(SellerOpenOrders::class, fn (): object => new class implements SellerOpenOrders
    {
        public function hasOpenOrders(string $organisationId): bool
        {
            return true;
        }

        /**
         * @return list<array{id: string, order_number: string, status: string, placed_at: string, requested_delivery_date: string|null}>
         */
        public function openOrderSummaries(string $organisationId): array
        {
            return [[
                'id' => 'order-1',
                'order_number' => 'H360-0001',
                'status' => 'confirmed',
                'placed_at' => '2026-08-01T09:00:00+00:00',
                'requested_delivery_date' => '2026-08-05',
            ]];
        }

        public function isAnswerable(): bool
        {
            return true;
        }
    });

    $this->actingAs($this->operator);

    $id = $this->postJson('/api/v1/platform/b2b/offboardings', [
        'organisation_id' => (string) $this->world['organisation']->getKey(),
        'trigger' => OffboardingTrigger::Termination->value,
    ], $this->platformHeaders)->assertCreated()->json('data.offboarding.id');

    $this->postJson("/api/v1/platform/b2b/offboardings/{$id}/settlement-checks", [], $this->platformHeaders)
        ->assertOk()
        // Held, not waved through. A real blocker keeps the wind-up where it is.
        ->assertJsonPath('data.offboarding.status', OffboardingStatus::SettlementPending->value)
        ->assertJsonPath('data.offboarding.settlement.status', SettlementStatus::Pending->value);

    // Sign-off is refused with the blocker list rather than a generic conflict:
    // the remedy is to settle or waive, not to retry.
    $this->postJson("/api/v1/platform/b2b/offboardings/{$id}/signoff-challenges", [], $this->platformHeaders)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'offboarding.refused');

    // An unexplained waiver is a field error before the service has to refuse
    // it — "a waiver nobody explained is not a waiver".
    $this->postJson("/api/v1/platform/b2b/offboardings/{$id}/settlement-waiver", ['reason' => 'no'], $this->platformHeaders)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    $waived = $this->postJson("/api/v1/platform/b2b/offboardings/{$id}/settlement-waiver", [
        'reason' => 'The final delivery is completed as a goodwill gesture.',
    ], $this->platformHeaders)
        ->assertOk()
        ->assertJsonPath('data.offboarding.settlement.status', SettlementStatus::Waived->value)
        ->assertJsonPath('data.offboarding.settlement.waived_by', (string) $this->operator->getKey())
        ->assertJsonPath('data.offboarding.status', OffboardingStatus::AwaitingSignoff->value);

    expect($waived->json('data.offboarding.settlement.waiver_reason'))->toContain('goodwill');

    // Its own audit action, carrying what was outstanding at the moment somebody
    // let it go. A waiver recorded as a clearance erases the only difference a
    // dispute turns on.
    $audit = AuditLog::query()
        ->where('action', 'b2b.offboarding_settlement_waived')
        ->where('subject_id', $id)
        ->sole();

    expect($audit->metadata['blockers_at_waiver'])->toBe(['open_orders'])
        ->and(AuditLog::query()
            ->where('action', 'b2b.offboarding_awaiting_signoff')
            ->where('subject_id', $id)
            ->exists())->toBeFalse();
});

it('hands over a records bundle only to somebody who says what it is for', function (): void {
    $this->actingAs($this->operator);

    $started = $this->postJson('/api/v1/platform/b2b/offboardings', [
        'organisation_id' => (string) $this->world['organisation']->getKey(),
        'trigger' => OffboardingTrigger::ClientRequest->value,
    ], $this->platformHeaders)->assertCreated();

    $id = $started->json('data.offboarding.id');

    $requested = $this->postJson("/api/v1/platform/b2b/offboardings/{$id}/exports", [], $this->platformHeaders)
        // 202: requesting is not building. Assembling a bundle reads a whole
        // history and hashes it.
        ->assertStatus(202)
        ->assertJsonPath('data.export.b2b_offboarding_id', $id);

    $exportId = $requested->json('data.export.id');

    // The object key is never on the wire. It is one half of a credential, and
    // the only route to the bytes is a fresh signature.
    expect($requested->json('data.export'))->not->toHaveKey('path')
        ->and($requested->json('data.export'))->not->toHaveKey('disk');

    // The queue is `sync` in this suite, so the build ran inside the request.
    $export = RecordExport::query()->findOrFail($exportId);
    expect($export->status)->toBe(RecordExportStatus::Ready)
        ->and($export->sha256)->toBeString();

    // Without a purpose this is a read: the manifest and the digest, and nothing
    // is issued or audited as a download.
    $this->getJson("/api/v1/platform/b2b/offboardings/{$id}/exports/{$exportId}", $this->platformHeaders)
        ->assertOk()
        ->assertJsonPath('data.export.status', RecordExportStatus::Ready->value)
        ->assertJsonMissingPath('data.export.download_url');

    expect(RecordExport::query()->findOrFail($exportId)->download_count)->toBe(0);

    // With one, a short-lived URL comes back **in the envelope** — never a 302,
    // which would put an expiring credential into browser history and every
    // proxy log on the way to the bucket.
    $downloaded = $this->getJson(
        "/api/v1/platform/b2b/offboardings/{$id}/exports/{$exportId}?purpose=handover_to_customer",
        $this->platformHeaders,
    )
        ->assertOk()
        ->assertJsonPath('data.export.download_count', 1);

    expect($downloaded->json('data.export.download_url'))->toBeString()
        ->and($downloaded->json('data.export.download_url_expires_at'))->toBeString();

    // The access is on the record with the stated reason.
    $access = AuditLog::query()
        ->where('action', 'b2b.record_export_downloaded')
        ->where('subject_id', $exportId)
        ->sole();

    expect($access->metadata['stated_purpose'])->toBe('handover_to_customer')
        // Never the URL and never the path: an audit row is read by more people
        // than the export is.
        ->and($access->metadata)->not->toHaveKey('path');

    // A blank purpose is a malformed request rather than a failed business rule,
    // and the bundle is not the thing that is wrong.
    $this->getJson(
        "/api/v1/platform/b2b/offboardings/{$id}/exports/{$exportId}?purpose=",
        $this->platformHeaders,
    )->assertOk();
});

/**
 * Swap the acting identity between two requests in one test.
 *
 * A deployed request cycle re-derives the user from the cookie every time; a
 * test process keeps the resolved guard, and Sanctum's `AuthenticateSession`
 * then invalidates the carried-over session for the *new* user, which surfaces
 * as an unexplained `401`. Flushing the session and setting the user on the
 * default guard is the same move `B2bApplicationApiSmokeTest` makes, and this
 * file needs it for the same reason: the operator drives the wind-up and only
 * the signatory can sign it off.
 */
function offboardingSmokeActAs(User $user): void
{
    forgetResolvedGuards();

    app('session')->driver()->flush();

    app('auth')->guard()->setUser($user);
    app('auth')->shouldUse(null);
}

/**
 * Give somebody the platform offboarding authority, inside the platform
 * organisation and nowhere else.
 *
 * The demo seeder grants every platform code to `ops@healthy360.test` through a
 * bespoke organisation-scoped role; a second person who has to sign a company
 * out needs the same role rather than a second grant, so this attaches them to
 * it. Declared as a function with a distinctive name for the reason every
 * fixture in this codebase is a class: Pest loads the whole suite into one
 * process.
 */
function grantPlatformOffboardingRole(User $user): void
{
    $platform = Organisation::query()->where('slug', 'healthy360-operations')->sole();

    $role = Role::withoutTenancy()
        ->where('organisation_id', $platform->getKey())
        ->where('code', 'reference_editor')
        ->sole();

    $membership = OrganisationMembership::withoutTenancy()
        ->where('organisation_id', $platform->getKey())
        ->where('user_id', $user->getKey())
        ->sole();

    MembershipRole::withoutTenancy()->firstOrCreate([
        'membership_id' => $membership->getKey(),
        'role_id' => $role->getKey(),
    ], [
        'organisation_id' => $platform->getKey(),
    ]);
}
