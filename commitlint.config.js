export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 允许中文 subject，不限制大小写
    'subject-case': [0],
    // 项目沿用 feat/fix/refactor/style/docs/test/chore 等
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'style',
        'docs',
        'test',
        'chore',
        'perf',
        'build',
        'ci',
        'revert',
      ],
    ],
    'header-max-length': [2, 'always', 100],
  },
};
