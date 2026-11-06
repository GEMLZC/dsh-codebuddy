# Third-party notices

本插件（`dsh-codebuddy`）是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的第三方适配器。

## 上游项目

本仓库是 [zhang-tod/dsh-codebuddy](https://github.com/zhang-tod/dsh-codebuddy) 的 fork（分叉自 `1.1.5`），
以 **MIT** 许可继续分发，原始版权声明保留在 [LICENSE](./LICENSE) 中。

相对上游的改动见 [CHANGELOG.md](./CHANGELOG.md) 的 `1.1.6` 及之后条目。

## 运行时契约

本插件的实现遵循下列上游包的接口与约定，这些包均以 **MIT** 许可分发：

| 包 | 版权 | 许可 |
|---|---|---|
| `@deepseek-ai/dsh-llm` | Copyright (c) 2026 DeepSeek | MIT |
| `@deepseek-ai/dsh-llm-deepseek` | Copyright (c) 2026 DeepSeek | MIT |
| `@deepseek-ai/dsh-credentials` | Copyright (c) 2026 DeepSeek | MIT |

适配器实现中的若干部分（错误分类、流式分块组织、重试策略接线）在编写时**参考**了
`@deepseek-ai/dsh-llm-deepseek`。这些包以运行时依赖 / peerDependency 的形式被引用，
**没有任何源码被复制或内联进本仓库**。

---

本插件连接的腾讯 CodeBuddy 开放平台（`copilot.tencent.com`）**不属于**本项目，
其服务由腾讯提供并受其自身条款约束。本项目与腾讯无任何隶属或背书关系。
