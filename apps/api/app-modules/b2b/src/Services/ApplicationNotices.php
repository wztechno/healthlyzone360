<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use App\Models\User;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Support\Mail\NoticeMessage;
use Illuminate\Support\Facades\Mail;
use Throwable;

use function Illuminate\Support\defer;

/**
 * The emails that keep an applicant moving through onboarding, and the one
 * that carries an invitation token to a provisioned company's contacts.
 *
 * Every step after submission is somebody else's move followed by the
 * applicant's, and without a message the applicant only learns it is their
 * turn by reopening `/apply`. Each notice says what happened and links to the
 * one screen where it is acted on.
 *
 * Sent with `defer()` for the reason `QuotationNotices::send()` gives: on the
 * `sync` queue a queued mail runs inline and clears the tenant context mid
 * request. A mail failure is reported, never thrown — the state move it
 * describes has already happened.
 */
final readonly class ApplicationNotices
{
    public function informationRequested(B2bApplication $application): void
    {
        $this->toApplicant($application, 'b2b_application_information_requested', fn (string $locale): array => [
            __('notices.b2b_application.information_requested.heading', ['reference' => $application->reference], $locale),
            array_values(array_filter([$application->information_request])),
            __('notices.b2b_application.information_requested.action', [], $locale),
            '/apply',
        ]);
    }

    public function approved(B2bApplication $application): void
    {
        $this->toApplicant($application, 'b2b_application_approved', fn (string $locale): array => [
            __('notices.b2b_application.approved.heading', ['reference' => $application->reference], $locale),
            array_values(array_filter([
                $application->applicant_message,
                (string) __('notices.b2b_application.approved.next', [], $locale),
            ])),
            __('notices.b2b_application.approved.action', [], $locale),
            '/apply/status',
        ]);
    }

    public function declined(B2bApplication $application): void
    {
        $this->toApplicant($application, 'b2b_application_declined', fn (string $locale): array => [
            __('notices.b2b_application.declined.heading', ['reference' => $application->reference], $locale),
            array_values(array_filter([$application->applicant_message])),
            __('notices.b2b_application.declined.action', [], $locale),
            '/apply/status',
        ]);
    }

    public function agreementSent(B2bApplication $application, B2bAgreement $agreement): void
    {
        $seller = $this->sellerName($agreement);

        $this->toApplicant($application, 'b2b_agreement_sent', fn (string $locale): array => [
            __('notices.b2b_application.agreement_sent.heading', ['reference' => $application->reference], $locale),
            $seller === null ? [] : [(string) __('notices.b2b_application.agreement_sent.seller', ['seller' => $seller], $locale)],
            __('notices.b2b_application.agreement_sent.action', [], $locale),
            '/apply/agreement',
        ]);
    }

    public function provisioned(B2bApplication $application, Organisation $organisation): void
    {
        $this->toApplicant($application, 'b2b_application_provisioned', fn (string $locale): array => [
            __('notices.b2b_application.provisioned.heading', ['company' => $organisation->name], $locale),
            [(string) __('notices.b2b_application.provisioned.next', [], $locale)],
            __('notices.b2b_application.provisioned.action', [], $locale),
            '/corporate',
        ]);
    }

    /**
     * The invitation link, to a contact who has no account yet.
     *
     * The token is the only credential in the message. Its language is the new
     * organisation's, because the recipient has no stored preference.
     */
    public function invited(Organisation $organisation, string $email, string $token): void
    {
        $locale = $organisation->default_language_code === 'ar' ? 'ar' : 'en';

        $this->send($email, new NoticeMessage(
            'b2b_invitation',
            __('notices.b2b_invitation.heading', ['company' => $organisation->name], $locale),
            [
                (string) __('notices.b2b_invitation.intro', ['company' => $organisation->name], $locale),
                (string) __('notices.b2b_invitation.expiry', [], $locale),
            ],
            __('notices.b2b_invitation.action', [], $locale),
            $this->url('/invitations/'.rawurlencode($token)),
            $locale,
        ));
    }

    /**
     * The seller the agreement prices from: the kitchen that owns its list.
     */
    public function sellerName(B2bAgreement $agreement): ?string
    {
        if ($agreement->price_list_id === null) {
            return null;
        }

        $organisationId = PriceList::withoutTenancy()->whereKey($agreement->price_list_id)->value('organisation_id');
        $name = is_string($organisationId) ? Organisation::query()->whereKey($organisationId)->value('name') : null;

        return is_string($name) && $name !== '' ? $name : null;
    }

    /**
     * @param  \Closure(string): array{0: string, 1: list<string>, 2: string, 3: string}  $compose
     */
    private function toApplicant(B2bApplication $application, string $kind, \Closure $compose): void
    {
        $email = User::query()->whereKey($application->applicant_user_id)->value('email');

        if (! is_string($email) || $email === '') {
            return;
        }

        $preferred = UserProfile::query()->where('user_id', $application->applicant_user_id)->value('preferred_language_code');
        $locale = $preferred === 'ar' ? 'ar' : 'en';

        [$heading, $lines, $action, $path] = $compose($locale);

        $this->send($email, new NoticeMessage($kind, $heading, $lines, $action, $this->url($path), $locale));
    }

    private function send(string $email, NoticeMessage $message): void
    {
        defer(static function () use ($email, $message): void {
            try {
                Mail::to($email)->queue($message);
            } catch (Throwable $e) {
                report($e);
            }
        });
    }

    private function url(string $path): string
    {
        return rtrim((string) config('app.frontend_url'), '/').$path;
    }
}
