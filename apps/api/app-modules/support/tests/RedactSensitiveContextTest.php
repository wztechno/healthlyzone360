<?php

declare(strict_types=1);

use Healthy360\Support\Logging\RedactSensitiveContext;
use Illuminate\Support\Facades\Log;
use Monolog\Level;
use Monolog\LogRecord;

/*
|--------------------------------------------------------------------------
| Central log redaction (plan §12)
|--------------------------------------------------------------------------
|
| A redaction processor is only worth having if it survives the payloads that
| actually reach a log file: deeply nested arrays, exceptions quoting the
| input that broke them, and keys nobody thought to add to a deny-list.
|
*/

/**
 * @param  array<string, mixed>  $context
 * @param  array<string, mixed>  $extra
 */
function redacted(array $context, string $message = 'test', array $extra = []): LogRecord
{
    return (new RedactSensitiveContext)(new LogRecord(
        datetime: new DateTimeImmutable,
        channel: 'testing',
        level: Level::Info,
        message: $message,
        context: $context,
        extra: $extra,
    ));
}

it('drops every denied key whatever its spelling', function (string $key): void {
    expect(redacted([$key => 'the-actual-secret'])->context[$key])->toBe('[redacted]');
})->with([
    'password',
    'Password',
    'password_confirmation',
    'current_password',
    'token',
    'access_token',
    'refresh_token',
    'API_TOKEN',
    'secret',
    'two_factor_secret',
    'two_factor_recovery_codes',
    'recovery_code',
    'authorization',
    'Authorization',
    'X-Authorization',
    'cookie',
    'Set-Cookie',
]);

it('walks nested arrays, exceptions and objects', function (): void {
    $record = redacted([
        'request' => [
            'headers' => [
                'authorization' => 'Bearer 12|abcdefghijklmnopqrstuvwxyz0123456789',
                'x-client-platform' => 'ios',
            ],
            'body' => [
                'email' => 'nadia.haddad@cedar.test',
                'password' => 'Str0ng!Passphrase',
                'profile' => ['given_name' => 'Nadia', 'two_factor_secret' => 'JBSWY3DPEHPK3PXP'],
            ],
        ],
        'exception' => new RuntimeException('Rejected token 42|zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz for maya@healthy360.test'),
        'principal' => (object) ['id' => 'user-1', 'secret' => 'nope'],
    ]);

    /** @var array<string, mixed> $context */
    $context = $record->context;

    expect($context)->toMatchArray([
        'request' => [
            'headers' => [
                'authorization' => '[redacted]',
                'x-client-platform' => 'ios',
            ],
            'body' => [
                'email' => 'n***@cedar.test',
                'password' => '[redacted]',
                'profile' => ['given_name' => 'Nadia', 'two_factor_secret' => '[redacted]'],
            ],
        ],
        'principal' => ['id' => 'user-1', 'secret' => '[redacted]'],
    ]);

    expect($context['exception'])->toMatchArray(['class' => RuntimeException::class])
        ->and($context['exception']['message'])->toBe('Rejected token [redacted] for m***@healthy360.test');
});

it('scrubs secrets that arrive inside otherwise innocent strings', function (string $input, string $expected): void {
    expect(redacted(['note' => $input])->context['note'])->toBe($expected);
})->with([
    'bearer header' => ['Authorization: Bearer abcdefghijklmnop', 'Authorization: [redacted]'],
    'basic header' => ['Basic bmFkaWE6c2VjcmV0Cg==', '[redacted]'],
    'sanctum token' => ['token 7|aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789', 'token [redacted]'],
    'json web token' => ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.7Hs9', '[redacted]'],
    'email' => ['contact rami.khoury@cedar.test today', 'contact r***@cedar.test today'],
    'nothing to scrub' => ['branch Hamra opened', 'branch Hamra opened'],
]);

it('redacts the message itself, not only the context', function (): void {
    expect(redacted([], 'login failed for layla@verdant.test')->message)
        ->toBe('login failed for l***@verdant.test');
});

it('redacts the extra channel as well as the context', function (): void {
    expect(redacted([], 'test', ['session_cookie' => 'abc'])->extra)
        ->toBe(['session_cookie' => '[redacted]']);
});

it('caps traversal depth instead of following a pathological payload', function (): void {
    $deep = 'bottom';

    for ($i = 0; $i < 40; $i++) {
        $deep = ['level' => $deep];
    }

    /** @var array<string, mixed> $context */
    $context = redacted(['payload' => $deep])->context;

    $flattened = json_encode($context);

    expect($flattened)->toBeString()
        ->and($flattened)->toContain('[redacted]')
        ->and($flattened)->not->toContain('bottom');
});

it('leaves scalars and enums intact', function (): void {
    $context = redacted(['count' => 7, 'enabled' => true, 'missing' => null, 'level' => Level::Warning])->context;

    expect($context)->toBe(['count' => 7, 'enabled' => true, 'missing' => null, 'level' => Level::Warning]);
});

it('is attached to every channel the application can actually log through', function (string $channel): void {
    $processors = Log::channel($channel)->getLogger()->getProcessors();

    $classes = array_map(static fn (callable $processor): string => $processor::class, $processors);

    expect($classes)->toContain(RedactSensitiveContext::class);
})->with(['single', 'daily', 'stack', 'stderr', 'syslog', 'errorlog']);
