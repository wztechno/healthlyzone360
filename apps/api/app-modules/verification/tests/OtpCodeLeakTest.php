<?php

declare(strict_types=1);

use Healthy360\Audit\Models\AuditLog;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Services\OtpService;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/*
|--------------------------------------------------------------------------
| The passcode must not exist anywhere it can be read
|--------------------------------------------------------------------------
|
| The single invariant the whole OTP design rests on: a six-digit secret is
| worthless if it is written down. Four places are where that would happen by
| accident, and they are checked together because they are one property rather
| than four:
|
|   * **The application log.** The SMS and WhatsApp drivers do not deliver, and
|     the obvious convenience — writing the code where a developer can read it —
|     would ship straight to production, where logs are aggregated, indexed and
|     read by people who are not the account holder.
|   * **The audit trail.** `AuditRecorder` redacts by key substring, so a
|     metadata key containing `code` is blanked — but a key named something
|     else carrying the same value would sail through. The assertion is on the
|     value, not on the key.
|   * **The stored row.** Only the HMAC digest is persisted, which is what makes
|     a database dump useless.
|   * **The queue payload.** `ShouldBeEncrypted` is a declaration, and a
|     declaration is exactly the kind of thing a refactor drops. The second test
|     pushes onto a real durable queue and reads what was actually written.
|
*/

beforeEach(function (): void {
    // The one affordance that hands a plaintext code back, so the sweep knows
    // the literal to hunt for. Production cannot reach it: `exposesCodes()`
    // ANDs this flag with the environment.
    config()->set('verification.otp.expose_codes', true);
});

it('never writes a passcode to a log, an audit record or the challenge row', function (): void {
    $captured = [];

    // A real listener rather than a mocked facade method: a driver logging
    // through any of Laravel's logging entry points lands here, where a
    // partial mock of one method would miss it.
    Log::listen(function (MessageLogged $event) use (&$captured): void {
        $captured[] = $event->message.' '.json_encode($event->context);
    });

    $contact = ContactPoint::factory()->phone()->create();

    // The simulated channel deliberately: its whole job is to stand in for a
    // delivery that does not happen, which makes it the one most tempted to
    // log what it would have sent.
    $result = app(OtpService::class)->issue(
        contact: $contact,
        purpose: OtpPurpose::ContactVerification,
        channel: OtpChannel::Sms,
    );

    $code = (string) $result->debugCode;

    expect($code)->not->toBe('');

    $challenge = OtpChallenge::query()->whereKey($result->challenge->getKey())->firstOrFail();

    $auditTrail = AuditLog::query()->get()
        ->map(static fn (AuditLog $log): string => $log->action.' '.json_encode($log->metadata))
        ->implode(' ');

    expect(implode(' ', $captured))->not->toContain($code)
        // Not vacuous: the driver did log the delivery, and the service did
        // audit the issue. Both trails exist and neither carries the code.
        ->and(implode(' ', $captured))->toContain('Simulated passcode delivery')
        ->and($auditTrail)->toContain('verification.otp_issued')
        ->and($auditTrail)->not->toContain($code)
        ->and(json_encode($challenge->getAttributes()))->not->toContain($code)
        ->and($challenge->code_hash)->not->toBe($code)
        // A "mask" that carried the whole value would defeat every enumeration
        // defence built on top of it.
        ->and($challenge->destination_masked)->not->toBe($contact->value_normalised);
});

it('keeps the passcode out of a queue payload a worker can read', function (): void {
    // A durable connection rather than `sync`, because the property under test
    // is what gets *written down* while the job waits for a worker.
    config()->set('queue.default', 'database');

    $contact = ContactPoint::factory()->create();

    $result = app(OtpService::class)->issue(
        contact: $contact,
        purpose: OtpPurpose::ContactVerification,
        channel: OtpChannel::Email,
    );

    $code = (string) $result->debugCode;
    $payload = (string) DB::table('jobs')->value('payload');

    expect($payload)->not->toBe('')
        ->and($payload)->toContain('SendOtpMessage')
        ->and($payload)->not->toContain($code)
        ->and(DB::table('jobs')->value('queue'))->toBe('notifications');
});
