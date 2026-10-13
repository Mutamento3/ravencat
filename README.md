# RavenCat

**English** | [简体中文](README.zh-CN.md)

**A home for your favorite AIs.**

RavenCat is an open-source Android app where you can give each AI its own name, persona, and model. Talk to them individually or bring several AIs into a group conversation, all in one app.

The project grew out of the maintainer's personal creative setting, “AI-Home,” which imagines different LLMs as distinct characters living together. RavenCat brings that idea into a personal AI home: connect the models you enjoy and spend time with them over ongoing conversations. Everyday chats, character writing, friendship, or romantic interactions are all up to you. This personal project is driven primarily by the maintainer's enjoyment of using it and creating with it.

Beyond chat, the project explores ways for AI to take part in everyday life: voice or video calls, listening to music together, a quick conversation through a floating bubble while you use another app, or reaching out at a scheduled time.

RavenCat is maintained by one person and is still in active development. Some background behavior and cross-device restoration need more testing on real devices; reliability across all phones has not been established.

Public APKs are released as **Preview / Pre-release** builds. Download them from [GitHub Releases](https://github.com/skylucky163/ravencat/releases). **Pinning a message as the context starting point is experimental**: all original message text from the pinned message through the latest message is included in the context, and automatic summary generation pauses. As the conversation grows, this can increase token usage and exceed the model's context limit. After unpinning, automatic summary generation must be re-enabled manually. See the current preview notes for [v2.1.0-preview.1](docs/releases/v2.1.0-preview.1.md).

## What you can do

- **Individual and group chats**: manage multiple AIs, send text, images, files, and voice messages, and use quoted replies, stickers, and message translation.
- **Personas and memory**: customize your profile and AI personas, and manage conversation memories and prompts to suit your preferences.
- **Voice and video calls**: call your AIs with configurable speech recognition, speech synthesis, and camera input.
- **Floating interaction**: open a floating bubble over other apps for quick chats, text extraction, and screenshots.
- **Proactive interaction and schedules**: allow AIs to perform scheduled tasks and send proactive messages in the background. This does not require the floating bubble to be enabled.
- **Everyday features**: Moments, expense tracking, listening to music together, and phone tools and external MCP tools with permissions you choose to grant.
- **Local backups**: export and restore chats, media, and settings.

See the [documentation index](docs/README.md) for usage, development, and current architecture references. Detailed technical documents are currently mostly in Chinese. The relevant documents describe the verification boundaries for Android background behavior, cross-device restoration, and real external services.

## Before you start

RavenCat currently supports **Android 13 and later**. It includes custom native modules, so it cannot run directly in Expo Go. There is no iOS version.

RavenCat does not include free model services or API keys. Configure your own model services in the app; calls, translation, and other features also require credentials for the services they use. Service providers charge for usage.

Chats, media, and settings are stored locally on your phone. When you use models or external tools, the relevant content is sent to the services you configure. Screenshots, camera access, and phone tools also depend on the features you enable and the permissions you grant. Chinese OCR uses Google ML Kit and processes its input on the device; the SDK may send performance and usage metrics to Google. See [Google's terms and privacy information](https://developers.google.com/ml-kit/terms).

Individual chats can use summaries to condense earlier conversations, or load recent messages according to your settings when automatic summaries are off and no starting point is pinned. These context settings do not delete locally stored chat history. See [two-level conversation summaries](docs/architecture/chat-summary.md) for details.

Full local backups are **unencrypted and include service credentials**. Keep them private. When sharing logs or reporting an issue, do not include API keys, chat databases, backups, or personal screenshots.

## Build from source

Prepare Node.js 22 (`>=22.13.0 <23`), an Android development environment, and an Android 13+ phone or emulator. Install the locked dependencies:

```powershell
npm ci
```

For the first run, compile and install a development build that includes the native modules:

```powershell
$env:EAS_BUILD_PROFILE = 'development'
npx expo run:android
```

For subsequent sessions with a phone connected over USB, start the development server:

```powershell
adb reverse tcp:8081 tcp:8081
npm start
```

The default client connection uses localhost and does not require Tailscale or the maintainer's Expo account. This connection setting does not restrict which network interfaces the server listens on. See the [local development guide](docs/development.md) for LAN and Tailscale connections, development port access restrictions, and EAS cloud builds.

## Contributing

Bug reports and specific suggestions are welcome. Include your phone model, Android version, app version, steps to reproduce, and expected behavior, and remove private information from logs.

Read [AGENTS.md](AGENTS.md) before changing code. The project is organized by feature, with separate READMEs for chat, calls, memory, and other modules. Start with the [architecture guide](docs/architecture-navigation.md) to find the relevant code. Run only the checks relevant to your changes; documentation changes do not require building an APK.

## Acknowledgments and license

RavenCat is built with React Native and Expo, using Lucide icons, FlashList, Reanimated, and other third-party components. The liquid glass effect wraps [AndroidLiquidGlassView](https://github.com/QmDeve/AndroidLiquidGlassView) in a local native module. See the [third-party software notices](docs/third-party-notices.md) for the full dependency list, upstream copyright notices, and license texts.

Original project code, documentation, and images confirmed as original are licensed under the [MIT License](LICENSE), which permits use, modification, and commercial use. Retain the copyright and license notice when distributing them. A [Chinese explanation of the MIT License](docs/license-options.md) is also available. Third-party components and Expo template images follow their own licenses; see [asset sources and permissions](docs/asset-sources.md).
