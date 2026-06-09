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
- Generates custom skins through a local sprite-plan proxy with a local fallback.

## Load Locally in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/Users/benjamin/Documents/PROJECTS/HTML friend`.
5. Visit a normal website. Chrome internal pages and locked-down extension pages cannot run content scripts.

## Load Locally in Safari

Safari Web Extensions must be wrapped in an Xcode app before Safari can enable them.

```sh
xcrun safari-web-extension-converter "/Users/benjamin/Documents/PROJECTS/HTML friend"
```

Open the generated Xcode project, run the macOS app target, then enable the extension in **Safari > Settings > Extensions**. Safari browser pages, App Store pages, and other locked-down documents still cannot run content scripts.

## Test

```sh
npm test
```

## AI Features and API Keys

Codey uses a bring-your-own-key flow for AI features. Open the companion **About** tab, paste an API key, and click **Save key**. The key is saved in extension-local storage on this device until the user clears it, resets extension storage, or uninstalls the extension. It is used for AI page chat and custom character generation, and is not stored in preferences or custom skins.

For local development, the character generation endpoint can also be tested independently with the local proxy. The server reads `AI_API_KEY` from the process environment or local `.env`; provider-specific legacy environment names are still accepted as fallbacks. This is a development helper, not the production extension path.

```sh
AI_API_KEY=your_key npm run character:server
```

AI page chat requires a saved API key and returns AI output. If no API key is saved, the chat panel will ask for one instead of using the local page-text summarizer. For custom characters, if no API key is saved or the image generation service returns an invalid plan, the extension uses the local fallback generator.

## Contributing

Contributions are welcome. If you would like to help improve Codey, please open a pull request with bug fixes, design improvements, documentation updates, tests, or new companion behaviors.

Good contributions should keep the project goals in mind: playful, focused, accessible, privacy-conscious, and suitable for a broad audience. For larger changes, opening an issue or draft pull request first can make it easier to discuss the direction before implementation.

## Roadmap Ideas

- Improve the companion's study and focus behaviors.
- Add more site-aware reactions.
- Expand character customization.
- Refine the AI chat experience for younger and general audiences.
- Improve cross-browser polish for Chrome and Safari.
- Explore multi-tab movement and richer portal transitions.
