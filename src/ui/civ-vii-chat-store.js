/**
 * Civ VII Chat Mod - standalone team conversation store, @mention parser,
 * network relay, unread tracking, and bot teammate responder.
 *
 * Exposed as `window.CivViiChat` so the panel and dock button share a single
 * conversation instance per game.
 *
 * Fog-of-war rule: only players on the SAME TEAM as the viewing player are ever
 * listed, mentioned, or shown. Opponents are never enumerated.
 */
const LOG = "[CivViiChat]";
const MARKER = "\u200B\u2063"; // invisible prefix identifying relayed Civ VII Chat lines in network chat
const MAX_MESSAGES = 500;
const BOT_REPLY_DELAY_MS = 900;
export const CIV_VII_CHAT_EVENT = "civ-vii-chat-message";
export const CIV_VII_CHAT_UNREAD_EVENT = "civ-vii-chat-unread-changed";

const PALETTE = ["#e3c77d", "#7fb8e6", "#9ad37f", "#e69a7f", "#c79ae6", "#7fe6d3", "#e67fb4", "#d9d9d9"];

function safe(fn, fallback) {
    try {
        const v = fn();
        return v === undefined || v === null ? fallback : v;
    } catch (_e) {
        return fallback;
    }
}

function hasSaveStore() {
    return typeof GameTutorial !== "undefined" && typeof Database !== "undefined" && typeof Database.makeHash === "function";
}

function readPersistedString(key) {
    if (hasSaveStore()) {
        const val = safe(() => GameTutorial.getProperty(Database.makeHash(key)), null);
        return typeof val === "string" && val.length > 0 ? val : null;
    }
    const raw = safe(() => localStorage.getItem(key), null);
    return typeof raw === "string" ? raw : null;
}

function writePersistedString(key, value) {
    if (hasSaveStore()) {
        try {
            GameTutorial.setProperty(Database.makeHash(key), value);
        } catch (e) {
            console.warn(LOG, "save-store persist failed", e);
        }
        return;
    }
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn(LOG, "persist failed", e);
    }
}

class CivViiChatStore {
    constructor() {
        this.messages = [];
        this.storageKey = null;
        this.lastRaw = null;
        this.lastReadSeqMap = {};
        this.isPanelOpen = false;
        this.listeners = new Set();
        this.botResponders = new Set();
        this.seq = 0;
        this.networkListenerInstalled = false;
    }

    // ---------------------------------------------------------------- identity
    get localPlayerId() {
        return safe(() => GameContext.localPlayerID, 0);
    }

    teamOf(playerId) {
        return safe(() => Players.get(playerId).team, -1);
    }

    isBot(playerId) {
        return safe(() => !Players.get(playerId).isHuman, false);
    }

    playerName(playerId) {
        const cfg = safe(() => Configuration.getPlayer(playerId), null);
        let name = "";
        if (cfg) {
            name = safe(() => cfg.nickName, "");
        }
        if (!name) name = safe(() => Players.get(playerId).name, "");
        if (!name && cfg) name = safe(() => cfg.slotName, "");
        name = name ? safe(() => Locale.compose(name), name) : "";
        return name || `Player ${playerId + 1}`;
    }

    /** "P2 · Name" — always includes the number so names can never be ambiguous. */
    playerLabel(playerId) {
        const name = this.playerName(playerId);
        const num = `P${playerId + 1}`;
        return name === `Player ${playerId + 1}` ? num : `${num} · ${name}`;
    }

    /** Token used after "@": name with whitespace stripped, else P<n>. */
    mentionToken(playerId) {
        const name = this.playerName(playerId).replace(/\s+/g, "");
        return /^Player\d+$/i.test(name) || !name ? `P${playerId + 1}` : name;
    }

    playerColor(playerId) {
        const c = safe(() => UI.Player.getPrimaryColorValueAsString(playerId), "");
        return c || PALETTE[playerId % PALETTE.length];
    }

    /** Teammates of `viewerId` (excluding viewer unless includeSelf). Same team only. */
    teammates(viewerId = this.localPlayerId, includeSelf = false) {
        const team = this.teamOf(viewerId);
        if (team < 0) return [];
        const ids = safe(() => Players.getAliveIds(), null) || safe(() => Players.getAlive().map((p) => p.id), []);
        return ids
            .filter((id) => {
                const p = safe(() => Players.get(id), null);
                if (!p || safe(() => !p.isMajor, false)) return false;
                if (p.team !== team) return false;
                return includeSelf || id !== viewerId;
            })
            .map((id) => ({
                id,
                label: this.playerLabel(id),
                token: this.mentionToken(id),
                isBot: this.isBot(id),
                color: this.playerColor(id)
            }));
    }

    resolveMention(token, viewerId = this.localPlayerId) {
        const t = token.toLowerCase();
        const mates = this.teammates(viewerId, false);
        const pNum = /^p(\d+)$/.exec(t);
        if (pNum) {
            const hit = mates.find((m) => m.id === parseInt(pNum[1], 10) - 1);
            if (hit) return hit;
        }
        return mates.find((m) => m.token.toLowerCase() === t) || null;
    }

