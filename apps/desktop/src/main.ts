import { invoke } from "@tauri-apps/api/core";
import "./style.css";
document.querySelector("#app")!.innerHTML =
  `<main><small>◆ AgentDeck</small><h1>登录你的电脑</h1><p>电脑和手机用同一个账号</p><form><label>邮箱<input name="email" type="email" autocomplete="email" required></label><label>密码<input name="password" type="password" autocomplete="current-password" minlength="8" required></label><button>登录 / 创建账号</button></form><p id="status" role="status">登过一次就会自动连上</p><p>登录后在托盘查看状态和退出</p></main>`;
const form = document.querySelector("form")!;
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const button = document.querySelector("button")!;
  button.disabled = true;
  try {
    await invoke("login", {
      email: String(data.get("email")),
      password: String(data.get("password")),
    });
    document.querySelector("#status")!.textContent = "已登录";
  } catch {
    document.querySelector("#status")!.textContent =
      "登录没成功 检查账号和连接后重试";
  } finally {
    (form.elements.namedItem("password") as HTMLInputElement).value = "";
    button.disabled = false;
  }
});
