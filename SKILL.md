---
name: dsh-tps-install
description: Install the dsh-tps running-turn TPS badge for DeepSeek Harness 0.2.2-alpha.3 using its profile plugin loader.
---

# 安装 dsh-tps

目标：在 DSH `0.2.2-alpha.3` 的运行状态行末尾显示 TPS。通过 profile 安装插件，无需 Harness 源码 checkout、源码补丁或重建 DSH。

## 安装

确认目标 DSH 版本和 profile 名称（桌面版为 `desktop`，Web 版常用 `web`），然后按 [README.md](README.md) 安装：

```sh
dsh plugin --profile <profile> add github:Small-tailqwq/dsh-tps
dsh --profile <profile> --dump-config
```

本地待发布版本使用同一命令安装对应的 `.tgz`，不要用 GitHub 地址代替尚未发布的代码。保留 profile 中已有的其他插件和配置。

在 dump 输出中确认存在 id `tps`、name `dsh-tps` 且未禁用。若使用 `dshmarket`，还需确认其保存的禁用列表中没有 `dsh-tps`；市场会在启动和插件激活时恢复禁用状态，dump 配置本身不能证明客户端已加载。Git 安装使用自包含 `prepare` 构建；若 pnpm 拦截脚本，按提示配置该 profile 的 `allowBuilds`。安装后提醒用户刷新页面或重启 DSH，让新的客户端模块加载。

## 挂载契约

`conversation.composer.dock` 提供会话上下文，徽标通过 Portal 挂到当前 `[data-conversation-scroll]` 内运行状态行 `[data-chat-running]` 的图标与用时行末尾。定位与翻译文案、CSS 哈希无关。

运行状态行不是可注册的 Slot：它由 `dsh-client-ui-chat` 自己渲染，文案来自 locale 键 `chat.deepDiving` / `chat.deepDivingFor`，图标是包内资源。不显示时先核对实际加载的插件版本、宿主版本及 `[data-chat-running]` 容器。其他宿主版本或第三方皮肤需要检查其结构，不能直接视为兼容。数据来自 Session/Chat 快照，不从 DOM 文本推断 token 数。

本流程不包含启动浏览器或视觉验收；只有用户另外明确要求时才进行。
