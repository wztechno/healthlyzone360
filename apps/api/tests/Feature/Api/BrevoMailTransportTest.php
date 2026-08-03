<?php

declare(strict_types=1);

it('configures the Brevo mailer and resolves a transport', function (): void {
    expect(config('mail.mailers.brevo.transport'))->toBe('brevo');

    $transport = app('mail.manager')->mailer('brevo')->getSymfonyTransport();

    expect($transport)->not->toBeNull();
});
