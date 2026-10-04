// 子どものプログラムを先生が見る（CMK 版の受け側）
//
// もとは teacher-addon/scripts/main.js（たくのろじぃ先生）。CMK のワールドに入れるために変えたところ：
//  - 開く口はブレイズロッドではなく、先生メニュー → レッスン補助 → 「子どものプログラム」
//  - server_form.json は上書きしない（CMK のほかのフォームの形も変わるため）
//  - 受信のたびに全員へチャットを出さない（子どもの画面がうるさくなるため）
//  - 「さいごに届いた」「うごかした（run が来たか）」を一覧に出す
//  - ひらがな拡張（style: "hiragana"）の文言・テレポート・ブロックをおく・スポーンにも対応
//  - @minecraft/server 1.11.0 / server-ui 1.1.0 で動く API だけを使う
//  - 届いたものはワールドに保存する（ホストが閉じても残る）。ゲストの子の MakeCode には作品が残らないので、
//    「MakeCode に もどす」で、さいごに届いたプログラムを子どもの MakeCode に開きなおせる（restore.js）
//
// 置き場所：behavior_packs/cmk_behavior_system/scripts/codeShare.js
// 正本：cmk-dev-team/mcee-mkcd-share-system の cmk/codeShare.js

import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { BLOCKS, MOBS } from "./codeIcons";
import { buildRestoreUrl } from "./restore";

// 生徒名 -> { programs: Map<コマンド名, { data, at, batch }>, lastAt, lastRunAt, batch, lastTraceAt }
//   batch：再生（なぞり）のたびに1つ増える組の番号。いまの組（batch が同じもの）だけを見せる・戻す。
//   子どもがチャットコマンドを消しても、前の組のものは出てこない
const students = new Map();
// 生徒名 -> 受信途中のチャンク { total, parts: Map<part, chunk> }
const buffers = new Map();

// ------------------------------------------------------------------
// ワールドへの保存（動的プロパティ）。子ども1人に1つ ＋ 名前の一覧
// ------------------------------------------------------------------
const KEY_INDEX = "cmk_code:index";
const KEY = (name) => `cmk_code:p:${name}`;
let loaded = false;

function load() {
    if (loaded) return;
    loaded = true;
    try {
        const names = JSON.parse(world.getDynamicProperty(KEY_INDEX) || "[]");
        for (const name of names) {
            const raw = world.getDynamicProperty(KEY(name));
            if (typeof raw !== "string") continue;
            const o = JSON.parse(raw);
            students.set(name, {
                programs: new Map(o.programs || []),
                lastAt: o.lastAt || 0, lastRunAt: o.lastRunAt || 0,
                batch: o.batch || 0, lastTraceAt: o.lastTraceAt || 0,
            });
        }
    } catch (e) { /* こわれていたら、空から始める */ }
}

function save(name) {
    try {
        const s = students.get(name);
        // いまの組だけを残す（古い組まで持つと、1つの上限 32767 文字を超えうる）
        const programs = [...s.programs].filter(([, p]) => p.batch === s.batch);
        let raw = JSON.stringify({ programs, lastAt: s.lastAt, lastRunAt: s.lastRunAt, batch: s.batch, lastTraceAt: s.lastTraceAt });
        if (raw.length > 30000) return; // 大きすぎるものは保存しない（見る・戻すは、ワールドを開いている間はできる）
        world.setDynamicProperty(KEY(name), raw);
        world.setDynamicProperty(KEY_INDEX, JSON.stringify([...students.keys()]));
    } catch (e) { /* 保存に失敗しても、見る・戻すは続けられる */ }
}

function entry(name) {
    load();
    let s = students.get(name);
    if (!s) {
        s = { programs: new Map(), lastAt: 0, lastRunAt: 0, batch: 0, lastTraceAt: 0 };
        students.set(name, s);
    }
    return s;
}

// いまの組のプログラム（チャットコマンドの名前順）
function current(s) {
    return [...s.programs.values()].filter(p => p.batch === s.batch);
}

// ------------------------------------------------------------------
// 受信：/scriptevent puzzle:submit <名前>|<part>/<total>|<chunk>
// ------------------------------------------------------------------
system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (ev.id !== "puzzle:submit") return;

    const src = ev.sourceEntity;
    const srcName = src && src.typeId === "minecraft:player" ? src.name : null;

    const segs = ev.message.split("|");
    if (segs.length < 3) return;
    const name = srcName || segs[0];

    const [partStr, totalStr] = segs[1].split("/");
    const part = parseInt(partStr, 10);
    const total = parseInt(totalStr, 10);
    if (!part || !total) return;
    const chunk = segs.slice(2).join("|");

    let buf = buffers.get(name);
    if (!buf || buf.total !== total) {
        buf = { total: total, parts: new Map() };
        buffers.set(name, buf);
    }
    buf.parts.set(part, chunk);
    if (buf.parts.size !== total) return;

    let json = "";
    for (let i = 1; i <= total; i++) json += buf.parts.get(i) || "";
    buffers.delete(name);

    let data;
    try { data = JSON.parse(json); } catch (e) { return; }

    const now = Date.now();
    const s = entry(name);
    const cmd = data.command || "";
    if (data.mode === "run") {
        // 実行：その1つだけを新しくする（組は変えない）
        s.lastRunAt = now;
        const before = s.programs.get(cmd);
        s.programs.set(cmd, { data: data, at: now, batch: before ? before.batch : s.batch });
    } else {
        // なぞり：再生のたびに、全部のチャットコマンドがまとめて届く。5秒あいたら新しい組
        if (now - s.lastTraceAt > 5000) s.batch++;
        s.lastTraceAt = now;
        s.programs.set(cmd, { data: data, at: now, batch: s.batch });
    }
    s.lastAt = now;
    save(name);
});

