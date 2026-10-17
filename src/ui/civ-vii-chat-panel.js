import Panel from '/core/ui/panel-support.js';
import { InputEngineEventName } from '/core/ui/input/input-support.js';
import { MustGetElement } from '/core/ui/utilities/utilities-dom.js';
import { FocusManager } from '/core/ui-next/services/focus-manager.js';
import NavTray from '/core/ui/navigation-tray/model-navigation-tray.js';

const HIDDEN = "civ-vii-chat--hidden";

function chat() {
    return window.CivViiChat;
}

class CivViiChatPanel extends Panel {
    constructor() {
        super(...arguments);
        this.engineInputListener = this.onEngineInput.bind(this);
        this.closeListener = () => this.close();
        this.sendListener = this.onSend.bind(this);
        this.keyListener = this.onKeyDown.bind(this);
        this.inputListener = this.onInputChanged.bind(this);
        this.focusInputListener = () => this.focusInput();
        this.suggestions = [];
        this.suggestIndex = 0;
        this.unsubscribe = null;
        this.renderedViewer = null;
    }

    onInitialize() {
        this.log = MustGetElement(".civ-vii-chat__messages", this.Root);
        this.empty = MustGetElement(".civ-vii-chat__empty", this.Root);
        this.roster = MustGetElement(".civ-vii-chat__roster", this.Root);
        this.input = MustGetElement(".civ-vii-chat__input", this.Root);
        this.sendButton = MustGetElement(".civ-vii-chat__send", this.Root);
        this.suggestBox = MustGetElement(".civ-vii-chat__suggest", this.Root);
        this.targetHint = MustGetElement(".civ-vii-chat__target", this.Root);
        this.input.setAttribute("placeholder", Locale.compose("LOC_CIV_VII_CHAT_PLACEHOLDER"));
        this.sendButton.setAttribute("data-tooltip-content", Locale.compose("LOC_CIV_VII_CHAT_SEND"));
        this.Root.setAttribute("tabindex", "-1");
    }

    onAttach() {
        super.onAttach();
        this.renderListener = this.render.bind(this);
        this.Root.addEventListener(InputEngineEventName, this.engineInputListener);
        MustGetElement("fxs-close-button", this.Root).addEventListener("action-activate", this.closeListener);
        this.sendButton.addEventListener("click", this.sendListener);
        this.sendButton.addEventListener("action-activate", this.sendListener);
        this.input.addEventListener("keydown", this.keyListener);
        this.input.addEventListener("input", this.inputListener);
        this.log.addEventListener("click", this.focusInputListener);
        try {
            engine?.on?.("LocalPlayerChanged", this.renderListener, this);
            engine?.on?.("TurnBegin", this.renderListener, this);
        } catch (_e) { /* optional */ }
        this.unsubscribe = chat()?.subscribe(() => this.render());
        chat()?.setPanelOpen?.(true);
        this.render();
        try {
            FocusManager.get().setFocus(this.Root);
        } catch (_e) { /* fall through */ }
        this.focusInput();
    }

    onDetach() {
        chat()?.setPanelOpen?.(false);
        this.unsubscribe?.();
        this.unsubscribe = null;
        try {
            engine?.off?.("LocalPlayerChanged", this.renderListener, this);
            engine?.off?.("TurnBegin", this.renderListener, this);
        } catch (_e) { /* optional */ }
        this.Root.removeEventListener(InputEngineEventName, this.engineInputListener);
        this.sendButton.removeEventListener("click", this.sendListener);
        this.sendButton.removeEventListener("action-activate", this.sendListener);
        this.input.removeEventListener("keydown", this.keyListener);
        this.input.removeEventListener("input", this.inputListener);
        this.log.removeEventListener("click", this.focusInputListener);
        super.onDetach();
    }

    onReceiveFocus() {
        super.onReceiveFocus();
        NavTray.clear();
        NavTray.addOrUpdateGenericBack();
        this.focusInput();
    }

    focusInput() {
        this.input?.focus?.();
    }

