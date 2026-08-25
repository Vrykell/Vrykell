/**
 * standardSkills — 内置标准技能（首次安装时预置，可禁用/删除）。
 */
import type { Skill } from './skills';

export const STANDARD_SKILLS: Skill[] = [
  {
    id: 'builtin-unit-test',
    name: '写单元测试',
    description: '为新增或改动的函数编写并运行单元测试',
    prompt: [
      '为目标函数/模块编写单元测试：',
      '1. 先 read_file 读源码，确认函数签名、边界条件与依赖。',
      '2. 用项目已有的测试框架与目录结构，新增或补充测试文件。',
      '3. 覆盖正常路径、边界输入、错误分支；不测外部依赖，必要时 mock。',
      '4. 用 run_command 运行测试命令，确认全部通过后汇报结果。',
    ].join('\n'),
    enabled: true,
  },
  {
    id: 'builtin-code-review',
    name: '代码审查',
    description: '审查改动，指出缺陷、安全隐患与可读性问题',
    prompt: [
      '对目标代码做一次严谨审查：',
      '1. 先 read_file 读源码，必要时 git diff 看改动范围。',
      '2. 检查正确性、边界与空值处理、并发/资源释放、错误处理。',
      '3. 检查安全隐患与性能热点；指出命名、结构、注释等可读性问题。',
      '4. 按严重程度分条输出，每条给出位置、问题与修复建议。',
    ].join('\n'),
    enabled: true,
  },
  {
    id: 'builtin-git-commit',
    name: '提交代码',
    description: '按规范生成提交信息并完成 git 提交',
    prompt: [
      '整理当前改动并提交：',
      '1. 用 git status / git diff 了解改动内容与范围。',
      '2. 生成规范的提交信息，第一行用祈使句概括改动，必要时补充说明。',
      '3. 提交前确认没有把密钥、日志、临时文件加入版本库。',
      '4. 执行提交并汇报提交哈希与摘要。',
    ].join('\n'),
    enabled: true,
  },
  {
    id: 'builtin-doc',
    name: '编写文档',
    description: '为代码或接口撰写清晰的说明文档',
    prompt: [
      '编写文档：',
      '1. 先 read_file 读源码，理解用途、入参与返回、示例用法。',
      '2. 写清用途、安装/运行方式、核心 API 或用法示例。',
      '3. 语言简洁，示例可运行；涉及命令时给出具体命令。',
      '4. 用 write_file 写入 README 或指定文档文件。',
    ].join('\n'),
    enabled: true,
  },
  {
    id: 'builtin-debug',
    name: '调试报错',
    description: '分析终端报错并定位修复',
    prompt: [
      '排查并修复报错：',
      '1. 读取终端里的报错信息，定位文件、行号与错误类型。',
      '2. read_file 读相关源码，结合报错栈推断根因。',
      '3. 必要时用 run_command 复现或加日志确认。',
      '4. 用 edit_file 修复后重新运行验证，汇报根因与改动。',
    ].join('\n'),
    enabled: true,
  },
];