// ------------------------------------------------------------------
// 表示用のことば
// ------------------------------------------------------------------
function ago(t) {
    if (!t) return "";
    const sec = Math.floor((Date.now() - t) / 1000);
    if (sec < 10) return "いま";
    if (sec < 60) return `${sec}秒前`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}分前`;
    return `${Math.floor(min / 60)}時間前`;
}

const DIR = { forward: "まえ", back: "うしろ", right: "みぎ", left: "ひだり", up: "うえ", down: "した" };
function dir(d) { return DIR[d] || d; }

// ブロック・いきものは、MakeCode と同じアイコン（グリフ）と日本語名で出す。表は build_icons.py が作る
function blockName(id) {
    const b = BLOCKS[id];
    return b ? `${b[0]} ${b[1]}` : `ブロック(${id})`;
}

function mobName(id) {
    const m = MOBS[id];
    return m ? `${m[0]} ${m[1]}` : `いきもの(${id})`;
}

// プログラムを、MakeCode のブロックの文言どおりの文にする
function blockText(c, hira) {
    if (hira) {
        switch (c.type) {
            case "callAgent": return "エージェントを よぶ";
            case "move": return `エージェントを ${dir(c.direction)} に ${c.blocks} ブロック うごかす`;
            case "turn": return `エージェントの むきを ${dir(c.direction)} に かえる`;
            case "place": return `エージェントに ${dir(c.direction)} へ おく`;
            case "setItem": return `エージェントに ${blockName(c.item)} を ${c.count} コ、もちもの ${c.slot} ばんに せっていする`;
            case "teleport": return `プレイヤーを ${posText(c.pos)} に テレポートさせる`;
            case "placeAt": return `${blockName(c.item)} を ${posText(c.pos)} に おく`;
            case "spawn": return `${mobName(c.item)} を ${posText(c.pos)} に スポーンさせる`;
            case "repeat": return `${c.times} かい くりかえす`;
        }
    } else {
        switch (c.type) {
            case "move": return `エージェントを ${dir(c.direction)} に ${c.blocks} ブロック移動させる`;
            case "turn": return `エージェントの向きを ${dir(c.direction)} にかえる`;
            case "setItem": return `エージェントに ${blockName(c.item)} を ${c.count} コ スロット ${c.slot} 番に設定させる`;
            case "place": return `エージェントに ${dir(c.direction)} へ置かせる`;
            case "repeat": return `くりかえし ${c.times} 回`;
        }
    }
    return `（${c.type}）`;
}

// ブロックの色（JSON UI の build_ui.py と合わせる）
//  p 青 プレイヤー / a 橙 エージェント / g 緑 くりかえし / k 黄緑 ブロック / m 紫 いきもの / b 茶 標準版
function blockColor(c, hira) {
    if (!hira) return "b";
    switch (c.type) {
        case "repeat": return "g";
        case "teleport": return "p";
        case "placeAt": return "k";
        case "spawn": return "m";
        default: return "a";
    }
}

// タイトルの頭に付ける目印。書式コードだけなので画面には出ない（build_ui.py の PREFIX と同じ）
const MARK = "§r§1§2§3§r";

// 位置は MakeCode の表示にあわせる（"~ ~ ~" → "~0 ~0 ~0"）。
// MakeCode では位置は別のブロック（青緑）なので、文字の色を変えて見分けられるようにする
function posText(p) {
    return "§b" + String(p || "").replace(/~(?=\s|$)/g, "~0") + "§f";
}

// 1行 ＝ ボタン1つ。アイコンの文字列 "cmk_code:<種類>:<色>:<左の帯>" で見た目を選ぶ
function row(kind, color, rails, text) {
    const r = rails.map((c, i) => `|${i + 1}${c}`).join("");
    return { text: text, icon: `cmk_code:${kind}:${color}:${r}` };
}

function addRows(program, rails, hira, rows) {
    for (const c of program) {
        const color = blockColor(c, hira);
        rows.push(row("body", color, rails, blockText(c, hira)));
        if (c.type === "repeat") {
            addRows(c.children || [], rails.concat([color]), hira, rows);
            rows.push(row("bot", color, rails, ""));
        }
    }
}

function programRows(p, rows) {
    const d = p.data;
    const hira = d.style === "hiragana";
    const chat = hira ? "p" : "b";
    const how = d.mode === "run" ? "うごかした" : "ひらいた";
    const ver = hira ? `・ひらがな ${d.ver || "1.8.0-dev2 まで"}` : "";
    rows.push(row("note", chat, [], `${how}とき：${ago(p.at)}${ver}`));
    rows.push(row("body", chat, [], hira
        ? `チャットコマンド ${d.command || ""} を にゅうりょくしたとき`
        : `チャットコマンド ${d.command || ""} を実行したとき`));
    addRows(d.program || [], [chat], hira, rows);
    rows.push(row("bot", chat, [], ""));
}

// ------------------------------------------------------------------
// 先生メニューから開く
// ------------------------------------------------------------------
export async function showCodeShareMenu(player) {
    load();
    const set = new Set();
    for (const p of world.getAllPlayers()) {
        if (!p.hasTag("teacher")) set.add(p.name);
    }
    for (const key of students.keys()) set.add(key);
    const names = Array.from(set);

    const form = new ActionFormData();
    form.title("子どものプログラム");
    if (names.length === 0) {
        form.body("子どもが まだ いません");
        form.button("とじる");
        await form.show(player);
        return;
    }
    form.body(
        "とどいた＝MakeCode の再生を押したとき・チャットコマンドを打ったときに届く\n" +
        "・届いていない → MakeCode とつながっていない（再起動）\n" +
        "・正しいのに動かない → MakeCode の不具合（再起動）\n" +
        "・まちがっている → プログラムのミス"
    );
    form.button("MakeCode に もどす…", "textures/items/book_writable");
    for (const name of names) {
        const s = students.get(name);
        if (!s || current(s).length === 0) {
            form.button(`${name}\n§cまだ届いていない`);
        } else {
            const run = s.lastRunAt ? `うごかした ${ago(s.lastRunAt)}` : "§6まだ うごかしていない";
            form.button(`${name}\nとどいた ${ago(s.lastAt)}・${run}`);
        }
    }

    const res = await form.show(player);
    if (res.canceled || res.selection === undefined) return;
    if (res.selection === 0) await showRestoreMenu(player);
    else await showDetail(player, names[res.selection - 1]);
}

// ------------------------------------------------------------------
// MakeCode に もどす：さいごに届いたプログラムを、その子の MakeCode に開く
// ------------------------------------------------------------------
async function showRestoreMenu(player) {
    const online = new Set(world.getAllPlayers().map(p => p.name));
    const names = [...students.keys()].filter(n => online.has(n) && current(students.get(n)).length > 0);

    const form = new ActionFormData();
    form.title("MakeCode に もどす");
    if (names.length === 0) {
        form.body("もどせる子が いない。\n（ワールドに入っていて、プログラムが届いたことがある子だけが出る）");
        form.button("もどる");
        await form.show(player);
        await showCodeShareMenu(player);
        return;
    }
    form.body("えらんだ子の MakeCode に、さいごに届いたプログラムを開く。\nいま開いている MakeCode の画面は、このプログラムに切りかわる。");
    for (const n of names) form.button(`${n}\nとどいた：${ago(students.get(n).lastAt)}`);
    form.button("もどる");
    const res = await form.show(player);
    if (res.canceled || res.selection === undefined) return;
    if (res.selection >= names.length) { await showCodeShareMenu(player); return; }

    const name = names[res.selection];
    const r = buildRestoreUrl(name, current(students.get(name)).map(p => p.data));
    if (!r) {
        player.sendMessage(`§c${name} のプログラムは、ひらがなのブロックではないので もどせない`);
        return;
    }
    system.run(() => {
        try {
            world.getDimension("overworld").runCommand(`codebuilder navigate "${name}" true ${r.url}`);
            player.sendMessage(`${name} の MakeCode に、プログラムを開いた`
                + (r.skipped.length ? `（もどせなかったブロック：${[...new Set(r.skipped)].join("・")}）` : ""));
        } catch (e) {
            player.sendMessage(`§cもどせなかった：${e}`);
        }
    });
}

async function showDetail(player, name) {
    const s = students.get(name);
    const form = new ActionFormData();
    if (!s || current(s).length === 0) {
        form.title(`${name} のプログラム`);
        form.body("まだ届いていない。\nMakeCode で再生（みどりのボタン）を押すと、約2秒で届く。\n押しても届かないときは、MakeCode がつながっていない。");
        form.button("一覧へもどる");
    } else {
        // タイトルが MARK で始まると、リソースパックの JSON UI がブロックの見た目で出す
        form.title(`${MARK}${name} のプログラム`);
        form.body("");
        const rows = [];
        let first = true;
        for (const p of current(s)) {
            if (!first) rows.push(row("gap", "p", [], ""));
            first = false;
            programRows(p, rows);
        }
        for (const r of rows) form.button(r.text, r.icon);
    }
    // 閉じても（×）一覧へもどる。一覧を閉じればおわり
    await form.show(player);
    await showCodeShareMenu(player);
}
