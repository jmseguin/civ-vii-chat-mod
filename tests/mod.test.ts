import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "../src");

console.log("Running diagnostics test for civ-vii-chat-mod...");

const requiredFiles = [
  "civ-vii-chat-mod.modinfo",
  "thumbnail.png",
  "text/en_us/CivViiChatModText.xml",
  "ui/civ-vii-chat-store.js",
  "ui/civ-vii-chat-panel.js",
  "ui/civ-vii-chat-panel.html",
  "ui/civ-vii-chat-panel.css",
  "ui/civ-vii-chat-dock.js",
  "ui/icons/civ_vii_chat_dock.png",
  "ui/icons/civ_vii_chat_icon.png",
  "ui/icons/civ_vii_chat_send.png"
];

for (const rel of requiredFiles) {
  const full = path.join(srcDir, rel);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing required file in src/: ${rel}`);
  }
}

const modinfo = fs.readFileSync(path.join(srcDir, "civ-vii-chat-mod.modinfo"), "utf8");
if (!modinfo.includes('<Mod id="civ-vii-chat-mod"')) {
  throw new Error("Expected Mod id to be 'civ-vii-chat-mod'");
}

const itemMatches = [...modinfo.matchAll(/<Item>([^<]+)<\/Item>/g)].map((m) => m[1]);
for (const item of itemMatches) {
  if (!fs.existsSync(path.join(srcDir, item))) {
    throw new Error(`modinfo references missing file: ${item}`);
  }
}

// Unit test CivViiChatStore in a mocked Gameface environment
const storage = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.CustomEvent = class CustomEvent {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
};
g.dispatchEvent = () => true;
g.localStorage = {
  // Simulate Civ VII Gameface returning "{}" for unset keys
  getItem: (k: string) => storage.get(k) ?? "{}",
  setItem: (k: string, v: string) => storage.set(k, v)
};
g.GameContext = { localPlayerID: 0 };
g.Game = { turn: 12 };
g.Configuration = {
  getGame: () => ({ gameSeed: 4242, isNetworkMultiplayer: false }),
  getPlayer: (id: number) => ({ nickName: id === 0 ? "HumanOne" : id === 1 ? "BotAlly" : "Opponent" })
};
g.Locale = { compose: (s: string) => s };
g.UI = { Player: { getPrimaryColorValueAsString: () => "#e3c77d" } };
g.Players = {
  getAliveIds: () => [0, 1, 2],
  get: (id: number) => ({
    id,
    isMajor: true,
    isHuman: id === 0,
    team: id === 2 ? 2 : 1,
    name: `Player ${id + 1}`,
    Cities: { count: 2 },
    Units: { count: 4 },
    Treasury: { goldBalance: 85 }
  })
};

const storeUrl = pathToFileURL(path.join(srcDir, "ui/civ-vii-chat-store.js")).href;
const { default: store } = await import(storeUrl);

const mates = store.teammates(0, false);
if (mates.length !== 1 || mates[0].id !== 1 || !mates[0].isBot) {
  throw new Error(`Expected exactly 1 bot teammate (player 1), got: ${JSON.stringify(mates)}`);
}

const msg1 = store.send("@BotAlly status report");
if (!msg1 || msg1.to !== 1 || msg1.text !== "status report") {
  throw new Error(`@Name mention parsing failed: ${JSON.stringify(msg1)}`);
}

const msg2 = store.send("@P2 defend the river\nand hold the bridge");
if (!msg2 || msg2.to !== 1 || msg2.text !== "defend the river\nand hold the bridge") {
  throw new Error(`@P<number> multi-line mention parsing failed: ${JSON.stringify(msg2)}`);
}

const visible = store.visibleMessages(0);
if (visible.length !== 2) {
  throw new Error(`Expected 2 visible team messages, got ${visible.length}`);
}

// Unread notification testing
if (store.hasUnread(0)) {
  throw new Error("Expected hasUnread(0) to be false for sender's own messages");
}

// Teammate sends a message while panel is closed -> unread becomes true
store.post(1, "Understood, moving units to bridge.");
if (!store.hasUnread(0)) {
  throw new Error("Expected hasUnread(0) to be true after teammate post when panel is closed");
}

// Marking as read clears the unread badge
store.markAsRead(0);
if (store.hasUnread(0)) {
  throw new Error("Expected hasUnread(0) to be false after markAsRead(0)");
}

// While panel is open, incoming messages are immediately marked as read
store.setPanelOpen(true, 0);
store.post(1, "Scout reports barbarian camp nearby.");
if (store.hasUnread(0)) {
  throw new Error("Expected hasUnread(0) to be false while panel is open");
}

// Closing panel, then receiving a message sets unread
store.setPanelOpen(false, 0);
store.post(1, "Archers standing by.");
if (!store.hasUnread(0)) {
  throw new Error("Expected hasUnread(0) to be true after teammate post while panel is closed");
}

// Reopening panel clears unread
store.setPanelOpen(true, 0);
if (store.hasUnread(0)) {
  throw new Error("Expected hasUnread(0) to be false upon opening panel");
}

console.log("All diagnostics tests for civ-vii-chat-mod passed!");
process.exit(0);

