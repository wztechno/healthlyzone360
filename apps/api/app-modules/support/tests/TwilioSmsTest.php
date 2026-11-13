<?php

declare(strict_types=1);

use Healthy360\Support\Alerts\SendStaffAlertSms;
use Healthy360\Support\Alerts\TwilioSms;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Http;

beforeEach(function (): void {
    config(['services.twilio' => ['sid' => 'ACtest', 'token' => 'token', 'from' => '+15005550006']]);
    Exceptions::fake();
});

it('reports a refused SMS without the number or the message', function (): void {
    Http::fake(['api.twilio.com/*' => Http::response(['code' => 21211, 'message' => "The 'To' number +96170123456 is not valid"], 400)]);

    app(TwilioSms::class)->send('+96170123456', 'Order H-1001');

    Exceptions::assertReported(fn (RuntimeException $e): bool => $e->getMessage() === 'Twilio refused an SMS: HTTP 400, code 21211.');
});

it('reports an unreachable Twilio rather than throwing it', function (): void {
    Http::fake(fn () => throw new ConnectionException('Twilio is unreachable.'));

    app(TwilioSms::class)->send('+96170123456', 'Order H-1001');

    Exceptions::assertReported(ConnectionException::class);
});

it('throws what is worth retrying to the job that can retry it', function (int $status): void {
    Http::fake(['api.twilio.com/*' => Http::response(['code' => 20429], $status)]);

    app(TwilioSms::class)->attempt('+96170123456', 'Order H-1001');
})->with([503, 429])->throws(RuntimeException::class, 'Twilio refused an SMS');

it('reports a refusal rather than retrying it', function (): void {
    Http::fake(['api.twilio.com/*' => Http::response(['code' => 21211], 400)]);

    app(TwilioSms::class)->attempt('+96170123456', 'Order H-1001');

    Exceptions::assertReported(RuntimeException::class);
});

it('gives the escalation text its retries', function (): void {
    $job = new SendStaffAlertSms('user', 'Order H-1001');

    expect($job->tries)->toBe(4)->and($job->backoff)->toBe([30, 90, 180]);
});
