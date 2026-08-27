/**
 * toolTexts — agent 工具的 description 文案集中管理。
 *
 * 工具定义（tools/*.ts）只引用这里的命名常量，描述文案一处维护：
 * 修改措辞不用翻各工具文件，模型看到的工具说明与这里一一对应。
 * 命名：DESC_<TOOL_NAME>（大写 snake_case）。
 */

// ── 命令执行（index.ts 的 run_command） ──

export const DESC_RUN_COMMAND =
  '在用户当前聚焦的终端 pane 中执行 shell 命令并等待完成，返回退出码与输出尾部。' +
  '命令会显示在终端的输入块中（用户可见）。' +
  '注意：全屏应用（vim/htop 等 altScreen）下会拒绝执行；命令执行中切入全屏界面会立即停止等待；' +
  '无命令块信号的旧 shell 退化为输出快照（无法保证命令真正结束）；' +
  '默认 120s 超时返回部分输出。交互式/长驻命令（如 dev server、TUI 程序）不要用此工具；' +
  '全屏交互程序（vim/htop）改用 read_terminal + terminal_keys 驱动。' +
  '命令文本可含 \\b、\\uXXXX 等控制字符（readline 会解析退格/清行等，如 "helo\\b" 输入为 "hel"）；' +
  '需要真正的交互按键请用 terminal_keys。';

// ── 文件（files.ts） ──

export const DESC_READ_FILE =
  '读取文本文件内容（默认上限 256KB，超出截断并标记）。' +
  '二进制/非 UTF-8 文件会报错。路径用绝对路径。';

export const DESC_WRITE_FILE =
  '整文件写入（会覆盖同名文件；覆盖前自动备份到 ~/.vrykell/backups/）。' +
  '父目录不存在会自动创建。大改动优先用 edit_file 精确替换。';

export const DESC_EDIT_FILE =
  '精确字符串替换：old_string 必须在文件中唯一命中，0 处或多处命中都会失败' +
  '（报错含命中数，补充更多上下文使其唯一后重试）。修改已有文件优先用它而不是 write_file。';

// ── 终端读写（terminal.ts） ──

export const DESC_READ_TERMINAL =
  '读取当前聚焦终端的实时可见画面（含 vim/less/htop 等全屏 TUI 的 alt buffer 画面）。' +
  '返回画面文本（带行号）、场景（classic/blockList/altScreen）、尺寸与光标位置。' +
  '用于：查看终端当前状态、阅读 vim 里的文件内容、确认上一次按键后的效果。' +
  '注意：块列表场景返回最近命令块的输出尾部；光标只在 classic/altScreen 有意义。';

export const DESC_TERMINAL_KEYS =
  '向当前聚焦终端发送原始按键序列（驱动 vim、REPL 等交互程序）。不等待命令完成。' +
  '按键用转义表达，\\uXXXX 与 \\xNN 均可：\\u0000–\\u001f 对应 Ctrl+对应字符' +
  '（\\u0001=Ctrl+A、\\u0003=Ctrl+C、\\u0004=Ctrl+D、\\u0005=Ctrl+E、\\u0015=Ctrl+U、' +
  '\\u0017=Ctrl+W、\\u0018=Ctrl+X、\\u001a=Ctrl+Z）、\\b=退格、\\r=回车、\\t=Tab、\\n=换行、' +
  '\\e 或 \\u001b=Esc、\\u001b[A=↑、\\u001b[B=↓、\\u001b[C=→、\\u001b[D=←。' +
  '注意：JSON 不支持 \\x 与 \\e，写它们时要用双反斜杠（如 "\\\\x1b"、"\\\\e"）；' +
  '转义多写了一层反斜杠（如 "\\\\u0018"、"\\\\b"）也会被自动纠正。' +
  '若按键串包含无法识别的转义会直接报错，绝不会把转义文本原样发送。' +
  '普通可见字符直接写。若输入有误，用 \\b 退格修正（如 "helo\\b" → "hel"）。' +
  '典型：vim 写文件 = terminal_keys("vi 路径\\r") → read_terminal() 看画面 →' +
  ' terminal_keys("i") 进插入模式 → terminal_keys("文件内容") →' +
  ' terminal_keys("\\u001b:wq\\r") 保存退出。发送后可用 read_terminal() 核对效果。';

// ── 目录与搜索（search.ts） ──

export const DESC_LIST_DIR = '列出目录内容（目录在前按名称排序）。路径用绝对路径。';

export const DESC_SEARCH_FILES =
  '递归搜索文件。content=false 按文件名子串匹配；content=true 按文件内容逐行匹配' +
  '（返回 路径:行号 与预览）。自动跳过 .git/node_modules/target 等目录，结果默认封顶 100 条。';

// ── 联网（webFetch.ts / webSearch.ts） ──

export const DESC_WEB_SEARCH_DDG =
  '联网搜索（DuckDuckGo，无需 API Key）。查询最新资讯、文档、报错信息等。' +
  '返回结果列表（标题/链接/内容节选）。';

export const DESC_WEB_FETCH =
  '抓取一个网页 URL，返回结构化文本（标题 + 正文 Markdown，保留标题层级/列表/链接）。' +
  '用于阅读某篇文档/网页，或对搜索结果里的链接做进一步阅读。纯文本/JSON 接口原样返回。';

export const DESC_WEB_CRAWL =
  '从起始 URL 广度优先爬取多个网页（默认同域、最多 10 页、深度 2），逐页返回结构化文本。' +
  '用于阅读一个站点的多个相关页面（如文档目录、博客系列）。单页阅读请用 web_fetch。';

export const DESC_WEB_SEARCH_TAVILY =
  '联网搜索（Tavily）。查询最新资讯、文档、报错信息等。' +
  '返回摘要与结果列表（标题/链接/内容节选）。';

// ── 技能（skill.ts） ──

export const DESC_USE_SKILL =
  '加载一个可用技能的完整指令。先看系统提示词里的「可用技能」清单，' +
  '当任务匹配某个技能时按名加载，返回 SKILL.md 正文、技能目录与其中的脚本/参考文件。';

export const DESC_INSTALL_SKILL =
  '安装或更新一个技能。当用户要求「添加/做一个…技能」或描述某类可复用操作时，' +
  '把整理好的技能写入：name（唯一名）、description（一句话说明何时用）、' +
  'prompt（完整操作步骤正文）。同名技能会覆盖更新。';

// ── 子代理（subagent.ts） ──

export const DESC_SUBAGENT =
  '子代理工具。action：spawn=把独立子任务委派给某子代理执行并返回结论；' +
  'create=新建子代理定义（名称/描述/系统提示词）；list=查看全部子代理；remove=删除。';

// ── 定时任务（schedule.ts） ──

export const DESC_SCHEDULE =
  '定时任务工具。action：create=新建（每隔 N 分钟自动执行提示词）；list=查看全部；toggle=启用/停用；remove=删除。';

// ── 记忆（memory.ts） ──

export const DESC_MEMORY =
  '长期记忆工具。action 说明：read=读取全部记忆；' +
  'update=重写持久知识 FACT（用于整理记忆：把流水压缩成结构化要点后整体重写）；' +
  'append=追加一条流水（临时进展/结论）；search=按关键词在记忆中搜索。';