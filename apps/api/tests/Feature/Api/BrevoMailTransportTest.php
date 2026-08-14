<?php

declare(strict_types=1);

it('registers Brevo as a named mailer', function (): void {
    expect(config('mail.mailers.brevo.transport'))->toBe('brevo');
});

/**
 * The key *is* the DSN user: `AppServiceProvider::configureBrevoMailTransport`
 * passes `null` when `services.brevo.key` is empty, and Symfony's factory
 * refuses a keyless DSN with `IncompleteDsnException`. So a transport can only
 * be built where a key is configured — which CI, holding no Brevo secret, is
 * not. Skipping states that; asserting it would only prove the environment.
 */
it('resolves a transport once a key is configured', function (): void {
    $transport = app('mail.manager')->mailer('brevo')->getSymfonyTransport();

    expect($transport)->not->toBeNull();
})->skip(
    fn (): bool => (string) config('services.brevo.key') === '',
    'No Brevo API key is configured in this environment.',
);
