{{--
    The passcode email.

    Plain HTML rather than Laravel's markdown mail components: those pull a
    published stylesheet and a theme this application has never published, and
    the one thing this message must do is render the digits legibly in every
    client. `dir` and `text-align` come from the recipient's language
    (`languages.direction`), so an Arabic reader gets a right-to-left message
    rather than a left-to-right one with Arabic text in it.

    The code is presented as one string with generous letter spacing and no
    grouping. Grouping ("123 456") reads well and is copied badly — a person
    pasting it back includes the space, and the field rejects it.
--}}
<!DOCTYPE html>
<html lang="{{ $locale }}" dir="{{ $direction }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ __('verification.otp.subject', ['app' => config('app.name')], $locale) }}</title>
</head>
<body style="margin:0;padding:24px;background:#f5f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1a1c1e;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;text-align:{{ $direction === 'rtl' ? 'right' : 'left' }};">

    <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
        @if ($name)
            {{ __('verification.otp.greeting_named', ['name' => $name], $locale) }}
        @else
            {{ __('verification.otp.greeting', [], $locale) }}
        @endif
    </p>

    <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
        {{ __('verification.otp.intro', ['app' => config('app.name')], $locale) }}
    </p>

    <p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;direction:ltr;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">
        {{ $code }}
    </p>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4a4e52;">
        {{ trans_choice('verification.otp.expiry', $minutes, ['minutes' => $minutes], $locale) }}
    </p>

    <p style="margin:0;font-size:14px;line-height:1.5;color:#4a4e52;">
        {{ __('verification.otp.unexpected', [], $locale) }}
    </p>
</div>
</body>
</html>
