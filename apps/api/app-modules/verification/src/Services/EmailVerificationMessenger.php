<?php

declare(strict_types=1);

namespace Healthy360\Verification\Services;

use App\Models\User;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Exceptions\InvalidContactValue;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Enums\OtpPurpose;
use Illuminate\Notifications\Messages\MailMessage;
use Throwable;

/**
 * One message, two ways to finish (D-036).
 *
 * The verification email carries the signed link **and** a six-digit code, and
 * the reason is the native client. A link opens a browser; a person who
 * started in the app then has to get back to it, and on iOS that round trip
 * loses the session often enough to be the single most common place an
 * onboarding is abandoned. A code in the same message means the person types
 * six digits into the screen they are already looking at. Sending two messages
 * instead would mean two codes for one act and a support conversation about
 * which one is real.
 *
 * The challenge is issued with `deliver: false`, because this message *is* the
 * delivery. `OtpService` still writes the row, the hash, the expiry and the
 * cooldown, so the code obtained this way behaves in every respect like one
 * obtained through the passcode endpoint — same attempt counter, same lockout,
 * same supersession.
 *
 * **Failure here degrades to a link.** If the contact point is missing or a
 * challenge cannot be issued, the message goes out with the link alone rather
 * than not at all: verification by link is the older path and still works, and
 * a person unable to verify their address is a far worse outcome than a
 * message with one route instead of two.
 */
final class EmailVerificationMessenger
{
    public function __construct(
        private readonly OtpService $otp,
        private readonly ContactPointRegistry $contacts,
    ) {}

    public function build(User $user, string $verificationUrl): MailMessage
    {
        // Queried rather than read through the relation accessor: an account
        // without a profile row is unusual but reachable (a fixture, an account
        // created before the profile write), and this path must degrade to the
        // default locale rather than fail while sending a verification email.
        $profile = UserProfile::query()->where('user_id', $user->getKey())->first();
        $locale = $profile->preferred_language_code ?? (string) config('app.locale', 'en');
        $name = $profile?->given_name;
        $minutes = (int) ceil(((int) config('verification.otp.expires_after_seconds', 300)) / 60);

        $message = (new MailMessage)
            ->subject(__('verification.email_verification.subject', ['app' => (string) config('app.name')], $locale))
            ->greeting($name === null
                ? __('verification.email_verification.greeting', [], $locale)
                : __('verification.email_verification.greeting_named', ['name' => $name], $locale))
            ->line(__('verification.email_verification.intro', [], $locale))
            ->action(__('verification.email_verification.action', [], $locale), $verificationUrl);

        $code = $this->codeFor($user);

        if ($code !== null) {
            $message
                ->line(__('verification.email_verification.code_intro', [], $locale))
                ->line($code)
                ->line(trans_choice('verification.email_verification.expiry', $minutes, ['minutes' => $minutes], $locale));
        }

        return $message->line(__('verification.email_verification.unexpected', [], $locale));
    }

    /**
     * The passcode to print, or null when one could not be issued.
     *
     * The code is returned rather than the result object because it is the
     * only part this class may hold, and holding less is the point: the value
     * lives in one local variable, is written into one message, and is never
     * stored, logged or returned anywhere else.
     */
    private function codeFor(User $user): ?string
    {
        try {
            return $this->otp->issueForInlineDelivery(
                contact: $this->loginContact($user),
                purpose: OtpPurpose::ContactVerification,
                channel: OtpChannel::Email,
            )['code'];
        } catch (Throwable) {
            // Degrade to a link-only message. See the class comment.
            return null;
        }
    }

    /**
     * The login mirror, created on demand for accounts that predate it.
     *
     * Registration writes this row in the same transaction as the user
     * (`CreateNewUser`), so in practice it always exists. The fallback covers
     * accounts created before the J1 migration and the seeded demo users,
     * where the alternative — no code — would be a silent difference in
     * behaviour between old and new accounts.
     *
     * @throws InvalidContactValue
     */
    private function loginContact(User $user): ContactPoint
    {
        $contact = $user->loginContact()->first();

        if ($contact instanceof ContactPoint) {
            return $contact;
        }

        return $this->contacts->rememberForUser(
            user: $user,
            channel: ContactChannel::Email,
            value: $user->email,
            isLoginIdentity: true,
            isPrimary: true,
            source: 'registration',
        );
    }
}
