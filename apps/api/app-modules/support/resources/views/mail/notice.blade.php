{{--
    A short operational notice (App\Mail\NoticeMessage).

    Plain HTML for the reason the invitation and passcode messages give: the
    markdown mail components need a stylesheet this application never
    published. The link is shown as a button and as text, for mail clients
    that strip anchors.
--}}
<!DOCTYPE html>
<html lang="{{ $locale }}" dir="{{ $direction }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $heading }}</title>
</head>
<body style="margin:0;padding:24px;background:#f5f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1a1c1e;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;text-align:{{ $direction === 'rtl' ? 'right' : 'left' }};">

    <p style="margin:0 0 20px;font-size:18px;line-height:1.4;font-weight:600;">{{ $heading }}</p>

    @foreach ($lines as $line)
        <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">{{ $line }}</p>
    @endforeach

    @if ($actionUrl !== null && $actionLabel !== null)
        <p style="margin:24px 0;">
            <a href="{{ $actionUrl }}" style="display:inline-block;padding:12px 24px;background:#1a7f4f;color:#ffffff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;">{{ $actionLabel }}</a>
        </p>
        <p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5b6166;word-break:break-all;">{{ $actionUrl }}</p>
    @endif

    <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#5b6166;">{{ config('app.name') }}</p>
</div>
</body>
</html>
