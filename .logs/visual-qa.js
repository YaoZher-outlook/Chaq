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

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Renderer evaluation failed.");
    return result.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await delay(1_000);

  const loginState = await evaluate(`(() => {
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const username = document.querySelector('input[placeholder="邮箱 / 账号"]');
    const password = document.querySelector('input[placeholder="密码"]');
    if (username && password) {
      setValue(username, "admin");
      setValue(password, "123456");
      username.closest("form").requestSubmit();
      return "credentials";
    }
    const remembered = document.querySelector(".login-card.remembered-mode");
    if (remembered) {
      remembered.requestSubmit();
      return "remembered";
    }
    return document.querySelector(".app-shell") ? "already-authenticated" : document.body.innerText.slice(0, 300);
  })()`);

  await delay(4_000);
  await evaluate(`(() => {
    const agentButton = document.querySelector('button[title="Agent OS"]');
    if (agentButton) agentButton.click();
  })()`);
  await delay(2_500);

  await evaluate(`(() => {
    const firstAgent = document.querySelector(".agent-directory-row");
    if (firstAgent) firstAgent.click();
  })()`);
  await delay(2_500);

  await evaluate(`(() => {
    const profile = document.querySelector(".agent-profile-trigger");
    if (!profile) throw new Error("Agent profile trigger was not rendered.");
    profile.click();
  })()`);
  await delay(3_000);

  const postWasCreated = await evaluate(`(async () => {
    if (document.querySelector(".agent-post")) return false;
    const setValue = (element, value) => {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const composer = document.querySelector(".agent-post-composer textarea");
    if (!composer) return false;
    setValue(composer, "今天完成了一次完整的自主运行验证。把过程留在这里，也把下一步交给新的观察。 ");
    const inputs = document.querySelectorAll(".agent-post-composer footer input");
    if (inputs[0]) setValue(inputs[0], "专注");
    if (inputs[1]) setValue(inputs[1], "Chaq 工作室");
    document.querySelector(".agent-post-publish").click();
    return true;
  })()`);
  if (postWasCreated) await delay(2_500);

  await evaluate(`(() => {
    const post = document.querySelector(".agent-post");
    if (!post) return;
    const like = post.querySelector(".agent-post-actions button");
    if (like && !like.classList.contains("liked")) like.click();
    const input = post.querySelector(".agent-post-comment-box input");
    if (input && !post.querySelector(".agent-post-comments")) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "收到，继续保持这种可见的节奏。");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      post.querySelector(".agent-post-comment-box button").click();
    }
  })()`);
  await delay(2_000);

  const layout = await evaluate(`(() => {
    const overlay = document.querySelector(".agent-profile-overlay");
    const page = document.querySelector(".agent-profile-page");
    const cover = document.querySelector(".agent-profile-cover");
    const intro = document.querySelector(".agent-profile-intro");
    if (!overlay || !page || !cover || !intro) throw new Error("Agent profile did not render.");
    const rect = (node) => {
      const value = node.getBoundingClientRect();
      return { x: Math.round(value.x), y: Math.round(value.y), width: Math.round(value.width), height: Math.round(value.height) };
    };
    const viewport = { width: innerWidth, height: innerHeight };
    const overflowing = [...document.querySelectorAll("button, input, textarea, h1, h2, p")].filter((node) => node.scrollWidth > node.clientWidth + 2 && getComputedStyle(node).overflowX !== "hidden").length;
    const blankImages = [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length;
    return {
      viewport,
      overlay: rect(overlay),
      cover: rect(cover),
      intro: rect(intro),
      title: document.querySelector(".agent-profile-name h1")?.textContent,
      postCount: document.querySelectorAll(".agent-post").length,
      overflowing,
      blankImages,
      text: page.innerText.slice(0, 500)
    };
  })()`);

  const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(".logs/agent-profile-qa.png", Buffer.from(screenshot.data, "base64"));
  await evaluate(`document.querySelector(".agent-profile-message")?.click()`);
  await delay(1_500);
  const chatLayout = await evaluate(`(() => {
    const drawer = document.querySelector(".agent-profile-chat");
    if (!drawer) throw new Error("Profile chat drawer did not open.");
    const rect = drawer.getBoundingClientRect();
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), thinking: Boolean(drawer.querySelector(".agent-typing")) };
  })()`);
  const chatScreenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(".logs/agent-profile-chat-qa.png", Buffer.from(chatScreenshot.data, "base64"));
  socket.close();
  console.log(JSON.stringify({ loginState, postWasCreated, layout, chatLayout, screenshots: [".logs/agent-profile-qa.png", ".logs/agent-profile-chat-qa.png"] }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
