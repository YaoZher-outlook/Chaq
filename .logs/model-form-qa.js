const fs = require("node:fs");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const targets = await fetch("http://127.0.0.1:29333/json").then((response) => response.json());
  const target = targets.find((item) => item.type === "page" && item.title === "Chaq");
  if (!target) throw new Error("Chaq renderer target was not found.");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  console.log("connected");
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, method === "Page.captureScreenshot" ? 15_000 : 5_000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); }
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Renderer evaluation failed.");
    return result.result.value;
  };

  await send("Page.enable");
  console.log("page enabled");
  await delay(1_000);
  await evaluate(`(() => {
    const setValue = (element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const username = document.querySelector('input[placeholder="邮箱 / 账号"]');
    const password = document.querySelector('input[placeholder="密码"]');
    if (username && password) {
      setValue(username, "admin");
      setValue(password, "123456");
      username.closest("form").requestSubmit();
    } else {
      document.querySelector(".login-card.remembered-mode")?.requestSubmit();
    }
  })()`);
  await delay(4_000);
  console.log("authenticated");

  const switchVendor = async (kind) => evaluate(`(async () => {
    const select = document.querySelector(".form-panel select");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, ${JSON.stringify(kind)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const values = [...document.querySelectorAll(".form-panel input")].map((input) => input.value);
    return { kind: select.value, values };
  })()`);

  await evaluate(`document.querySelector('button[title="模型"]')?.click()`);
  await delay(700);
  console.log("personal models opened");
  const personal = {};
  for (const kind of ["deepseek", "anthropic", "ollama", "custom"]) personal[kind] = await switchVendor(kind);

  await evaluate(`document.querySelector('button[title="后台"]')?.click()`);
  await delay(700);
  console.log("platform models opened");
  const platform = {};
  for (const kind of ["deepseek", "anthropic", "ollama", "custom", "dashscope"]) platform[kind] = await switchVendor(kind);

  let screenshotPath = null;
  try {
    const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    screenshotPath = ".logs/model-provider-switch-qa.png";
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  } catch {
    // Field assertions remain valid when a minimized window cannot be captured.
  }
  socket.close();
  console.log(JSON.stringify({ personal, platform, screenshot: screenshotPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
