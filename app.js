(() => {
	'use strict';

	const STORAGE_KEY = 'recall-flashcards-v1';
	const $ = (selector, parent = document) => parent.querySelector(selector);
	const uid = () => window.crypto?.randomUUID?.()
		|| `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	const emptyState = () => ({ decks: [], cardsByDeckId: {}, activeDeckId: null });

	const elements = {
		deckList: $('#deckList'),
		deckTitle: $('#deckTitle'),
		deckDescription: $('#deckDescription'),
		deckActions: $('#deckActions'),
		workspace: $('#workspace'),
		search: $('#searchInput'),
		study: $('#studyArea'),
		cardList: $('#cardList'),
		resultCount: $('#resultCount'),
		modalRoot: $('#modalRoot'),
		announcement: $('#announcement'),
		importFile: $('#importFile')
	};

	function normalizeState(raw) {
		if (!raw || !Array.isArray(raw.decks)) return emptyState();

		const decks = raw.decks
			.filter(deck => deck && typeof deck.id === 'string' && typeof deck.name === 'string')
			.map(deck => ({
				id: deck.id,
				name: deck.name.trim().slice(0, 80),
				createdAt: Number(deck.createdAt) || Date.now()
			}))
			.filter(deck => deck.name);
		const validDeckIds = new Set(decks.map(deck => deck.id));
		const cardsByDeckId = {};

		for (const deck of decks) {
			const cards = Array.isArray(raw.cardsByDeckId?.[deck.id])
				? raw.cardsByDeckId[deck.id]
				: [];
			cardsByDeckId[deck.id] = cards
				.filter(card => card && typeof card.id === 'string')
				.map(card => ({
					id: card.id,
					front: typeof card.front === 'string' ? card.front.trim().slice(0, 2000) : '',
					back: typeof card.back === 'string' ? card.back.trim().slice(0, 2000) : '',
					updatedAt: Number(card.updatedAt) || Date.now()
				}))
				.filter(card => card.front && card.back);
		}

		return {
			decks,
			cardsByDeckId,
			activeDeckId: validDeckIds.has(raw.activeDeckId)
				? raw.activeDeckId
				: decks[0]?.id || null
		};
	}

	function loadState() {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			return stored ? normalizeState(JSON.parse(stored)) : emptyState();
		} catch (error) {
			console.error('Could not load saved flashcards.', error);
			return emptyState();
		}
	}

	let state = loadState();
	let activeIndex = 0;
	let isFlipped = false;
	let searchQuery = '';
	let shuffledCardIds = null;
	let modalOpener = null;
	let previousBodyOverflow = '';

	function announce(message) {
		elements.announcement.textContent = '';
		window.setTimeout(() => {
			elements.announcement.textContent = message;
		}, 20);
	}

	function saveState() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch (error) {
			console.error('Could not save flashcards to local storage.', error);
			announce('Unable to save. Local storage may be unavailable or full.');
		}
	}

	function escapeHtml(value) {
		return String(value).replace(/[&<>"']/g, character => ({
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#39;'
		})[character]);
	}

	function activeDeck() {
		return state.decks.find(deck => deck.id === state.activeDeckId) || null;
	}

	function allCards() {
		return state.activeDeckId
			? state.cardsByDeckId[state.activeDeckId] || []
			: [];
	}

	function visibleCards() {
		const query = searchQuery.toLocaleLowerCase();
		const filtered = allCards().filter(card => (
			!query || `${card.front} ${card.back}`.toLocaleLowerCase().includes(query)
		));

		if (!shuffledCardIds) return filtered;
		const cardsById = new Map(filtered.map(card => [card.id, card]));
		return shuffledCardIds.map(id => cardsById.get(id)).filter(Boolean);
	}

	function setActiveDeck(deckId) {
		state.activeDeckId = deckId;
		activeIndex = 0;
		isFlipped = false;
		searchQuery = '';
		shuffledCardIds = null;
		elements.search.value = '';
		saveState();
		render();
	}

	function render() {
		const deck = activeDeck();
		elements.deckList.innerHTML = state.decks.length
			? state.decks.map(item => `
				<li class="deck-item">
					<button class="deck-select" type="button" data-deck="${escapeHtml(item.id)}"
						aria-current="${item.id === state.activeDeckId}">
						<span class="deck-name">${escapeHtml(item.name)}</span>
						<span class="deck-count">${(state.cardsByDeckId[item.id] || []).length}</span>
					</button>
				</li>
			`).join('')
			: '<li class="sidebar-empty">No decks yet. Create one to begin.</li>';

		elements.deckTitle.textContent = deck?.name || 'Your flashcards';
		const cardCount = deck ? (state.cardsByDeckId[deck.id] || []).length : 0;
		elements.deckDescription.textContent = deck
			? `${cardCount} ${cardCount === 1 ? 'card' : 'cards'} · Study at your own pace.`
			: 'Choose a deck or create one to get started.';
		elements.deckActions.hidden = !deck;
		elements.workspace.hidden = !deck;

		if (deck) renderCards();
	}

	function renderStudyCard(cards) {
		const card = cards[activeIndex];
		if (!card) {
			elements.study.innerHTML = `
				<div class="empty-state">
					<strong>${searchQuery ? 'No cards match your search' : 'Ready to make your first card?'}</strong>
					${searchQuery
						? 'Try another keyword or clear the search.'
						: `Add a front and back, then start studying.
							<br><button class="btn btn-primary empty-create-card" type="button">＋ Create a card</button>`}
				</div>`;
			return;
		}

		elements.study.innerHTML = `
			<div class="study-area">
				<button class="study-card${isFlipped ? ' is-flipped' : ''}" id="studyCard"
					type="button" aria-label="Flashcard ${activeIndex + 1} of ${cards.length}. Activate to flip.">
					<span class="card-inner">
						<span class="card-face front" aria-hidden="${isFlipped}">
							<span class="face-label">Front</span>
							<span class="card-text">${escapeHtml(card.front)}</span>
							<span class="flip-hint">Tap or press Space to reveal answer</span>
						</span>
						<span class="card-face back" aria-hidden="${!isFlipped}">
							<span class="face-label">Back</span>
							<span class="card-text">${escapeHtml(card.back)}</span>
							<span class="flip-hint">Tap or press Space to see question</span>
						</span>
					</span>
				</button>
				<div class="study-controls" aria-label="Flashcard controls">
					<button class="btn" type="button" data-action="previous" aria-label="Previous card"
						${cards.length < 2 ? 'disabled' : ''}>← Previous</button>
					<span class="progress" aria-live="polite">${activeIndex + 1} / ${cards.length}</span>
					<button class="btn" type="button" data-action="flip">${isFlipped ? 'Show front' : 'Flip card'}</button>
					<button class="btn" type="button" data-action="next" aria-label="Next card"
						${cards.length < 2 ? 'disabled' : ''}>Next →</button>
				</div>
				<p class="study-note">Use arrow keys to navigate · Space to flip</p>
			</div>`;
	}

	function renderCardList(cards) {
		elements.cardList.innerHTML = cards.length
			? cards.map(card => `
				<article class="card-row">
					<div class="card-row-copy">
						<strong>${escapeHtml(card.front)}</strong>
						<span>${escapeHtml(card.back)}</span>
					</div>
					<button class="icon-button" type="button" data-edit-card="${escapeHtml(card.id)}"
						aria-label="Edit card: ${escapeHtml(card.front)}" title="Edit card">✎</button>
					<button class="icon-button" type="button" data-delete-card="${escapeHtml(card.id)}"
						aria-label="Delete card: ${escapeHtml(card.front)}" title="Delete card">⌫</button>
				</article>
			`).join('')
			: `<div class="empty-state">
				<strong>${searchQuery ? 'No cards found' : 'No cards yet'}</strong>
				${searchQuery
					? 'Clear or change your search to see cards.'
					: 'Create a card to add it to your study deck.'}
			</div>`;
	}

	function renderCards() {
		const cards = visibleCards();
		if (activeIndex >= cards.length) activeIndex = Math.max(0, cards.length - 1);
		renderStudyCard(cards);
		renderCardList(cards);

		const total = allCards().length;
		elements.resultCount.textContent = `${cards.length} of ${total} ${total === 1 ? 'card' : 'cards'}`;
	}

	function closeModal() {
		elements.modalRoot.innerHTML = '';
		document.body.style.overflow = previousBodyOverflow;
		if (modalOpener?.isConnected) modalOpener.focus();
		else if (activeDeck()) $('#newCardBtn')?.focus();
		modalOpener = null;
	}

	function openModal({ title, description, fields, submitText = 'Save', onSubmit }) {
		modalOpener = document.activeElement;
		previousBodyOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		const fieldMarkup = fields.map(field => `
			<div class="field">
				<label for="${field.id}">${escapeHtml(field.label)}</label>
				${field.multiline
					? `<textarea id="${field.id}" name="${field.id}" maxlength="2000" required>${escapeHtml(field.value || '')}</textarea>`
					: `<input class="input" id="${field.id}" name="${field.id}" maxlength="80"
						value="${escapeHtml(field.value || '')}" required>`}
				${field.hint ? `<span class="field-hint">${escapeHtml(field.hint)}</span>` : ''}
			</div>
		`).join('');

		elements.modalRoot.innerHTML = `
			<div class="modal-backdrop" data-backdrop>
				<section class="modal" role="dialog" aria-modal="true"
					aria-labelledby="modalTitle" aria-describedby="modalDescription">
					<h2 id="modalTitle">${escapeHtml(title)}</h2>
					<p class="modal-description" id="modalDescription">${escapeHtml(description)}</p>
					<form id="modalForm">
						${fieldMarkup}
						<div class="modal-actions">
							<button class="btn" type="button" data-cancel>Cancel</button>
							<button class="btn btn-primary" type="submit">${escapeHtml(submitText)}</button>
						</div>
					</form>
				</section>
			</div>`;

		const form = $('#modalForm', elements.modalRoot);
		form.addEventListener('submit', event => {
			event.preventDefault();
			const values = Object.fromEntries(new FormData(form));
			const invalidField = fields.find(field => !String(values[field.id] || '').trim());
			if (invalidField) {
				const input = $(`#${invalidField.id}`, form);
				input.setCustomValidity('Please enter a value.');
				input.reportValidity();
				input.addEventListener('input', () => input.setCustomValidity(''), { once: true });
				return;
			}

			onSubmit(values);
			closeModal();
		});
		$('[data-cancel]', elements.modalRoot).addEventListener('click', closeModal);
		$('[data-backdrop]', elements.modalRoot).addEventListener('click', event => {
			if (event.target === event.currentTarget) closeModal();
		});
		$('input, textarea', elements.modalRoot)?.focus();
	}

	function openDeckModal(deck = null) {
		openModal({
			title: deck ? 'Rename deck' : 'Create a deck',
			description: deck ? 'Choose a new name for this deck.' : 'Give your new study deck a name.',
			fields: [{ id: 'deckName', label: 'Deck name', value: deck?.name || '', hint: 'Up to 80 characters' }],
			submitText: deck ? 'Save changes' : 'Create deck',
			onSubmit: values => {
				const name = values.deckName.trim();
				if (deck) {
					deck.name = name;
					announce('Deck renamed.');
				} else {
					const newDeck = { id: uid(), name, createdAt: Date.now() };
					state.decks.push(newDeck);
					state.cardsByDeckId[newDeck.id] = [];
					state.activeDeckId = newDeck.id;
					activeIndex = 0;
					searchQuery = '';
					shuffledCardIds = null;
					elements.search.value = '';
					announce('Deck created.');
				}
				saveState();
				render();
			}
		});
	}

	function openCardModal(card = null) {
		openModal({
			title: card ? 'Edit card' : 'Create a card',
			description: 'Add a question or prompt on the front and its answer on the back.',
			fields: [
				{ id: 'front', label: 'Front', value: card?.front || '', multiline: true },
				{ id: 'back', label: 'Back', value: card?.back || '', multiline: true }
			],
			submitText: card ? 'Save changes' : 'Add card',
			onSubmit: values => {
				const cards = allCards();
				if (card) {
					card.front = values.front.trim();
					card.back = values.back.trim();
					card.updatedAt = Date.now();
					announce('Card updated.');
				} else {
					cards.push({
						id: uid(),
						front: values.front.trim(),
						back: values.back.trim(),
						updatedAt: Date.now()
					});
					activeIndex = cards.length - 1;
					announce('Card added.');
				}
				isFlipped = false;
				shuffledCardIds = null;
				saveState();
				renderCards();
			}
		});
	}

	function flipCard() {
		if (!visibleCards().length) return;
		isFlipped = !isFlipped;
		renderCards();
		$('#studyCard')?.focus();
	}

	function moveCard(direction) {
		const count = visibleCards().length;
		if (count < 1) return;
		activeIndex = (activeIndex + direction + count) % count;
		isFlipped = false;
		renderCards();
	}

	function shuffleCards() {
		const cards = visibleCards();
		if (cards.length < 2) return;

		shuffledCardIds = cards.map(card => card.id);
		for (let index = shuffledCardIds.length - 1; index > 0; index -= 1) {
			const swapIndex = Math.floor(Math.random() * (index + 1));
			[shuffledCardIds[index], shuffledCardIds[swapIndex]] =
				[shuffledCardIds[swapIndex], shuffledCardIds[index]];
		}
		activeIndex = 0;
		isFlipped = false;
		renderCards();
		announce('Cards shuffled.');
	}

	function deleteDeck() {
		const deck = activeDeck();
		if (!deck || !window.confirm(`Delete “${deck.name}” and all its cards? This cannot be undone.`)) return;

		state.decks = state.decks.filter(item => item.id !== deck.id);
		delete state.cardsByDeckId[deck.id];
		state.activeDeckId = state.decks[0]?.id || null;
		activeIndex = 0;
		searchQuery = '';
		shuffledCardIds = null;
		elements.search.value = '';
		saveState();
		render();
		elements.deckList.querySelector('[data-deck]')?.focus();
		if (!activeDeck()) $('#newDeckBtn').focus();
		announce('Deck deleted.');
	}

	function deleteCard(cardId) {
		const card = allCards().find(item => item.id === cardId);
		if (!card || !window.confirm(`Delete this card “${card.front}”?`)) return;

		state.cardsByDeckId[state.activeDeckId] =
			allCards().filter(item => item.id !== card.id);
		shuffledCardIds = null;
		activeIndex = Math.min(activeIndex, Math.max(0, visibleCards().length - 1));
		isFlipped = false;
		saveState();
		renderCards();
		if (visibleCards().length) $('#studyCard')?.focus();
		else if (searchQuery) elements.search.focus();
		else $('#newCardBtn').focus();
		announce('Card deleted.');
	}

	function exportDecks() {
		const payload = {
			version: 1,
			decks: state.decks,
			cardsByDeckId: state.cardsByDeckId,
			activeDeckId: state.activeDeckId
		};
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'recall-decks.json';
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 0);
		announce('Decks exported.');
	}

	async function importDecks(file) {
		let parsed;
		try {
			parsed = JSON.parse(await file.text());
		} catch (error) {
			console.error('Could not read the selected deck file.', error);
			window.alert('Could not import this file. Choose a valid Recall deck JSON export.');
			return;
		}

		if (!parsed || !Array.isArray(parsed.decks) || parsed.decks.length === 0) {
			window.alert('This file does not contain any decks to import.');
			return;
		}

		const imported = normalizeState(parsed);
		if (!imported.decks.length) {
			window.alert('No valid decks were found in this file.');
			return;
		}

		const existingNames = new Set(state.decks.map(deck => deck.name.toLocaleLowerCase()));
		for (const deck of imported.decks) {
			const originalId = deck.id;
			let name = deck.name;
			if (existingNames.has(name.toLocaleLowerCase())) name = `${name} (imported)`;
			existingNames.add(name.toLocaleLowerCase());

			const newDeckId = uid();
			state.decks.push({ ...deck, id: newDeckId, name });
			state.cardsByDeckId[newDeckId] =
				(imported.cardsByDeckId[originalId] || []).map(card => ({ ...card, id: uid() }));
		}

		state.activeDeckId = state.decks[state.decks.length - imported.decks.length].id;
		activeIndex = 0;
		searchQuery = '';
		shuffledCardIds = null;
		elements.search.value = '';
		saveState();
		render();
		announce('Decks imported.');
	}

	$('#newDeckBtn').addEventListener('click', () => openDeckModal());
	$('#sidebarNewDeck').addEventListener('click', () => openDeckModal());
	$('#newCardBtn').addEventListener('click', () => openCardModal());
	$('#renameDeckBtn').addEventListener('click', () => {
		const deck = activeDeck();
		if (deck) openDeckModal(deck);
	});
	$('#deleteDeckBtn').addEventListener('click', deleteDeck);

	elements.deckList.addEventListener('click', event => {
		const button = event.target.closest('[data-deck]');
		if (button && button.dataset.deck !== state.activeDeckId) setActiveDeck(button.dataset.deck);
	});

	elements.study.addEventListener('click', event => {
		if (event.target.closest('#studyCard') || event.target.closest('[data-action="flip"]')) {
			flipCard();
		} else if (event.target.closest('[data-action="previous"]')) {
			moveCard(-1);
		} else if (event.target.closest('[data-action="next"]')) {
			moveCard(1);
		} else if (event.target.closest('.empty-create-card')) {
			openCardModal();
		}
	});

	elements.cardList.addEventListener('click', event => {
		const editButton = event.target.closest('[data-edit-card]');
		const deleteButton = event.target.closest('[data-delete-card]');
		if (editButton) {
			const card = allCards().find(item => item.id === editButton.dataset.editCard);
			if (card) openCardModal(card);
		} else if (deleteButton) {
			deleteCard(deleteButton.dataset.deleteCard);
		}
	});

	elements.search.addEventListener('input', () => {
		searchQuery = elements.search.value.trim();
		activeIndex = 0;
		isFlipped = false;
		shuffledCardIds = null;
		renderCards();
	});

	$('#shuffleBtn').addEventListener('click', shuffleCards);
	$('#exportBtn').addEventListener('click', exportDecks);
	$('#importBtn').addEventListener('click', () => elements.importFile.click());
	elements.importFile.addEventListener('change', async () => {
		const file = elements.importFile.files?.[0];
		if (!file) return;
		await importDecks(file);
		elements.importFile.value = '';
	});

	document.addEventListener('focusin', event => {
		const modal = $('.modal', elements.modalRoot);
		if (!modal || modal.contains(event.target)) return;
		modal.querySelector('input, textarea, button')?.focus();
	});

	document.addEventListener('keydown', event => {
		const modal = $('.modal', elements.modalRoot);
		if (modal) {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeModal();
				return;
			}
			if (event.key === 'Tab') {
				const focusable = [...modal.querySelectorAll(
					'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'
				)];
				if (!focusable.length) return;
				const first = focusable[0];
				const last = focusable[focusable.length - 1];
				if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
					event.preventDefault();
					last.focus();
				} else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
					event.preventDefault();
					first.focus();
				}
			}
			return;
		}

		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const target = event.target;
		if (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
		if (target.tagName === 'BUTTON' && target.id !== 'studyCard') return;

		if (event.code === 'Space') {
			event.preventDefault();
			flipCard();
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			moveCard(-1);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			moveCard(1);
		}
	});

	render();
})();