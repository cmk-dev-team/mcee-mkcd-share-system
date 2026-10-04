// 届いたプログラム（JSON）から、MakeCode の作品をまるごと戻す URL を作る。
//
// MakeCode は https://minecraft.makecode.com/#project:<base64> を開くと、
// その中の作品ファイル（LZMA で圧縮した {meta, source}。「書き出し」と同じ形）を読みこむ（pxt webapp/src/app.tsx）。
// ゲストの子の MakeCode にはチュートリアルの作品が残らないので、ワールドに届いたものから組み立てなおして送る。
//
// main.blocks（ブロックの並び）も作るので、ブロック画面のまま開く。XML の書き方は MakeCode が書いたものから取った。
// 戻せるのは、ひらがな拡張（style: "hiragana"）のブロックだけ。

import LZMA from "./lzma";
import { BLOCKS, MOBS } from "./codeIcons";

// 作品が使うひらがな拡張。v1.8.0 のタグを打ったら "#v1.8.0" にする
const HIRAGANA_DEP = "github:cmk-dev-team/cmk-hiragana-blocks#15db5b5d96b3490126a8c435f26e8eac352c00f6";

const DIR_ENUM = { forward: "Forward", back: "Back", left: "Left", right: "Right", up: "Up", down: "Down" };

function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function num(name, n) {
    return `<value name="${name}"><shadow type="math_number"><field name="NUM">${Number(n) || 0}</field></shadow></value>`;
}

function slider(name, n, min, max) {
    return `<value name="${name}"><shadow type="math_number_minmax"><mutation min="${min}" max="${max}" precision="0"></mutation><field name="SLIDER">${Number(n) || 0}</field></shadow></value>`;
}

function blockPicker(id) {
    const b = BLOCKS[id];
    return b ? b[2] : null;
}

// 位置の文字（share.ts が送るもの）→ { ts, xml }
//   "ワールド x y z" / "みぎ r うえ u まえ f" / "エージェントの いち" / "~a ~b ~c"（pos）/ "x y z"（world）
function position(text) {
    const t = String(text || "").trim();
    let m;
    if ((m = t.match(/^ワールド (-?\d+) (-?\d+) (-?\d+)$/))) {
        return {
            ts: `hiraganaPositions.worldPosition(${m[1]}, ${m[2]}, ${m[3]})`,
            xml: `<shadow type="minecraftCreatePosition"></shadow><block type="hiragana_world_position">${num("x", m[1])}${num("y", m[2])}${num("z", m[3])}</block>`,
        };
    }
    if ((m = t.match(/^みぎ (-?\d+) うえ (-?\d+) まえ (-?\d+)$/))) {
        return {
            ts: `hiraganaPositions.relativePosition(${m[1]}, ${m[2]}, ${m[3]})`,
            xml: `<shadow type="minecraftCreatePosition"></shadow><block type="hiragana_relative_position">${num("right", m[1])}${num("up", m[2])}${num("forward", m[3])}</block>`,
        };
    }
    if (t === "エージェントの いち") {
        return {
            ts: `hiraganaAgent.agentPosition()`,
            xml: `<shadow type="minecraftCreatePosition"></shadow><block type="hiragana_agent_position"></block>`,
        };
    }
    if ((m = t.match(/^~(-?\d*) ~(-?\d*) ~(-?\d*)$/))) {
        const [x, y, z] = [m[1], m[2], m[3]].map(v => Number(v) || 0);
        return {
            ts: `pos(${x}, ${y}, ${z})`,
            xml: `<shadow type="minecraftCreatePosition">${num("x", x)}${num("y", y)}${num("z", z)}</shadow>`,
        };
    }
    if ((m = t.match(/^(-?\d+) (-?\d+) (-?\d+)$/))) {
        return {
            ts: `world(${m[1]}, ${m[2]}, ${m[3]})`,
            xml: `<shadow type="minecraftCreatePosition"></shadow><block type="minecraftCreateWorldPosition">${num("x", m[1])}${num("y", m[2])}${num("z", m[3])}</block>`,
        };
    }
    return null;
}

function mob(id) {
    const m = MOBS[id];
    if (!m) return null;
    const name = m[2];
    if (name.startsWith("AnimalMob.")) {
        return { ts: `mobs.animal(${name})`, xml: `<shadow type="minecraftAnimal"><field name="name">${name}</field></shadow>` };
    }
    if (name.startsWith("MonsterMob.")) {
        return {
            ts: `mobs.monster(${name})`,
            xml: `<shadow type="minecraftAnimal"><field name="name">AnimalMob.Chicken</field></shadow><block type="minecraftMonster"><field name="name">${name}</field></block>`,
        };
    }
    return null; // ネザーのいきもの など。書き方を確かめていないので戻さない
}

