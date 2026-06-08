import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { demoPasswordHash } from "../src/modules/auth/auth.service";

const envPath = join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const adminId = process.env.DEMO_ADMIN_USER_ID ?? "admin-local";
  const users = [
    {
      id: adminId,
      username: "admin",
      displayName: "Chaq 管理员",
      role: "ADMIN" as const,
      avatarUrl: "/avatars/admin.png",
      tokenBalance: 100000
    },
    {
      id: "creator-local",
      username: "creator",
      displayName: "Skill 创作者",
      role: "CREATOR" as const,
      avatarUrl: "/avatars/creator.png",
      tokenBalance: 50000
    },
    {
      id: "user-local",
      username: "demo",
      displayName: "Chaq 用户",
      role: "USER" as const,
      avatarUrl: "/avatars/user.png",
      tokenBalance: 10000
    }
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        ...user,
        passwordHash: demoPasswordHash,
        settings: {
          create: {
            language: "zh",
            theme: "dark",
            backgroundUrl: "/assets/chaq-cover.png",
            backgroundOpacity: 0.42,
            windowOpacity: 1
          }
        }
      },
      update: {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        avatarUrl: user.avatarUrl,
        passwordHash: demoPasswordHash,
        tokenBalance: user.tokenBalance
      }
    });
    await prisma.userSetting.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        language: "zh",
        theme: "dark",
        backgroundUrl: "/assets/chaq-cover.png",
        backgroundOpacity: 0.42,
        windowOpacity: 1
      },
      update: {}
    });
  }

  await prisma.modelProviderConfig.upsert({
    where: { id: "demo-openai-compatible" },
    create: {
      id: "demo-openai-compatible",
      kind: "OPENAI",
      name: "Demo OpenAI Compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKeyCiphertext: "replace-me",
      models: [
        { id: "gpt-4.1-mini", label: "GPT 4.1 Mini", contextWindow: 128000 }
      ],
      enabled: false,
      promptTokenPrice: 0.001,
      completionTokenPrice: 0.004,
      contextWindow: 128000
    },
    update: {}
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
