import ContextManager from '/core/ui/context-manager/context-manager.js';

const ICON_URL = 'url("fs://game/civ-vii-chat-mod/ui/icons/civ_vii_chat_dock.png")';

function toggleCivViiChat() {
    const current = ContextManager.getCurrentTarget?.();
    if (current?.tagName === "PANEL-CIV-VII-CHAT") {
        ContextManager.pop(current);
        return;
    }
    window.CivViiChat?.markAsRead?.();
    ContextManager.push("panel-civ-vii-chat", { singleton: true, createMouseGuard: true });
}

class CivViiChatSubsystemDockDecorator {
    constructor(panel) {
        this._panel = panel;
        this._button = null;
        this._badge = null;
        this._updateBadgeBound = () => this.updateBadge();
    }

    beforeAttach() {}

    afterAttach() {
        this._button = this._panel.addButton({
            tooltip: "LOC_CIV_VII_CHAT_OPEN",
            modifierClass: "civ-vii-chat-dock",
            callback: toggleCivViiChat,
            class: "tut-civ-vii-chat",
            audio: "data-audio-press-small",
            focusedAudio: "data-audio-focus-small"
        });
        this._panel.updateButtonIcon?.(this._button, ICON_URL);
        const iconEl = this._button?.querySelector?.(".ssb__button-icon");
        if (iconEl) {
            iconEl.style.backgroundImage = ICON_URL;
            iconEl.style.backgroundSize = "72%";
            iconEl.style.backgroundPosition = "center";
            iconEl.style.backgroundRepeat = "no-repeat";
        }
        this.createBadge();
        this.attachListeners();
        this.updateBadge();
    }

    createBadge() {
        if (!this._button || this._badge) return;
        const badge = document.createElement("div");
        badge.classList.add("civ-vii-chat-dock__badge");
        badge.classList.add("civ-vii-chat--hidden");
        // Inline fallback styling in case CSS load order lags
        badge.style.position = "absolute";
        badge.style.top = "0.18rem";
        badge.style.right = "0.18rem";
        badge.style.width = "0.72rem";
        badge.style.height = "0.72rem";
        badge.style.borderRadius = "50%";
        badge.style.backgroundColor = "#38bdf8";
        badge.style.border = "0.11rem solid #080d14";
        badge.style.pointerEvents = "none";
        badge.style.display = "none";
        badge.style.zIndex = "10";
        this._button.appendChild(badge);
        this._badge = badge;
    }

    updateBadge() {
        if (!this._badge) return;
        const hasUnread = !!window.CivViiChat?.hasUnread?.();
        if (hasUnread) {
            this._badge.classList.remove("civ-vii-chat--hidden");
            this._badge.style.display = "block";
        } else {
            this._badge.classList.add("civ-vii-chat--hidden");
            this._badge.style.display = "none";
        }
    }

    attachListeners() {
        window.addEventListener("civ-vii-chat-unread-changed", this._updateBadgeBound);
        window.addEventListener("civ-vii-chat-message", this._updateBadgeBound);
        try {
            engine?.on?.("LocalPlayerChanged", this._updateBadgeBound, this);
            engine?.on?.("TurnBegin", this._updateBadgeBound, this);
        } catch (_e) { /* engine event fallback */ }
    }

    detachListeners() {
        window.removeEventListener("civ-vii-chat-unread-changed", this._updateBadgeBound);
        window.removeEventListener("civ-vii-chat-message", this._updateBadgeBound);
        try {
            engine?.off?.("LocalPlayerChanged", this._updateBadgeBound, this);
            engine?.off?.("TurnBegin", this._updateBadgeBound, this);
        } catch (_e) { /* engine event fallback */ }
    }

    beforeDetach() {
        this.detachListeners();
        if (this._badge?.parentNode) {
            this._badge.parentNode.removeChild(this._badge);
        }
        this._badge = null;
    }

    afterDetach() {}
}

try {
    Controls.loadStyle?.("fs://game/civ-vii-chat-mod/ui/civ-vii-chat-panel.css");
} catch (_e) { /* inline icon fallback in afterAttach handles it */ }
Controls.decorate("panel-sub-system-dock", (panel) => new CivViiChatSubsystemDockDecorator(panel));