// 1つのブロック → { ts, xml（<block> ひとつ。<next> は呼び出し側で付ける）}。戻せないものは null
function one(c, indent, skipped) {
    const pad = "    ".repeat(indent);
    switch (c.type) {
        case "callAgent":
            return { ts: `${pad}hiraganaAgent.callAgent()`, xml: `<block type="hiragana_agent_teleport_to_player">` };
        case "move": {
            const d = DIR_ENUM[c.direction] || "Forward";
            return {
                ts: `${pad}hiraganaAgent.moveAgent(hiraganaAgent.Direction.${d}, ${Number(c.blocks) || 0})`,
                xml: `<block type="hiragana_agent_move"><field name="direction">hiraganaAgent.Direction.${d}</field>${num("distance", c.blocks)}`,
            };
        }
        case "turn": {
            const d = c.direction === "left" ? "Left" : "Right";
            return {
                ts: `${pad}hiraganaAgent.turnAgent(hiraganaAgent.TurnDirection.${d})`,
                xml: `<block type="hiragana_agent_turn"><field name="direction">hiraganaAgent.TurnDirection.${d}</field>`,
            };
        }
        case "place": {
            const d = DIR_ENUM[c.direction] || "Forward";
            return {
                ts: `${pad}hiraganaAgent.placeAgent(hiraganaAgent.Direction.${d})`,
                xml: `<block type="hiragana_agent_place"><field name="direction">hiraganaAgent.Direction.${d}</field>`,
            };
        }
        case "setItem": {
            const b = blockPicker(c.item);
            if (!b) break;
            return {
                ts: `${pad}hiraganaAgent.setAgentItem(${b}, ${Number(c.count) || 1}, ${Number(c.slot) || 1})`,
                xml: `<block type="hiragana_agent_set_item"><value name="blockType"><shadow type="minecraftBlock"><field name="block">${b}</field></shadow></value>${slider("count", c.count, 1, 64)}${slider("slot", c.slot, 1, 27)}`,
            };
        }
        case "teleport": {
            const p = position(c.pos);
            if (!p) break;
            return {
                ts: `${pad}hiraganaPlayer.teleport(${p.ts})`,
                xml: `<block type="hiragana_player_teleport"><value name="position">${p.xml}</value>`,
            };
        }
        case "placeAt": {
            const b = blockPicker(c.item);
            const p = position(c.pos);
            if (!b || !p) break;
            return {
                ts: `${pad}hiraganaBlocks.place(${b}, ${p.ts})`,
                xml: `<block type="hiragana_blocks_place"><value name="blockType"><shadow type="minecraftBlock"><field name="block">${b}</field></shadow></value><value name="position">${p.xml}</value>`,
            };
        }
        case "spawn": {
            const m = mob(c.item);
            const p = position(c.pos);
            if (!m || !p) break;
            return {
                ts: `${pad}hiraganaMobs.spawn(${m.ts}, ${p.ts})`,
                xml: `<block type="hiragana_mobs_spawn"><value name="mob">${m.xml}</value><value name="position">${p.xml}</value>`,
            };
        }
        case "repeat": {
            const inner = list(c.children || [], indent + 1, skipped);
            return {
                ts: `${pad}hiraganaLoops.repeat(${Number(c.times) || 0}, function () {\n${inner.ts}${pad}})`,
                xml: `<block type="hiragana_loops_repeat">${num("count", c.times)}${inner.xml ? `<statement name="HANDLER">${inner.xml}</statement>` : ""}`,
            };
        }
    }
    skipped.push(c.type);
    return null;
}

// ブロックの並び → { ts（行ごと）, xml（<block>…<next><block>…</block></next>…</block>）}
function list(program, indent, skipped) {
    const parts = [];
    for (const c of program) {
        const p = one(c, indent, skipped);
        if (p) parts.push(p);
    }
    let xml = "";
    for (let i = parts.length - 1; i >= 0; i--) {
        xml = parts[i].xml + (xml ? `<next>${xml}</next>` : "") + "</block>";
    }
    return { ts: parts.map(p => p.ts + "\n").join(""), xml };
}

function base64(bytes) {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i] & 255, b = bytes[i + 1] & 255, c = bytes[i + 2] & 255;
        const n = (a << 16) | (b << 8) | c;
        out += A[(n >> 18) & 63] + A[(n >> 12) & 63];
        out += i + 1 < bytes.length ? A[(n >> 6) & 63] : "=";
        out += i + 2 < bytes.length ? A[n & 63] : "=";
    }
    return out;
}

/**
 * @param {string} name 子どもの名前（作品名になる）
 * @param {object[]} programs 届いた JSON（{ command, style, program }）の配列
 * @returns {{ url: string, skipped: string[] } | null} ひらがな版が1つも無ければ null
 */
export function buildRestoreUrl(name, programs) {
    const skipped = [];
    const tsParts = [];
    let xmlTop = "";
    let y = 20;
    for (const d of programs) {
        if (d.style !== "hiragana") continue;
        const body = list(d.program || [], 1, skipped);
        const cmd = String(d.command || "");
        tsParts.push(`hiraganaPlayer.onChat(${JSON.stringify(cmd)}, function () {\n${body.ts}})\n`);
        xmlTop += `<block type="hiragana_player_on_chat" x="20" y="${y}"><value name="command"><shadow type="text"><field name="TEXT">${esc(cmd)}</field></shadow></value>`
            + (body.xml ? `<statement name="HANDLER">${body.xml}</statement>` : "") + `</block>`;
        // 次のチャットコマンドは、このプログラムの下に置く（1行およそ 48px。重なっていた）
        y += 120 + 48 * body.ts.split("\n").length;
    }
    if (!tsParts.length) return null;

    const title = `${name} のプログラム`;
    const pxtJson = {
        name: title,
        dependencies: { core: "*", builder: "*", hiragana: HIRAGANA_DEP },
        files: ["main.blocks", "main.ts", "README.md"],
        preferredEditor: "blocksprj",
    };
    const files = {
        "main.blocks": `<xml xmlns="https://developers.google.com/blockly/xml"><variables></variables>${xmlTop}</xml>`,
        "main.ts": tsParts.join(""),
        "README.md": " ",
        "pxt.json": JSON.stringify(pxtJson),
    };
    const hex = { meta: { cloudId: "pxt/minecraft", editor: "blocksprj", name: title }, source: JSON.stringify(files) };
    const bytes = LZMA.compress(JSON.stringify(hex), 2);
    return { url: "https://minecraft.makecode.com/#project:" + base64(bytes), skipped };
}