    // ----------------------------------------------------------------- storage
    gameKey() {
        const seed = safe(() => Configuration.getGame().gameSeed, null) ?? safe(() => Configuration.getMap().mapSeed, "default");
        return `civViiChat:${seed}`;
    }

    ensureLoaded() {
        const key = this.gameKey();
        const raw = readPersistedString(key);
        if (key === this.storageKey && raw === this.lastRaw && Array.isArray(this.messages)) return;
        this.storageKey = key;
        this.lastRaw = raw;
        const parsed = raw ? safe(() => JSON.parse(raw), null) : null;
        if (Array.isArray(parsed)) {
            this.messages = parsed;
        } else if (parsed && typeof parsed === "object") {
            this.messages = Array.isArray(parsed.messages) ? parsed.messages : [];
            this.lastReadSeqMap = (parsed.readSeq && typeof parsed.readSeq === "object") ? parsed.readSeq : {};
        } else {
            this.messages = [];
        }
        this.seq = this.messages.reduce((m, x) => Math.max(m, x?.seq || 0), 0);
        this.installNetworkListener();
    }

    persist() {
        if (!Array.isArray(this.messages)) this.messages = [];
        if (this.messages.length > MAX_MESSAGES) this.messages = this.messages.slice(-MAX_MESSAGES);
        const payload = {
            messages: this.messages,
            readSeq: this.lastReadSeqMap
        };
        const serialized = JSON.stringify(payload);
        this.lastRaw = serialized;
        writePersistedString(this.storageKey, serialized);
    }

    /** Messages visible to `viewerId`: only those authored by their team. */
    visibleMessages(viewerId = this.localPlayerId) {
        this.ensureLoaded();
        const team = this.teamOf(viewerId);
        return this.messages.filter((m) => m && m.team === team);
    }

    // ---------------------------------------------------------------- unread tracking
    hasUnread(viewerId = this.localPlayerId) {
        if (this.isPanelOpen) return false;
        this.ensureLoaded();
        const msgs = this.visibleMessages(viewerId);
        const lastRead = this.lastReadSeqMap?.[viewerId] ?? 0;
        return msgs.some((m) => m && m.from !== viewerId && (m.seq || 0) > lastRead);
    }

    markAsRead(viewerId = this.localPlayerId) {
        this.ensureLoaded();
        const msgs = this.visibleMessages(viewerId);
        const maxSeq = msgs.reduce((m, x) => Math.max(m, x?.seq || 0), 0);
        if (!this.lastReadSeqMap) this.lastReadSeqMap = {};
        if (this.lastReadSeqMap[viewerId] !== maxSeq) {
            this.lastReadSeqMap[viewerId] = maxSeq;
            this.persist();
            this.emitUnreadChange();
        }
    }

    setPanelOpen(isOpen, viewerId = this.localPlayerId) {
        this.isPanelOpen = !!isOpen;
        if (this.isPanelOpen) {
            this.markAsRead(viewerId);
        } else {
            this.emitUnreadChange();
        }
    }

    emitUnreadChange() {
        safe(() => window.dispatchEvent(new CustomEvent(CIV_VII_CHAT_UNREAD_EVENT, { detail: { hasUnread: this.hasUnread() } })));
    }

    // ----------------------------------------------------------------- sending
    /**
     * Parse "@Token rest of message". Returns { to, text } where `to` is a
     * teammate id or -1 for whole team. Unknown @tokens are left in the text.
     */
    parse(raw, fromId) {
        const text = (raw || "").replace(/\r\n/g, "\n").trim();
        const m = /^@(\S+)\s*([\s\S]*)$/.exec(text);
        if (m) {
            const mate = this.resolveMention(m[1], fromId);
            if (mate) return { to: mate.id, text: m[2].replace(/^[ \t]+/, "").trim() };
        }
        return { to: -1, text };
    }

    /** Post as the current local player (from the UI). */
    send(raw) {
        return this.post(this.localPlayerId, raw);
    }

    /**
     * Public API for humans and bots: post `raw` from `fromId`.
     * `toId` (optional) overrides @-parsing for programmatic senders.
     */
    post(fromId, raw, toId, opts = {}) {
        this.ensureLoaded();
        if (!Array.isArray(this.messages)) this.messages = [];
        let { to, text } = this.parse(raw, fromId);
        if (typeof toId === "number" && toId >= 0) to = toId;
        if (!text) return null;
        if (to >= 0 && this.teamOf(to) !== this.teamOf(fromId)) to = -1; // never address non-teammates
        const msg = {
            seq: ++this.seq,
            turn: safe(() => Game.turn, 0),
            ts: Date.now(),
            from: fromId,
            team: this.teamOf(fromId),
            to,
            text: text.slice(0, 500),
            bot: this.isBot(fromId)
        };
        this.messages.push(msg);
        if (this.isPanelOpen) {
            if (!this.lastReadSeqMap) this.lastReadSeqMap = {};
            this.lastReadSeqMap[this.localPlayerId] = msg.seq;
        }
        this.persist();
        if (!opts.fromNetwork) this.relayToNetwork(msg);
        this.emit(msg);
        this.emitUnreadChange();
        if (!opts.fromNetwork) this.notifyBots(msg);
        return msg;
    }

