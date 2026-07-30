<?php

declare(strict_types=1);

namespace Healthy360\Audit\Listeners;

use Healthy360\Audit\Services\AuditRecorder;
use Illuminate\Auth\Events\Failed;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Auth\Events\Login;
use Illuminate\Auth\Events\Logout;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Events\Dispatcher;
use Illuminate\Http\Request;

/**
 * Turns Laravel's authentication events into audit rows (plan §12).
 *
 * Only the identifiers needed to investigate an incident are stored: never
 * the submitted password, never a token, never a two-factor code. The
 * attempted email is retained on failures because account-takeover triage is
 * impossible without it; the AuditRecorder redaction filter is the backstop.
 *
 * The handlers are deliberately not named handle*: subscribe() is the
 * authoritative mapping, and a handle* method would additionally be picked
 * up by event discovery and register every listener a second time.
 */
final class AuthenticationEventSubscriber
{
    public function __construct(
        private readonly AuditRecorder $audit,
        private readonly Request $request,
    ) {}

    public function onLogin(Login $event): void
    {
        $this->audit->record('auth.login_succeeded', (string) $event->user->getAuthIdentifier(), metadata: [
            'guard' => $event->guard,
            'remember' => $event->remember,
        ] + $this->client());
    }

    public function onFailed(Failed $event): void
    {
        $email = $event->credentials['email'] ?? null;

        $this->audit->record(
            'auth.login_failed',
            $event->user?->getAuthIdentifier() === null ? null : (string) $event->user->getAuthIdentifier(),
            subjectType: 'user',
            subjectId: $event->user?->getAuthIdentifier() === null ? null : (string) $event->user->getAuthIdentifier(),
            metadata: [
                'guard' => $event->guard,
                'attempted_email' => is_string($email) ? $email : null,
            ] + $this->client(),
        );
    }

    public function onLogout(Logout $event): void
    {
        $this->audit->record('auth.logout', (string) $event->user->getAuthIdentifier(), metadata: [
            'guard' => $event->guard,
        ] + $this->client());
    }

    public function onLockout(Lockout $event): void
    {
        $email = $event->request->input('email');

        $this->audit->record('auth.login_locked_out', null, metadata: [
            'attempted_email' => is_string($email) ? $email : null,
        ] + $this->client());
    }

    public function onPasswordReset(PasswordReset $event): void
    {
        $this->audit->record('auth.password_reset', (string) $event->user->getAuthIdentifier(), metadata: $this->client());
    }

    /**
     * @return array<string, scalar|null>
     */
    private function client(): array
    {
        $userAgent = $this->request->userAgent();

        return [
            'ip' => $this->request->ip(),
            'user_agent' => is_string($userAgent) ? mb_substr($userAgent, 0, 255) : null,
            'client_platform' => $this->request->header('X-Client-Platform'),
        ];
    }

    /**
     * @return array<class-string, string>
     */
    public function subscribe(Dispatcher $events): array
    {
        return [
            Login::class => 'onLogin',
            Failed::class => 'onFailed',
            Logout::class => 'onLogout',
            Lockout::class => 'onLockout',
            PasswordReset::class => 'onPasswordReset',
        ];
    }
}
