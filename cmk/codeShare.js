// 子どものプログラムを先生が見る（CMK 版の受け側）
//
// もとは teacher-addon/scripts/main.js（たくのろじぃ先生）。CMK のワールドに入れるために変えたところ：
//  - 開く口はブレイズロッドではなく、先生メニュー → レッスン補助 → 「子どものプログラム」
//  - server_form.json は上書きしない（CMK のほかのフォームの形も変わるため）
//  - 受信のたびに全員へチャットを出さない（子どもの画面がうるさくなるため）
//  - 「さいごに届いた」「うごかした（run が来たか）」を一覧に出す
//  - ひらがな拡張（style: "hiragana"）の文言・テレポート・ブロックをおく・スポーンにも対応
//  - @minecraft/server 1.11.0 / server-ui 1.1.0 で動く API だけを使う
//
// 置き場所：behavior_packs/cmk_behavior_system/scripts/codeShare.js
// 正本：cmk-dev-team/mcee-mkcd-share-system の cmk/codeShare.js

import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

// 生徒名 -> { programs: Map<コマンド名, { json, mode, at }>, lastAt, lastRunAt }
const students = new Map();
// 生徒名 -> 受信途中のチャンク { total, parts: Map<part, chunk> }
const buffers = new Map();

function entry(name) {
    let s = students.get(name);
    if (!s) {
        s = { programs: new Map(), lastAt: 0, lastRunAt: 0 };
        students.set(name, s);
    }
    return s;
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
    s.programs.set(data.command || "", { data: data, at: now });
    s.lastAt = now;
    if (data.mode === "run") s.lastRunAt = now;
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

// MakeCode のブロック ID（下位16ビットが種類。上位は色ちがい・木の種類など）
const BLOCK_NAMES = {
    1: "石", 2: "草ブロック", 3: "土", 4: "丸石", 5: "板材", 7: "岩盤",
    12: "砂", 13: "砂利", 14: "金鉱石", 15: "鉄鉱石", 16: "石炭鉱石",
    17: "原木", 18: "葉", 19: "スポンジ", 20: "ガラス", 24: "砂岩",
    35: "羊毛", 41: "金ブロック", 42: "鉄ブロック", 45: "レンガ", 46: "TNT",
    47: "本棚", 48: "苔石", 49: "黒曜石", 50: "たいまつ", 54: "チェスト",
    56: "ダイヤモンド鉱石", 57: "ダイヤモンドブロック", 58: "作業台",
    79: "氷", 80: "雪ブロック", 81: "サボテン", 82: "粘土", 85: "フェンス",
    87: "ネザーラック", 89: "グロウストーン", 98: "石レンガ", 102: "板ガラス",
    103: "スイカ", 112: "ネザーレンガ", 121: "エンドストーン",
    133: "エメラルドブロック", 152: "レッドストーンブロック", 155: "クォーツブロック", 159: "テラコッタ"
};
function blockName(id) {
    return BLOCK_NAMES[id] || BLOCK_NAMES[id & 0xffff] || `ブロック(${id})`;
}

// いきもの（下位8ビットが種類。未確認のものは番号で出す）
const MOB_NAMES = {
    10: "ニワトリ", 11: "ウシ", 12: "ブタ", 13: "ヒツジ", 14: "オオカミ", 15: "むらびと",
    16: "ムーシュルーム", 17: "イカ", 18: "ウサギ", 19: "コウモリ", 20: "アイアンゴーレム",
    21: "スノーゴーレム", 22: "ヤマネコ", 23: "ウマ", 24: "ロバ", 25: "ラバ",
    28: "シロクマ", 29: "ラマ", 30: "オウム", 31: "イルカ", 75: "ネコ",
    113: "パンダ", 121: "キツネ", 122: "ミツバチ"
};
function mobName(id) {
    return MOB_NAMES[id & 0xff] || `いきもの(${id})`;
}

// プログラムを、MakeCode のブロックの文言どおりの行にする
function steps(program, depth, hira, lines) {
    const pad = "| ".repeat(depth);
    for (const c of program) {
        let t = null;
        if (hira) {
            switch (c.type) {
                case "callAgent": t = "エージェントを よぶ"; break;
                case "move": t = `エージェントを ${dir(c.direction)} に ${c.blocks} ブロック うごかす`; break;
                case "turn": t = `エージェントの むきを ${dir(c.direction)} に かえる`; break;
                case "place": t = `エージェントに ${dir(c.direction)} へ おく`; break;
                case "setItem": t = `エージェントに ${blockName(c.item)} を ${c.count} コ、もちもの ${c.slot} ばんに せっていする`; break;
                case "teleport": t = `プレイヤーを ${c.pos} に テレポートさせる`; break;
                case "placeAt": t = `${blockName(c.item)} を ${c.pos} に おく`; break;
                case "spawn": t = `${mobName(c.item)} を ${c.pos} に スポーンさせる`; break;
                case "repeat": t = `${c.times} かい くりかえす`; break;
            }
        } else {
            switch (c.type) {
                case "move": t = `エージェントを ${dir(c.direction)} に ${c.blocks} ブロック移動させる`; break;
                case "turn": t = `エージェントの向きを ${dir(c.direction)} にかえる`; break;
                case "setItem": t = `エージェントに ${blockName(c.item)} を ${c.count} コ スロット ${c.slot} 番に設定させる`; break;
                case "place": t = `エージェントに ${dir(c.direction)} へ置かせる`; break;
                case "repeat": t = `くりかえし ${c.times} 回`; break;
            }
        }
        lines.push(pad + (t || `（${c.type}）`));
        if (c.type === "repeat") {
            steps(c.children || [], depth + 1, hira, lines);
            lines.push(`${pad}+--`);
        }
    }
}

function describe(p) {
    const d = p.data;
    const hira = d.style === "hiragana";
    const lines = [];
    const how = d.mode === "run" ? "うごかした" : "ひらいた";
    lines.push(`§7${how}とき：${ago(p.at)}§r`);
    lines.push(hira
        ? `チャットコマンド ${d.command || ""} を にゅうりょくしたとき`
        : `チャットコマンド ${d.command || ""} を実行したとき`);
    steps(d.program || [], 0, hira, lines);
    if (lines.length === 2) lines.push("（なにも入っていない）");
    return lines.join("\n");
}

// ------------------------------------------------------------------
// 先生メニューから開く
// ------------------------------------------------------------------
export async function showCodeShareMenu(player) {
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
    for (const name of names) {
        const s = students.get(name);
        if (!s || s.programs.size === 0) {
            form.button(`${name}\n§cまだ届いていない`);
        } else {
            const run = s.lastRunAt ? `うごかした ${ago(s.lastRunAt)}` : "§6まだ うごかしていない";
            form.button(`${name}\nとどいた ${ago(s.lastAt)}・${run}`);
        }
    }

    const res = await form.show(player);
    if (res.canceled || res.selection === undefined) return;
    await showDetail(player, names[res.selection]);
}

async function showDetail(player, name) {
    const s = students.get(name);
    let body;
    if (!s || s.programs.size === 0) {
        body = "まだ届いていない。\nMakeCode で再生（みどりのボタン）を押すと、約2秒で届く。\n押しても届かないときは、MakeCode がつながっていない。";
    } else {
        const parts = [];
        for (const p of s.programs.values()) parts.push(describe(p));
        body = parts.join("\n\n");
    }

    const form = new ActionFormData();
    form.title(`${name} のプログラム`);
    form.body(body);
    form.button("もういちど見る");
    form.button("一覧へもどる");
    const res = await form.show(player);
    if (res.canceled || res.selection === undefined) return;
    if (res.selection === 0) await showDetail(player, name);
    else await showCodeShareMenu(player);
}