    onEngineInput(inputEvent) {
        if (inputEvent.detail.status != InputActionStatuses.FINISH) {
            return;
        }
        if (inputEvent.isCancelInput() || inputEvent.detail.name == "sys-menu") {
            if (!this.suggestBox.classList.contains(HIDDEN)) {
                this.hideSuggestions();
            } else {
                this.close();
            }
            inputEvent.stopPropagation();
            inputEvent.preventDefault();
            return;
        }
        // While typing, keep keystrokes from triggering game hotkeys.
        if (document.activeElement === this.input) {
            inputEvent.stopPropagation();
            inputEvent.preventDefault();
        }
    }

    // ------------------------------------------------------------ composing
    insertNewlineAtCursor() {
        const val = this.input.value || "";
        const start = typeof this.input.selectionStart === "number" ? this.input.selectionStart : val.length;
        const end = typeof this.input.selectionEnd === "number" ? this.input.selectionEnd : val.length;
        this.input.value = val.slice(0, start) + "\n" + val.slice(end);
        try {
            this.input.selectionStart = this.input.selectionEnd = start + 1;
        } catch (_e) { /* ignore if unsupported */ }
        this.onInputChanged();
    }

    onKeyDown(e) {
        const suggesting = !this.suggestBox.classList.contains(HIDDEN) && this.suggestions.length > 0;
        const key = e.key || "";
        const code = e.keyCode;
        const isEnter = key === "Enter" || code === 13;

        if (suggesting && (key === "ArrowDown" || code === 40)) {
            this.suggestIndex = (this.suggestIndex + 1) % this.suggestions.length;
            this.renderSuggestions();
            e.preventDefault();
        } else if (suggesting && (key === "ArrowUp" || code === 38)) {
            this.suggestIndex = (this.suggestIndex - 1 + this.suggestions.length) % this.suggestions.length;
            this.renderSuggestions();
            e.preventDefault();
        } else if (suggesting && (key === "Tab" || code === 9 || (isEnter && !e.shiftKey))) {
            this.applySuggestion(this.suggestions[this.suggestIndex]);
            e.preventDefault();
        } else if (isEnter && e.shiftKey) {
            // Shift+Enter inserts a carriage return
            this.insertNewlineAtCursor();
            e.preventDefault();
        } else if (isEnter) {
            // Enter (without Shift) sends the message
            this.onSend();
            e.preventDefault();
        } else if (key === "Escape" || code === 27) {
            if (suggesting) this.hideSuggestions();
            else this.close();
            e.preventDefault();
        }
        e.stopPropagation();
    }

    onInputChanged() {
        const value = this.input.value || "";
        this.sendButton.classList.toggle("civ-vii-chat__send--ready", value.trim().length > 0);
        const m = /^@(\S*)$/.exec(value);
        if (m) {
            const q = m[1].toLowerCase();
            this.suggestions = chat().teammates().filter((t) =>
                !q || t.token.toLowerCase().startsWith(q) || `p${t.id + 1}`.startsWith(q) || t.label.toLowerCase().includes(q));
            this.suggestIndex = 0;
            this.renderSuggestions();
        } else {
            this.hideSuggestions();
        }
        this.updateTargetHint();
    }

    renderSuggestions() {
        this.suggestBox.innerHTML = "";
        if (!this.suggestions.length) {
            this.hideSuggestions();
            return;
        }
        this.suggestions.forEach((t, i) => {
            const item = document.createElement("div");
            item.classList.add("civ-vii-chat__suggest-item");
            if (i === this.suggestIndex) item.classList.add("civ-vii-chat__suggest-item--active");
            item.textContent = `@${t.token}  —  ${t.label}${t.isBot ? "  (bot)" : ""}`;
            item.style.borderLeft = `0.2rem solid ${t.color}`;
            item.addEventListener("click", () => this.applySuggestion(t));
            this.suggestBox.appendChild(item);
        });
        this.suggestBox.classList.remove(HIDDEN);
    }

    hideSuggestions() {
        this.suggestBox.classList.add(HIDDEN);
        this.suggestions = [];
    }

    applySuggestion(t) {
        if (!t) return;
        this.input.value = `@${t.token} `;
        this.hideSuggestions();
        this.onInputChanged();
        this.focusInput();
    }

