# Codey

Codey is a little helper designed to help people focus, study, and have fun while using the web. The project aims to make AI tools feel more playful and approachable for younger audiences, while still being useful and appropriate for everyone.

Codey is built as a Manifest V3 Web Extension. It adds a small pixel companion to supported web pages, where it can walk, jump, react to the page, and open an AI-powered chat panel when an API key is provided.

## Project Goals

- Create a friendly, playful companion for everyday browsing.
- Support focus, study, creativity, and lightweight exploration.
- Make AI-assisted interactions feel approachable without being distracting.
- Keep privacy and user control central, especially around API keys and AI features.
- Provide a codebase that is straightforward for contributors to understand and improve.

## Current Features

- Injects an isolated Shadow DOM overlay into supported pages.
- Renders a pixel character with idle, walk, jump, fall, and land states.
- Samples page elements as collision platforms.
- Keeps the character in page-world coordinates as the user scrolls.
- Persists state through the cross-browser Web Extensions storage API.
- Opens a small AI-powered, page-aware chat panel.
- Includes analog/digital clock controls and a Pomodoro timer.
- Lets users tune movement with speed and jumpiness controls.
- Reacts to blocked or distracting sites, with user-editable blocked-site settings.
- Lets the companion hide in a little door and return from it.
- Includes built-in skin choices.
- Carries the companion between pages and tabs with portal-style transition behavior.

## Load Locally in Chrome

Clone or download this repository first, then load the repository folder as an unpacked extension.

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the folder that contains this repository's `manifest.json`.
5. Visit a normal website. Chrome internal pages and locked-down extension pages cannot run content scripts.

## Load Locally in Safari

Safari Web Extensions must be wrapped in an Xcode app before Safari can enable them.

```sh
xcrun safari-web-extension-converter "$PWD"
```

Run that command from the repository folder. Open the generated Xcode project, run the macOS app target, then enable the extension in **Safari > Settings > Extensions**. Safari browser pages, App Store pages, and other locked-down documents still cannot run content scripts.

## Test

```sh
npm test
```

## AI Features and API Keys

Codey uses a bring-your-own-key flow for AI features. Open the companion **About** tab, paste an API key, and click **Save key**. The key is saved in extension-local storage on this device until the user clears it, resets extension storage, or uninstalls the extension. It is used for AI page chat and is not stored in preferences.

Normal extension use does not require running a local server. The About tab key is enough for AI chat.

The `npm run character:server` command is only an optional developer helper for testing the old local character-generation endpoint directly. It is not needed by users who load the extension and save an API key in the companion About tab.

AI page chat requires a saved API key and returns AI output. If no API key is saved, the chat panel asks the user to add one in About.

## Contributing

Contributions are welcome. If you would like to help improve Codey, please open a pull request with bug fixes, design improvements, documentation updates, tests, or new companion behaviors.

Good contributions should keep the project goals in mind: playful, focused, accessible, privacy-conscious, and suitable for a broad audience. For larger changes, opening an issue or draft pull request first can make it easier to discuss the direction before implementation.

## Roadmap Ideas

- Add more site-aware reactions.
- Make the companion more collaborative.
- Add custom characters.
- Refine the AI chat experience for younger and general audiences.
- Add manual movement controls.
- Explore multi-tab movement and richer portal transitions.
