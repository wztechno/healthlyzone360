<?php

declare(strict_types=1);

namespace Healthy360\Verification\Providers;

use App\Models\User;
use Healthy360\Verification\Channels\LogOtpDriver;
use Healthy360\Verification\Channels\MailOtpDriver;
use Healthy360\Verification\Channels\OtpChannelRegistry;
use Healthy360\Verification\Contracts\OtpChannelDriver;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Services\EmailVerificationMessenger;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Support\ServiceProvider;

class VerificationServiceProvider extends ServiceProvider
{
    /**
     * The channel registry is a singleton built from configuration, so the
     * mapping from channel to driver is decided once and is the same for every
     * caller in a request.
     */
    public function register(): void
    {
        $this->app->singleton(OtpChannelRegistry::class, function (Application $app): OtpChannelRegistry {
            $drivers = [];

            foreach (OtpChannel::cases() as $channel) {
                $driver = $this->driverFor($app, $channel);

                if ($driver instanceof OtpChannelDriver) {
                    $drivers[$channel->value] = $driver;
                }
            }

            return new OtpChannelRegistry($drivers);
        });
    }

    public function boot(): void
    {
        $this->loadViewsFrom(__DIR__.'/../../resources/views', 'verification');

        $this->configureEmailVerification();
    }

    /**
     * The verification email carries the signed link **and** a passcode
     * (D-036).
     *
     * Overridden through `toMailUsing` rather than by replacing the
     * notification class, because that is the seam Laravel provides and the
     * notification stays Laravel's — the URL, the signature, the expiry and
     * the throttling all keep working exactly as they did. If a code cannot be
     * issued the messenger returns a link-only message, so the older path is
     * never worse than it was.
     */
    private function configureEmailVerification(): void
    {
        VerifyEmail::toMailUsing(function (mixed $notifiable, string $url): MailMessage {
            if (! $notifiable instanceof User) {
                return (new MailMessage)
                    ->subject(__('verification.email_verification.subject', ['app' => (string) config('app.name')]))
                    ->line(__('verification.email_verification.intro'))
                    ->action(__('verification.email_verification.action'), $url);
            }

            return $this->app->make(EmailVerificationMessenger::class)->build($notifiable, $url);
        });
    }

    /**
     * The driver a channel is configured to use, or null when the channel is
     * disabled or names a driver that does not exist.
     *
     * An unknown driver name yields no driver rather than an exception at boot
     * time: a typo in one channel's configuration must not take the
     * application down, and the registry's own refusal (`ChannelUnavailable`)
     * is a far more legible failure at the point of use.
     */
    private function driverFor(Application $app, OtpChannel $channel): ?OtpChannelDriver
    {
        $config = config('verification.channels.'.$channel->value);

        if (! is_array($config) || ($config['enabled'] ?? false) !== true) {
            return null;
        }

        return match ($config['driver'] ?? null) {
            'mail' => $app->make(MailOtpDriver::class),
            'log' => new LogOtpDriver($channel),
            default => null,
        };
    }
}