    updateTargetHint() {
        const parsed = chat().parse(this.input.value || "", chat().localPlayerId);
        if (parsed.to >= 0) {
            this.targetHint.textContent = `To ${chat().playerLabel(parsed.to)} (visible to your team)`;
            this.targetHint.classList.remove(HIDDEN);
        } else {
            this.targetHint.classList.add(HIDDEN);
        }
    }

    onSend() {
        const value = this.input.value || "";
        if (!value.trim()) return;
        this.input.value = "";
        this.onInputChanged();
        chat().send(value);
        this.focusInput();
    }

    // ------------------------------------------------------------- rendering
    render() {
        const store = chat();
        if (!store) return;
        const viewer = store.localPlayerId;
        store.markAsRead?.(viewer);
        this.renderRoster(viewer);
        const msgs = store.visibleMessages(viewer);
        this.log.innerHTML = "";
        this.empty.classList.toggle(HIDDEN, msgs.length > 0);
        for (const m of msgs) {
            this.log.appendChild(this.renderMessage(m, viewer));
        }
        this.scrollToBottom();
    }

    renderRoster(viewer) {
        const store = chat();
        this.roster.innerHTML = "";
        for (const t of store.teammates(viewer, true)) {
            const chip = document.createElement("div");
            chip.classList.add("civ-vii-chat__chip");
            chip.style.borderLeft = `0.2rem solid ${t.color}`;
            chip.textContent = `${t.label}${t.id === viewer ? " (you)" : ""}${t.isBot ? " · bot" : ""}`;
            if (t.id !== viewer) {
                chip.addEventListener("click", () => {
                    this.input.value = `@${t.token} `;
                    this.onInputChanged();
                    this.focusInput();
                });
            }
            this.roster.appendChild(chip);
        }
    }

    renderMessage(m, viewer) {
        const store = chat();
        const el = document.createElement("div");
        el.classList.add("civ-vii-chat__msg");
        if (m.from === viewer) el.classList.add("civ-vii-chat__msg--self");
        if (m.to === viewer) el.classList.add("civ-vii-chat__msg--direct");
        const color = store.playerColor(m.from);
        el.style.borderLeftColor = color;

        const meta = document.createElement("div");
        meta.classList.add("civ-vii-chat__meta");
        const author = document.createElement("div");
        author.classList.add("civ-vii-chat__author");
        author.style.color = color;
        author.textContent = store.playerLabel(m.from) + (m.from === viewer ? " (you)" : "");
        meta.appendChild(author);
        if (m.bot) {
            const badge = document.createElement("div");
            badge.classList.add("civ-vii-chat__badge");
            badge.textContent = "BOT";
            meta.appendChild(badge);
        }
        const turn = document.createElement("div");
        turn.classList.add("civ-vii-chat__turn");
        turn.textContent = `Turn ${m.turn}`;
        meta.appendChild(turn);
        el.appendChild(meta);

        const body = document.createElement("div");
        body.classList.add("civ-vii-chat__body");
        if (m.to >= 0) {
            const mention = document.createElement("span");
            mention.classList.add("civ-vii-chat__mention");
            mention.textContent = `@${store.mentionToken(m.to)}`;
            body.appendChild(mention);
        }
        const text = document.createElement("span");
        text.textContent = m.text;
        body.appendChild(text);
        el.appendChild(body);
        return el;
    }

    scrollToBottom() {
        const doScroll = () => { this.log.scrollTop = this.log.scrollHeight; };
        doScroll();
        requestAnimationFrame?.(() => requestAnimationFrame(doScroll));
    }
}

Controls.define("panel-civ-vii-chat", {
    createInstance: CivViiChatPanel,
    description: "Civ VII Chat Mod - team chat panel",
    styles: ["fs://game/civ-vii-chat-mod/ui/civ-vii-chat-panel.css"],
    content: ["fs://game/civ-vii-chat-mod/ui/civ-vii-chat-panel.html"],
    attributes: [],
    classNames: ["panel-civ-vii-chat", "absolute", "inset-0"]
});
