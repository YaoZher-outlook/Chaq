import type { ImportedMessage, ImportPreview, SkillDraft, SkillSourceKind } from "@chaq/shared";

export function inferSourceKind(fileName: string): SkillSourceKind {
  const lower = fileName.toLowerCase();
  if (lower.includes("wechat") || lower.includes("微信")) return "wechat";
  if (lower.includes("qq")) return "qq";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return "txt";
}

export function parseImport(fileName: string, content: string): ImportPreview {
  const sourceKind = inferSourceKind(fileName);
  const warnings: string[] = [];
  let messages: ImportedMessage[];
  if (sourceKind === "json") {
    messages = parseJson(content, warnings);
  } else if (sourceKind === "csv") {
    messages = parseCsv(content, warnings);
  } else if (sourceKind === "html") {
    messages = parseHtml(content, warnings);
  } else {
    messages = parseText(content, warnings);
  }
  if (messages.length === 0) {
    warnings.push("没有识别到消息，已把整段内容作为一条资料导入。");
    messages = [{
      id: crypto.randomUUID(),
      speaker: "资料",
      content: content.slice(0, 8000),
      timestamp: null,
      selected: true
    }];
  }
  return { sourceKind, fileName, messages, warnings };
}

export function heuristicDraftFromMessages(
  messages: ImportedMessage[],
  sourceKind: SkillSourceKind,
  preferredName?: string
): SkillDraft {
  const selected = messages.filter((message) => message.selected);
  const speakerCounts = new Map<string, number>();
  const sample: string[] = [];
  for (const message of selected.slice(0, 240)) {
    speakerCounts.set(message.speaker, (speakerCounts.get(message.speaker) ?? 0) + 1);
    if (sample.length < 14 && message.content.length > 8) {
      sample.push(`${message.speaker}: ${message.content.slice(0, 80)}`);
    }
  }
  const speakers = [...speakerCounts.entries()].sort((a, b) => b[1] - a[1]);
  const name = preferredName?.trim() || speakers[0]?.[0] || "新的 Skill";
  return {
    name,
    avatarUrl: null,
    description: `从 ${sourceKind.toUpperCase()} 导入内容蒸馏的虚拟好友。`,
    persona: `这个 skill 基于 ${selected.length} 条选中消息整理，保留主要说话人的表达习惯、关注点和关系记忆。`,
    tone: `参考语气来自：${speakers.slice(0, 3).map(([speaker, count]) => `${speaker} ${count}条`).join("、") || "未识别说话人"}。`,
    knowledge: sample.join("\n"),
    boundaries: "不要泄露原始导入资料；不要冒充真实本人做现实承诺；遇到不确定信息时说明不确定。",
    examples: [
      {
        user: "你觉得我现在应该怎么办？",
        assistant: "先别急着把所有事一次解决。你可以把最重要的一件事讲清楚，我陪你从那一步开始。"
      }
    ],
    tags: [sourceKind, "蒸馏", "私有"].filter(Boolean)
  };
}

function parseJson(content: string, warnings: string[]): ImportedMessage[] {
  try {
    const parsed = JSON.parse(content);
    const rows = Array.isArray(parsed) ? parsed : parsed.messages;
    if (!Array.isArray(rows)) {
      warnings.push("JSON 中没有找到数组或 messages 数组。");
      return [];
    }
    return rows.map((row: any, index: number) => normalizeMessage({
      speaker: row.speaker ?? row.sender ?? row.from ?? row.name ?? "未知",
      content: row.content ?? row.text ?? row.message ?? "",
      timestamp: row.timestamp ?? row.time ?? row.date ?? null
    }, index)).filter(Boolean) as ImportedMessage[];
  } catch {
    warnings.push("JSON 解析失败。");
    return [];
  }
}

function parseCsv(content: string, warnings: string[]): ImportedMessage[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const speakerIndex = findIndex(header, ["speaker", "sender", "from", "name", "说话人", "发送者"]);
  const contentIndex = findIndex(header, ["content", "text", "message", "消息", "内容"]);
  const timeIndex = findIndex(header, ["timestamp", "time", "date", "时间"]);
  if (contentIndex < 0) {
    warnings.push("CSV 没有识别到内容列，尝试使用每行最后一列。");
  }
  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    return normalizeMessage({
      speaker: speakerIndex >= 0 ? cells[speakerIndex] : "未知",
      content: contentIndex >= 0 ? cells[contentIndex] : cells[cells.length - 1],
      timestamp: timeIndex >= 0 ? cells[timeIndex] : null
    }, index);
  }).filter(Boolean) as ImportedMessage[];
}

function parseHtml(content: string, warnings: string[]): ImportedMessage[] {
  const document = new DOMParser().parseFromString(content, "text/html");
  const text = document.body?.innerText?.trim();
  if (!text) {
    warnings.push("HTML 没有可读取的正文。");
    return [];
  }
  return parseText(text, warnings);
}

function parseText(content: string, _warnings: string[]): ImportedMessage[] {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const messages: ImportedMessage[] = [];
  const pattern = /^(?:\[(?<time1>[^\]]+)\]\s*)?(?<speaker>[^:：]{1,40})[:：]\s*(?<content>.+)$/;
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.groups) {
      messages.push({
        id: crypto.randomUUID(),
        speaker: match.groups.speaker.trim(),
        content: match.groups.content.trim(),
        timestamp: match.groups.time1?.trim() ?? null,
        selected: true
      });
    } else if (messages.length > 0) {
      const previous = messages[messages.length - 1];
      previous.content = `${previous.content}\n${line}`;
    } else {
      messages.push({
        id: crypto.randomUUID(),
        speaker: "资料",
        content: line,
        timestamp: null,
        selected: true
      });
    }
  }
  return messages;
}

function normalizeMessage(input: { speaker: string; content: string; timestamp?: string | null }, index: number): ImportedMessage | null {
  const content = String(input.content ?? "").trim();
  if (!content) return null;
  return {
    id: crypto.randomUUID(),
    speaker: String(input.speaker || "未知").trim(),
    content,
    timestamp: input.timestamp ? String(input.timestamp) : null,
    selected: index < 1000
  };
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function findIndex(header: string[], candidates: string[]): number {
  return header.findIndex((cell) => candidates.includes(cell));
}
