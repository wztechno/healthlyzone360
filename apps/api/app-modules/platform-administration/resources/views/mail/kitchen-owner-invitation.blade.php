{{--
    The kitchen owner invitation.

    Plain HTML for the reason the passcode and closure messages give: Laravel's
    markdown mail components pull a published stylesheet this application has
    never published. `dir` and `text-align` come from the kitchen's own default
    language, because the recipient has no account yet to hold a preference.

    The link is the only credential in the message and it is deliberately shown
    as a button *and* as text: mail clients that strip anchors are common enough
    in corporate estates that a button-only mail is an invitation nobody can
    accept.
--}}
<!DOCTYPE html>
<html lang="{{ $locale }}" dir="{{ $direction }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ __('invitation.owner.subject', ['kitchen' => $kitchen], $locale) }}</title>
</head>
<body style="margin:0;padding:24px;background:#f5f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1a1c1e;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;text-align:{{ $direction === 'rtl' ? 'right' : 'left' }};">

    <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
        @if ($name !== null)
            {{ __('invitation.owner.greeting_named', ['name' => $name], $locale) }}
        @else
            {{ __('invitation.owner.greeting', [], $locale) }}
        @endif
    </p>

    <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
        {{ __('invitation.owner.intro', ['kitchen' => $kitchen, 'app' => config('app.name')], $locale) }}
    </p>

    @if ($note !== null)
        <p style="margin:0 0 24px;padding:16px;background:#f5f6f7;border-radius:8px;font-size:15px;line-height:1.5;font-style:italic;">
            {{ $note }}
        </p>
    @endif

    <p style="margin:0 0 24px;">
        <a href="{{ $acceptUrl }}" style="display:inline-block;padding:12px 24px;background:#1a7f4f;color:#ffffff;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600;">
            {{ __('invitation.owner.action', [], $locale) }}
        </a>
    </p>

    <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#5b6166;word-break:break-all;">
        {{ __('invitation.owner.fallback', [], $locale) }}<br>
        {{ $acceptUrl }}
    </p>

    <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#5b6166;">
        {{ __('invitation.owner.expiry', [], $locale) }}
    </p>

    <p style="margin:0;font-size:14px;line-height:1.5;color:#5b6166;">
        {{ __('invitation.owner.signoff', [], $locale) }}
    </p>

</div>
</body>
</html>
