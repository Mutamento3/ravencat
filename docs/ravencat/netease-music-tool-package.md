# 网易云音乐 Tool Package 当前生产基线

> 当前契约：网易云音乐正式工具包与原生受控能力。
>
> 当前工具、授权和执行边界由本文与[手机工具契约](phone-tools.md)承载。

## 1. 产品边界

`neteaseMusic` 是 RavenCat Phone Tools 下的第一个 App-specific Tool Package，面向当前主理 AI 提供网易云公开音乐数据、官方 App 精确点歌和 exact-package MediaSession 观察/控制。

它不是：

- 网易云账号或私有歌单集成；
- RavenCat 自建播放器；
- 跨音乐 App 的 generic media provider；
- Together Listening 产品状态的 owner；
- 对第三方非官方 API 形状的直接暴露。

账号登录、私人歌单、每日推荐等账号级能力不属于内置 package；如未来需要，应通过用户明确连接的外部 MCP 等独立集成提供。

## 2. 八个 production child tools

`neteaseMusic` 当前为 `available`，包含且只包含以下八个 child tools：

```text
netease_search_songs
netease_search_public_playlists
netease_get_public_playlist
netease_get_song_lyrics
netease_resolve_share_link
netease_play_song
netease_get_playback_state
netease_control_playback
```

能力分组：

```text
公开结构化数据
├─ search_songs
├─ search_public_playlists
├─ get_public_playlist
├─ get_song_lyrics
└─ resolve_share_link

官方 App route
└─ play_song

exact-package MediaSession
├─ get_playback_state
└─ control_playback
```

前五个公开读取/解析工具为 `safe_read / idempotent`；`play_song` 与 `control_playback` 会改变官方 App 播放状态，属于 `reversible_write / not_idempotent`；`get_playback_state` 属于 `private_read / idempotent`。

## 3. 公开数据 contract

公开搜索、歌单、歌词和分享链接解析可以使用可替换的数据 backend，但 Tool contract 只暴露 RavenCat 自己的稳定结构：

- song identity、标题、歌手、专辑与可用性；
- public playlist identity、标题、简介、封面与 track summary；
- lyrics text / timed lines；
- share-link resolution result 与 typed failure。

上游字段名、请求参数、错误码、签名细节和 cookie 不得成为 public Tool contract。非官方 backend 是可替换实现，不是产品身份；边界失败必须映射为稳定 typed result。

## 4. 官方 App 精确点歌

`netease_play_song` 使用当前已验证的官方 App exact-song route，把已经解析出的 canonical song identity 交给网易云音乐播放。

它不通过 Accessibility 点击坐标、OCR 猜测列表项或 Vision 驱动 UI，也不把搜索结果标题重新模糊匹配为另一首歌。Protected Apps action policy、package identity 和 Host authority 仍在各自 owner 层裁决。

## 5. MediaSession 观察与控制

播放事实只从网易云 exact-package MediaSession 获取，不以当前前台 Activity 代替 session identity。

`netease_get_playback_state` 返回当前播放项、playback state、position、speed、更新时间和 advertised actions。`netease_control_playback` 只执行 session 已声明支持的 `pause / resume / next / previous`。

MediaSession ownership 属于 Device Control / Phone Tools；Together Listening 只消费这些公共事实与动作，不复制 observer、transport control 或 session arbitration。

## 6. 按需拆包与主动开关

网易云八个工具仍注册在唯一 Agent Tool Registry。未展开时，模型只收到 `neteaseMusic`
的用途、已授权工具简介与统一 `open_tool_package` schema；拆包后，从下一次模型请求开始
直接提供八工具中本次已授权部分的完整参数，直接调用原始工具，不再经过 Phone Package 代理。

```text
工具包简介
→ open_tool_package({package_id: "neteaseMusic"})
→ 完整 function schemas
→ netease_search_songs / netease_play_song 等原始工具
```

普通单聊里，拆包当轮立即可用，成功正式回复的 T3 提交后持续保持展开。
AI 预计不再需要时调用 `close_tool_package` 收起，之后可以再次拆封；失败、取消和事务回滚不改变持久开关。
Chat 持有会话与 AI 隔离的持久状态，Host 只冻结本次授权并组合动态可见集合。
其他运行的开关只在当前 run 生效，不改写普通用户对话的持久状态。

产品 Catalog、包成员关系、查看简介与展开状态都不能增加授权。模型只能调用本次请求
实际暴露的工具，参数由 Agent Runtime 的唯一输入边界校验；没有已授权 child 时不出现该包。
MCP 保持自己的服务发现与代理调用协议。

## 7. Host authority

八个 child tools 全部为 `hostOnly`。Registry filtering 只决定工具是否进入本次运行；真正执行仍通过 Phone Tools 的 current Host authority coordinator，读取最新 Host identity 后串行裁决。

调用方不能通过伪造 `isHostAI`、复用旧 allowlist 或直接构造 meta-tool 参数获得 authority。模型运行期间 Host 易主时，执行边界应返回 typed authority failure，而不是相信准备阶段快照。

## 8. Runtime identity 与可见语义别名

Runtime、authorization 与审计保留真实 package / child identity：

```text
package_id: neteaseMusic
function.name: netease_search_songs
```

Chat presentation 使用稳定、面向用户的语义别名：

```text
cloudmusic.search_songs
cloudmusic.search_public_playlists
cloudmusic.get_public_playlist
cloudmusic.get_song_lyrics
cloudmusic.resolve_share_link
cloudmusic.play_song
cloudmusic.get_playback_state
cloudmusic.control_playback
```

`toolNames` 保存 raw runtime identity，`displayNames` 保存 visible semantic alias。Presentation 映射不得改变 authorization、schema validation 或 execution identity。

## 9. 与其他 Feature 的关系

```text
Phone Tools
= Package Catalog、Host authority、Protected Apps
Host
= 按用途拆包与动态 schema 暴露

Device Control
= official App launch、exact-package MediaSession facts/control

Chat
= tool timeline 的 visible semantic projection

Together Listening
= invitation / lifecycle product truth
```

只有在出现第二个真实音乐 package 并观察到稳定重复后，才考虑抽取 shared media capability；当前不为假想 provider 建通用层。

## 10. 长期检查

- Catalog 是否仍与 Registry production assembly 一致为八个 child？
- Child 是否仍全部为 Host-only 并经过 execution-time authority 裁决？
- 模型是否只通过两个 meta-tools 按需发现和调用已授权 child？
- Public contract 是否没有泄露上游 API 形状？
- 精确点歌是否仍走官方 App route，而非 UI 自动化？
- MediaSession 是否仍以 exact package 为事实边界？
- Chat 是否保留 raw identity，并只在 presentation 映射 `cloudmusic.*`？
- Together Listening 是否保持独立产品 ownership？
