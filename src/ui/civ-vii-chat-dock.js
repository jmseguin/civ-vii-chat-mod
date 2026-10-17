import ContextManager from '/core/ui/context-manager/context-manager.js';

const ICON_URL = 'url("fs://game/civ-vii-chat-mod/ui/icons/civ_vii_chat_dock.png")';

function toggleCivViiChat() {
    const current = ContextManager.getCurrentTarget?.();
    if (current?.tagName === "PANEL-CIV-VII-CHAT") {
        ContextManager.pop(current);
        return;
    }
    ContextManager.push("panel-civ-vii-chat", { singleton: true, createMouseGuard: true });
}

class CivViiChatSubsystemDockDecorator {
    constructor(panel) {
        this._panel = panel;
        this._button = null;
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
    }

    beforeDetach() {}

    afterDetach() {}
}

try {
    Controls.loadStyle?.("fs://game/civ-vii-chat-mod/ui/civ-vii-chat-panel.css");
} catch (_e) { /* inline icon fallback in afterAttach handles it */ }
Controls.decorate("panel-sub-system-dock", (panel) => new CivViiChatSubsystemDockDecorator(panel));
