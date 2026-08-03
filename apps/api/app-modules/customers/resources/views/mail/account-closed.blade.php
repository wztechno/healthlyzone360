{{--
    The closure confirmation.

    Plain HTML for the reason the passcode message gives: Laravel's markdown
    mail components pull a published stylesheet this application has never
    published. `dir` and `text-align` come from the recipient's language, which
    was resolved before the profile holding it was redacted.

    There is no greeting and no name. The whole point of the message is that
    the platform no longer knows who it is writing to.
--}}
<!DOCTYPE html>
<html lang="{{ $locale }}" dir="{{ $direction }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ __('closure.closed.subject', ['app' => config('app.name')], $locale) }}</title>
</head>
<body style="margin:0;padding:24px;background:#f5f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1a1c1e;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;text-align:{{ $direction === 'rtl' ? 'right' : 'left' }};">

    <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
        {{ __('closure.closed.intro', ['app' => config('app.name')], $locale) }}
    </p>

    <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
        @if ($ordersRetained > 0)
            {{ __('closure.closed.orders_retained', ['count' => $ordersRetained], $locale) }}
        @else
            {{ __('closure.closed.orders_none', [], $locale) }}
        @endif
    </p>

    <p style="margin:0 0 24px;font-size:16px;line-height:1.5;font-weight:600;">
        {{ __('closure.closed.unexpected', [], $locale) }}
    </p>

    <p style="margin:0;font-size:14px;line-height:1.5;color:#5b6166;">
        {{ __('closure.closed.signoff', [], $locale) }}
    </p>

</div>
</body>
</html>
