# Recall — Flashcards

A responsive, browser-based flashcard study app built with plain HTML, CSS, and JavaScript. No build tools or dependencies are required.

## Run the app

Open `index.html` in a modern browser. Decks and cards are saved in that browser's LocalStorage and stay on the device. Use **Export** to download a JSON backup or **Import** to add decks from a Recall JSON export.

## Features

- Create, rename, and delete decks; create, edit, and delete cards.
- Study with flip, previous/next, and shuffled card order.
- Search both the front and back of cards in the active deck.
- Persist decks, cards, and the active deck between visits.
- Import and export deck data as JSON.
- Responsive layout, light/dark color-scheme support, reduced-motion support, keyboard shortcuts, and accessible modal and live-status feedback.

## Reflection

- **Where AI saved time:** AI helped scaffold the app's markup, responsive styling, and the connected CRUD, study, persistence, and import/export flows, leaving more time to review behavior rather than start each feature from scratch.
- **An AI bug I identified and fixed:** The initial modal only trapped Tab when focus was exactly on its first or last control. If focus had moved outside the dialog, it could stay outside. The updated handler detects focus outside the dialog and moves it back in; Escape closes the dialog and focus returns to its opener. This reinforced that generated code needs behavior-level keyboard testing, not just a quick visual check.
- **Code refactored for clarity:** The original single, compressed `renderCards()` mixed study-card markup, card-list markup, and counts. It is now split into `renderStudyCard(cards)` and `renderCardList(cards)`, called by this smaller coordinator:
  ```js
  function renderCards() {
    const cards = visibleCards();
    if (activeIndex >= cards.length) activeIndex = Math.max(0, cards.length - 1);
    renderStudyCard(cards);
    renderCardList(cards);

    const total = allCards().length;
    elements.resultCount.textContent =
      `${cards.length} of ${total} ${total === 1 ? 'card' : 'cards'}`;
  }
  ```
- **Accessibility improvement:** Modal fields have explicit labels, focus is placed in the dialog and managed with a keyboard trap, focus returns to the invoking control, and dynamic updates use an `aria-live` status region. Visible focus indicators and reduced-motion styling are also included.
- **Prompt changes that improved output:** Specific constraints—plain JavaScript with no build tools, separate `index.html`/`styles.css`/`app.js`, defined CRUD and persistence behaviors, keyboard handling, and explicit modal focus management—produced a more reviewable result than asking for a flashcard app in one broad prompt.
