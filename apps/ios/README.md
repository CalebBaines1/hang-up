# Hang Up for iPhone

A native SwiftUI app for Hang Up. Practice calls arrive the way a real call
does: the system incoming-call screen, your ringtone, full screen on the lock
screen, answer by sliding, and the normal iPhone in-call controls. It talks to
the same server as the web app (`apps/server`), so scenarios, the AI caller,
scoring and history are shared.

## What makes it feel like a real call

| Piece | What it does |
| --- | --- |
| **CallKit** (`Calls/CallManager.swift`) | Rings with the native incoming-call UI and ringtone, works on the lock screen, respects Silent and Focus, and gives the call the system's mute and end buttons, Bluetooth and car audio. |
| **PushKit VoIP push** (`Calls/CallManager.swift`, `apps/server/src/apns.ts`) | The server pushes scheduled and family calls straight to the phone. iOS wakes the app even if it was closed, and the app reports the call to CallKit, so the phone rings at the scheduled time. |
| **Voice-processing audio** (`Calls/CallAudio.swift`) | One `AVAudioEngine` with Apple's echo canceller (the one FaceTime uses). The microphone hears you and not the caller, so you can talk over the caller and it stops, like a real person. |
| **On-device speech** (`Calls/Listener.swift`) | Apple's speech recognizer turns what you say into text on the phone, then sends text to the server. |
| **Phone-line sound** (`Calls/CallAudio.swift`, `Calls/CallerVoice.swift`) | The caller's voice is band-passed to the 300 Hz to 3.4 kHz telephone band with a little line hiss and ambience (call centre, street, office). |

Practice calls stay clearly labelled as practice: the CallKit screen says
"Hang Up" under the caller name, the in-app screen has the "THIS IS PRACTICE"
pill, the safe word ends any call, and calls are kept out of the Phone app's
Recents.

## Run it on your iPhone

You need a Mac with Xcode 16 or newer and an iPhone on iOS 17 or newer.

1. Install XcodeGen and generate the project:
   ```sh
   brew install xcodegen
   cd apps/ios
   xcodegen
   open HangUp.xcodeproj
   ```
2. In Xcode, select the **HangUp** target, open **Signing & Capabilities**,
   pick your team, and change the bundle identifier from
   `com.example.hangup` to something unique, like `com.yourname.hangup`.
3. Plug in your iPhone (or pair it over Wi-Fi), pick it as the run
   destination, and press Run. The first time, approve the developer
   certificate on the phone in **Settings > General > VPN & Device
   Management**, and turn on **Developer Mode** if iOS asks.
4. Tap **Ring me**, choose "In 10 s", lock the phone, and wait for it to ring.

A free Apple ID is enough for steps 1 to 4: practice calls ring through
CallKit as soon as you tap **Ring me**, and surprise calls ring when you open
the app. The simulator runs the app but does not ring like a phone, and has
no real microphone echo cancellation, so test calls on a device.

The app points at `https://hang-up.onrender.com` by default. Change it in the
app's Settings, or in `project.yml` (`HangUpServerURL`), to use your own
server. A free Render instance sleeps when idle, so the first request after a
while can take up to a minute.

## Surprise calls that ring when the app is closed (VoIP push)

This needs the paid Apple Developer Program ($99 a year), because free
accounts can't use push notifications.

1. In Xcode, the Push Notifications capability is already declared in
   `HangUp/Resources/HangUp.entitlements`. Keep **Background Modes > Voice
   over IP** and **Audio** on (they come from `project.yml`).
2. At [developer.apple.com > Keys](https://developer.apple.com/account/resources/authkeys/list),
   create a key with **Apple Push Notifications service (APNs)** enabled and
   download the `.p8` file. Note the Key ID and your Team ID.
3. Set these on the server (Render dashboard or `.env`):
   ```sh
   APNS_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
   APNS_KEY_ID=ABC123DEFG
   APNS_TEAM_ID=TEAM123456
   APNS_BUNDLE_ID=com.yourname.hangup   # the same bundle id as the app
   ```
4. Run the app from Xcode. It registers its VoIP token with the server
   (`POST /api/push/voip`). Debug builds use the APNs sandbox; TestFlight and
   App Store builds use production (set `aps-environment` to `production`).
5. Turn on surprise calls in the app's Settings. When the scheduler picks a
   time, the server sends a VoIP push and the phone rings.

Apple's rule for VoIP push is strict: every push must ring a call right away,
or iOS stops delivering them. The server only sends VoIP pushes for calls that
are ringing now, never for reminders or marketing.

## Shipping it

- **TestFlight** is the easiest way to put it on friends' and family's
  phones. Archive in Xcode, upload, and invite testers by email.
- **App Store review**: Apple allows CallKit for apps that provide calling.
  An app that simulates scam calls for training should explain that clearly
  in the review notes and keep the practice labels, consent screen and safe
  word. Expect questions; a short demo video for the reviewer helps.

## Layout

```
apps/ios
├── project.yml              XcodeGen spec (targets, Info.plist, background modes)
└── HangUp
    ├── App                  App entry, AppModel (state, registration, practice flow)
    ├── Calls                CallKit + PushKit, audio engine, speech in and out
    ├── Networking           REST client, WebSocket call session, Keychain
    ├── Views                SwiftUI screens
    └── Resources            Entitlements, asset catalog
```

The REST and WebSocket protocol is the one in `packages/client/src/types.ts`;
`Networking/Models.swift` mirrors the fields the app uses.
