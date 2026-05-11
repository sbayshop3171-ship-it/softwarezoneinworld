# Android WebView FCM Integration

This repository now provides backend + web support for broadcast notifications:
- `POST /api/device/register`
- `POST /api/admin/notifications/send`
- `GET /api/admin/notifications`
- `GET /api/notifications/latest`
- `window.showNativePushBanner(payload)` on web layer

Use the following steps in your Android WebView app source code.

## 1) Add Firebase setup

1. Put `google-services.json` inside `app/`.
2. Add Firebase plugins/dependencies in Gradle.
3. Initialize Firebase in `Application` or `MainActivity`.

## 2) Ask notification permission (Android 13+)

Request runtime permission: `android.permission.POST_NOTIFICATIONS`.

## 3) Create notification channel

Create channel id: `broadcast_general`.

## 4) Register FCM token to backend

In `FirebaseMessagingService.onNewToken(token)` call:

```kotlin
POST /api/device/register
{
  "device_id": "<stable-device-id>",
  "platform": "android",
  "fcm_token": "<token>",
  "app_version": "<versionName>",
  "user_id": "<optional-user-id>"
}
```

## 5) Handle incoming push

In `FirebaseMessagingService.onMessageReceived(message)`:
- If app is background/killed: show system notification.
- If app is foreground: call WebView JS:

```kotlin
webView.evaluateJavascript(
  "window.showNativePushBanner(${jsonPayload});",
  null
)
```

Payload shape:

```json
{
  "title": "Notification title",
  "message": "Notification message",
  "image_url": "https://...",
  "click_url": "https://... অথবা /relative-path",
  "sent_at": "2026-02-11T12:00:00.000Z"
}
```

## 6) Tap action behavior

When user taps system notification:
- Open app activity with `click_url` extra.
- Load `click_url` inside WebView.

## 7) Security notes

- Only allow your own domain in WebView.
- Validate URL before loading.
- Keep `device_id` stable across app restarts.
