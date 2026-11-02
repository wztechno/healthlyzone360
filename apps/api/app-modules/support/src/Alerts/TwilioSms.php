<?php

declare(strict_types=1);

namespace Healthy360\Support\Alerts;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use SensitiveParameter;
use Throwable;

/**
 * One text message through Twilio's Messages endpoint, with Laravel's `Http`
 * client rather than a new package.
 *
 * With any setting missing it sends nothing and logs one line naming what is
 * missing, so a deployment without Twilio still alerts by bell and email.
 *
 * **Nothing here reaches a log with the number or the message in it.** Twilio's
 * error text can quote the number, and `RequestException` carries that text, so
 * a refusal is reported as its status and Twilio's error code alone.
 * `#[\SensitiveParameter]` keeps both out of a stack trace.
 *
 * `send()` reports a failure and never throws: an SMS that did not go must not
 * fail what caused it. `attempt()` is for a queued job that can try again: a
 * failure worth repeating (Twilio unreachable, a 429 or a 5xx) is thrown for the
 * job's `tries` and `backoff` to take up, and a refusal, which would only be
 * refused again, is reported as usual.
 */
final class TwilioSms
{
    private const string MESSAGES_URL = 'https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json';

    private const int TIMEOUT_SECONDS = 10;

    public function send(#[SensitiveParameter] string $to, #[SensitiveParameter] string $body): void
    {
        try {
            $this->attempt($to, $body);
        } catch (Throwable $e) {
            report($e);
        }
    }

    /**
     * @throws ConnectionException when Twilio cannot be reached
     * @throws RuntimeException when Twilio answers with a 429 or a 5xx
     */
    public function attempt(#[SensitiveParameter] string $to, #[SensitiveParameter] string $body): void
    {
        $sid = (string) config('services.twilio.sid');
        $token = (string) config('services.twilio.token');
        $from = (string) config('services.twilio.from');

        $missing = array_keys(array_filter(
            ['TWILIO_SID' => $sid, 'TWILIO_TOKEN' => $token, 'TWILIO_FROM' => $from],
            static fn (string $value): bool => $value === '',
        ));

        if ($missing !== []) {
            Log::warning('SMS not sent: Twilio is not configured.', ['missing' => $missing]);

            return;
        }

        $response = Http::asForm()
            ->withBasicAuth($sid, $token)
            ->timeout(self::TIMEOUT_SECONDS)
            ->post(sprintf(self::MESSAGES_URL, $sid), ['To' => $to, 'From' => $from, 'Body' => $body]);

        if (! $response->failed()) {
            return;
        }

        $failure = new RuntimeException(sprintf(
            'Twilio refused an SMS: HTTP %d, code %s.',
            $response->status(),
            (string) $response->json('code'),
        ));

        if ($response->serverError() || $response->tooManyRequests()) {
            throw $failure;
        }

        report($failure);
    }
}
