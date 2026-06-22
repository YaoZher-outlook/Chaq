import { BadRequestException } from "@nestjs/common";
import { ZodError, ZodSchema } from "zod";

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestException(error.issues.map(formatValidationIssue));
    }
    throw error;
  }
}

const fieldLabels: Record<string, string> = {
  username: "账号",
  password: "密码",
  confirmPassword: "确认密码",
  email: "邮箱",
  code: "验证码",
  displayName: "昵称",
  avatarUrl: "头像",
  currentPassword: "当前密码",
  newPassword: "新密码",
  name: "名称",
  content: "内容",
  reason: "举报原因",
  value: "选项",
  amount: "数量",
  note: "备注",
  kind: "类型",
  baseUrl: "接口地址",
  apiKey: "API Key",
  modelId: "模型 ID",
  modelLabel: "模型名称",
  defaultModel: "默认模型",
  skill: "Skill",
  sourceKind: "来源类型"
};

function formatValidationIssue(issue: ZodError["issues"][number]): string {
  const rawPath = issue.path.map(String).join(".");
  const field = String(issue.path.at(-1) ?? rawPath);
  const label = fieldLabels[rawPath] ?? fieldLabels[field] ?? "输入内容";
  const code = issue.code;
  const details = issue as any;

  if (code === "invalid_string" && details.validation === "email") {
    return "请输入有效的邮箱地址。";
  }
  if (code === "invalid_type" && (details.received === "undefined" || details.received === "null")) {
    return `${label}不能为空。`;
  }
  if (code === "too_small") {
    if (details.type === "string" && details.minimum === 1) {
      return `请输入${label}。`;
    }
    if (details.type === "string") {
      return `${label}长度不能少于 ${details.minimum} 个字符。`;
    }
    if (details.type === "array") {
      return `${label}数量不足。`;
    }
    return `${label}数值太小。`;
  }
  if (code === "too_big") {
    if (details.type === "string") {
      return `${label}太长了，请缩短后再试。`;
    }
    if (details.type === "array") {
      return `${label}数量太多了。`;
    }
    return `${label}数值太大。`;
  }
  if (code === "invalid_enum_value") {
    return `${label}选项无效，请重新选择。`;
  }
  if (code === "unrecognized_keys") {
    return "提交内容包含暂不支持的字段，请刷新后重试。";
  }
  return `${label}格式不正确，请检查后重试。`;
}