    // --------------------------------------------------------------- events
    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    registerBotResponder(fn) {
        this.botResponders.add(fn);
        return () => this.botResponders.delete(fn);
    }

    emit(msg) {
        for (const fn of this.listeners) safe(() => fn(msg));
        safe(() => window.dispatchEvent(new CustomEvent(CIV_VII_CHAT_EVENT, { detail: msg })));
    }

    // ------------------------------------------------------------------- bots
    /**
     * Bot teammates on the sender's team respond to team or direct @-mentions.
     */
    notifyBots(msg) {
        if (msg.bot) return; // prevent bot-to-bot reply loops
        const bots = this.teammates(msg.from, false).filter((m) => m.isBot);
        bots.forEach((bot, idx) => {
            const addressed = msg.to === bot.id;
            if (msg.to >= 0 && !addressed) return;
            setTimeout(async () => {
                let reply = null;
                for (const fn of this.botResponders) {
                    reply = await Promise.resolve(safe(() => fn({ ...msg, botId: bot.id }, this), null)).catch(() => null);
                    if (typeof reply === "string" && reply.trim()) break;
                }
                if (!reply && (addressed || msg.to === -1)) {
                    reply = this.defaultBotReply(bot.id, msg);
                }
                if (typeof reply === "string" && reply.trim()) {
                    this.post(bot.id, reply, msg.from);
                }
            }, BOT_REPLY_DELAY_MS + idx * 350);
        });
    }

    defaultBotReply(botId, msg) {
        const p = safe(() => Players.get(botId), null);
        const cities = safe(() => p?.Cities?.getCities?.()?.length ?? p?.Cities?.count, null);
        const units = safe(() => p?.Units?.getUnits?.()?.length ?? p?.Units?.count, null);
        const gold = safe(() => Math.floor(p?.Treasury?.goldBalance ?? 0), null);
        const q = (msg.text || "").toLowerCase();
        const stats = [
            typeof cities === "number" ? `${cities} settlement${cities === 1 ? "" : "s"}` : null,
            typeof units === "number" ? `${units} unit${units === 1 ? "" : "s"}` : null,
            typeof gold === "number" && gold > 0 ? `${gold} gold` : null
        ].filter(Boolean).join(", ");
        if (/status|report|how|where|sitrep|plan/.test(q) && stats) {
            return `Reporting in (${stats}). Ready to coordinate with the team.`;
        }
        return stats
            ? `Copy that (${stats}). I'll factor your message into my next turn.`
            : `Acknowledged. I'll factor that into my plans this turn.`;
    }

    // ---------------------------------------------------------------- network
    isNetworkGame() {
        return safe(() => Configuration.getGame().isNetworkMultiplayer, false) === true;
    }

    teamChatTarget() {
        const targets = safe(() => Network.getChatTargets(), []) || [];
        return targets.find((t) => t.targetType === safe(() => ChatTargetTypes.CHATTARGET_TEAM, -99)) || null;
    }

    relayToNetwork(msg) {
        if (!this.isNetworkGame()) return; // local/hotseat: per-game store is the transport
        const target = this.teamChatTarget();
        if (!target) return;
        const prefix = msg.to >= 0 ? `@${this.mentionToken(msg.to)} ` : "";
        const payload = `${MARKER}${msg.from}|${msg.to}|${prefix}${msg.text}`;
        safe(() => Network.sendChat(payload, target.targetType, target.targetID));
    }

    installNetworkListener() {
        if (this.networkListenerInstalled || typeof engine === "undefined") return;
        this.networkListenerInstalled = true;
        engine.on("MultiplayerChat", (data) => {
            const text = data?.text || "";
            const at = text.indexOf(MARKER);
            if (at < 0) return;
            const m = /^(\d+)\|(-?\d+)\|(?:@\S+\s)?([\s\S]*)$/.exec(text.slice(at + MARKER.length));
            if (!m) return;
            const from = parseInt(m[1], 10);
            if (from === this.localPlayerId) return; // our own echo
            if (this.teamOf(from) !== this.teamOf(this.localPlayerId)) return;
            this.post(from, m[3], parseInt(m[2], 10), { fromNetwork: true });
        });
    }

    clear() {
        this.ensureLoaded();
        if (!Array.isArray(this.messages)) this.messages = [];
        const team = this.teamOf(this.localPlayerId);
        this.messages = this.messages.filter((m) => m && m.team !== team);
        this.persist();
        this.emit(null);
        this.emitUnreadChange();
    }
}

const store = new CivViiChatStore();
window.CivViiChat = store;
export default store;
