export const USE_COLOR = process.stdout.isTTY ?? false;

export function color(code: string, text: string): string {
  return USE_COLOR ? `${code}${text}\x1b[0m` : text;
}

export const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
};

export function fmtTime(d = new Date()): string {
  return d.toLocaleTimeString("vi-VN", { hour12: false });
}

const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("vi", { granularity: "grapheme" }) : null;

function* clusterize(s: string): Generator<string> {
  if (segmenter) {
    for (const seg of segmenter.segment(s)) yield seg.segment;
  } else {
    for (const ch of s) yield ch;
  }
}

const WIDE =
  /[\u{1100}-\u{115F}\u{2E80}-\u{A4CF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE30}-\u{FE4F}\u{FF00}-\u{FF60}\u{FFE0}-\u{FFE6}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]/u;

function clusterWidth(cluster: string): number {
  return WIDE.test(cluster) ? 2 : 1;
}

export function displayWidth(s: string): number {
  let w = 0;
  for (const cluster of clusterize(s)) w += clusterWidth(cluster);
  return w;
}

export function pad(str: string, width: number): string {
  const diff = width - displayWidth(str);
  return diff > 0 ? str + " ".repeat(diff) : str;
}

export function truncate(str: string, width: number): string {
  if (displayWidth(str) <= width) return str;
  let out = "";
  let w = 0;
  for (const cluster of clusterize(str)) {
    const cw = clusterWidth(cluster);
    if (w + cw > width) break;
    out += cluster;
    w += cw;
  }
  return out + "…";
}

export function cell(text: string, width: number): string {
  const cut = displayWidth(text) > width ? truncate(text, width - 1) + "…" : text;
  return pad(cut, width);
}
