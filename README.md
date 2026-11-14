# dsh-cookie-pruner

> v0.2.0 · DSH 桌面端 `dsh-auth-*` cookie 堆积（HTTP 431）清理与预防插件

[English](./README.en.md)

## 这个插件是干什么的

DSH 桌面端每次启动都会写一条新的 `dsh-auth-*` 认证 cookie。由于本地服务端口每次随机，cookie 名字每次都不同，旧的一直不会被复用或删除；累积到约 70 次启动后，请求头超过 16 KB，服务端返回 HTTP 431（`Web authentication failed`），桌面端就再也打不开。

这个插件做三件事：

- **测**：读出当前 Chromium Cookies 库的大小，判断有没有堆积风险，并交给助手在对话里转述。
- **讲**：在「设置 → 账户 → Cookie 清理」里给出状态说明和一次性清理步骤。
- **防**：把新写入的认证 cookie 寿命压到 **3 天**，让旧 cookie 自行过期，不再无限堆积。

## 怎么实现的

插件分两半，配合一个离线脚本与一条 profile 配置：

- **Host 半边（`index.js`）**：运行在 DSH 插件沙箱里，用 `node:fs.statSync` 读取 `%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies` 的文件大小（库被占用时文件元数据仍可读），把结果写进 `.runtime-diag.json`，供助手在对话里转述。
- **Client 半边（`client.js`）**：在「设置 → 账户」注册「Cookie 清理」面板，说明当前机制与离线清理步骤。
- **离线脚本（`cleanup-once.ps1`）**：在 DSH 完全退出、Cookies 库不再被占用后，把库改名为 `.bak-<时间戳>` 备份；下次启动 DSH 会重建干净的库。脚本会先检查 DSH 进程，仍在运行就拒绝执行，不破坏文件。
- **配置补丁（`cordis.patch.yml`）**：向 profile 写入 `connection.cookieMaxAgeDays: 3`。

> 插件沙箱不允许在运行时删除 cookie（Cookies 库被桌面端占用，且沙箱不提供相应服务）。所以「清掉已有堆积」由离线脚本完成，「不再继续堆积」由 3 天过期配置完成。

## 怎么预防的

- **未来不再堆积**：`connection.cookieMaxAgeDays: 3` 让每条新认证 cookie 3 天后过期。即使每次启动都换名字，旧 cookie 也会滚动消失，请求头不会再涨到 16 KB。
- **清掉已有堆积**：完全退出 DSH 后，以管理员身份运行一次（路径按实际安装位置）：
  ```powershell
  & "D:\AI\dsh-cookie-pruner\cleanup-once.ps1"
  ```
  之后重新打开 DSH 即可，431 解除。
